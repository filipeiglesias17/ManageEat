// Restauro de um snapshot feito por scripts/db-backup.ts.
//
// Substitui o conteúdo dos volumes Docker (BD + Storage) pelo que estava no
// snapshot escolhido — volta ao estado EXATO desse momento. É destrutivo (apaga
// o estado atual), por isso pede confirmação.
//
// Uso:  npm run db:backups          (lista os pontos de restauro)
//       npm run db:restore          (restaura o MAIS RECENTE)
//       npm run db:restore <nome>   (restaura um snapshot específico)
//       ... --yes                   (sem perguntar; para automação)

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

const args = process.argv.slice(2)
const doList = args.includes('--list')
const yes = args.includes('--yes') || args.includes('-y')
const nameArg = args.find((a) => !a.startsWith('-'))

const BACKUP_ROOT = path.resolve('backups')

interface Manifest {
  reason?: string
  createdAt?: string
  volumes?: { name: string, bytes: number }[]
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
function dockerOut(a: string[]): string {
  return (execFileSync('docker', a, { encoding: 'utf-8' }) as string).trim()
}
function run(cmd: string, a: string[]) {
  execFileSync(cmd, a, { stdio: 'inherit' })
}
function readManifest(dir: string): Manifest {
  try { return JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf-8')) }
  catch { return {} }
}

// Snapshots por ordem cronológica (o nome é um timestamp ISO → ordena bem).
function snapshots(): { name: string, manifest: Manifest }[] {
  if (!existsSync(BACKUP_ROOT)) return []
  return readdirSync(BACKUP_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(BACKUP_ROOT, d.name, 'manifest.json')))
    .map((d) => ({ name: d.name, manifest: readManifest(path.join(BACKUP_ROOT, d.name)) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function totalMb(m: Manifest): string {
  const bytes = (m.volumes ?? []).reduce((s, v) => s + (v.bytes ?? 0), 0)
  return (bytes / (1024 * 1024)).toFixed(1)
}

function printList(snaps: { name: string, manifest: Manifest }[]) {
  if (snaps.length === 0) {
    console.log('Ainda não há backups em backups/. Corre "npm run db:backup".')
    return
  }
  console.log('Pontos de restauro (mais recente em baixo):\n')
  for (const s of snaps) {
    console.log(`  ${s.name}   [${s.manifest.reason ?? '—'}]   ${totalMb(s.manifest)} MB`)
  }
  console.log('\nRestaura com:  npm run db:restore <nome>   (ou sem nome = o mais recente)')
}

// GNU tar (debian) é obrigatório: preserva os xattrs do Storage na extração. O
// BusyBox tar (imagem do Postgres) ignora-os e as imagens ficavam a dar 500.
const TAR_IMAGE = 'debian:stable-slim'

function ensureTarImage() {
  try { dockerOut(['image', 'inspect', TAR_IMAGE]) }
  catch {
    console.log(`A descarregar a imagem de apoio ${TAR_IMAGE} (só na 1.ª vez)…`)
    run('docker', ['pull', TAR_IMAGE])
  }
}

function restoreVolume(vol: string, dir: string) {
  // Esvazia o volume e extrai o tgz por cima, preservando xattrs e donos.
  // O `..?*` apanha também ficheiros ocultos.
  const cmd = `rm -rf /vol/* /vol/..?* 2>/dev/null || true; tar --xattrs --xattrs-include='user.*' --numeric-owner -xzf /backup/${vol}.tgz -C /vol`
  run('docker', [
    'run', '--rm',
    '-v', `${vol}:/vol`,
    '-v', `${dir}:/backup`,
    TAR_IMAGE,
    'sh', '-c', cmd,
  ])
}

async function confirm(name: string, m: Manifest): Promise<boolean> {
  if (yes) return true
  console.log(`Vais RESTAURAR o snapshot ${name}  [${m.reason ?? '—'}, ${m.createdAt ?? '?'}].`)
  console.log('Isto SUBSTITUI a base de dados e as imagens atuais. A app vai reiniciar.\n')
  const rl = readline.createInterface({ input: stdin, output: stdout })
  const ans = (await rl.question('Escreve "sim" para confirmar: ')).trim().toLowerCase()
  rl.close()
  return ans === 'sim'
}

async function main() {
  const snaps = snapshots()

  if (doList || (!nameArg && snaps.length === 0)) {
    printList(snaps)
    process.exit(0)
  }
  if (snaps.length === 0) {
    console.error('Não há backups em backups/.')
    process.exit(1)
  }

  const target = nameArg ? snaps.find((s) => s.name === nameArg) : snaps[snaps.length - 1]
  if (!target) {
    console.error(`Backup não encontrado: ${nameArg}\n`)
    printList(snaps)
    process.exit(1)
  }

  if (!(await confirm(target.name, target.manifest))) {
    console.log('Cancelado.')
    process.exit(0)
  }

  const dir = path.join(BACKUP_ROOT, target.name)
  const volumes = (target.manifest.volumes ?? [])
    .map((v) => v.name)
    .filter((v) => existsSync(path.join(dir, `${v}.tgz`)))
  if (volumes.length === 0) {
    console.error('O snapshot não tem ficheiros .tgz válidos — abortado.')
    process.exit(1)
  }

  ensureTarImage()

  try {
    console.log('A pausar o Supabase…')
    run('npx', ['supabase', 'stop'])
  } catch { /* pode já estar parado */ }

  try {
    for (const vol of volumes) {
      console.log(`A restaurar volume ${vol}…`)
      restoreVolume(vol, dir)
    }
  } finally {
    // Mesmo que algo falhe, voltar a arrancar (nunca deixar a app parada).
    console.log('A arrancar o Supabase…')
    try { run('npx', ['supabase', 'start']) } catch (err) { console.error(`AVISO: corre "npm run db:start": ${msg(err)}`) }
  }

  console.log(`✓ Restaurado o snapshot ${target.name}. Confirma os teus dados na app.`)
  process.exit(0)
}

main().catch((err) => {
  console.error('ERRO no restauro:', msg(err))
  process.exit(1)
})
