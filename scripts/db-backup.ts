// Snapshot (backup) da base de dados local + ficheiros do Storage.
//
// Porquê assim: os dados vivem em DOIS volumes Docker — a BD (Postgres) e os
// ficheiros do Storage (imagens do menu, bundles OTA). Copiamos os DOIS no mesmo
// instante para um ponto de restauro consistente (a tabela storage.objects e os
// ficheiros têm de bater certo). É uma cópia byte-a-byte (tar dos volumes), por
// isso não precisa de `pg_dump` (que não está instalado no Mac) nem de secrets,
// e o restauro devolve o estado EXATO sem conflitos de chaves.
//
// Consistência: o snapshot é feito com a BD parada (quiescente).
//   - Supabase parado  -> copia a frio (instantâneo, sem downtime).
//   - Supabase a correr -> stop -> copia -> start (~20-30s de pausa).
// NUNCA usamos `supabase stop --no-backup` (isso apagaria o volume).
//
// Uso:  npm run db:backup           (snapshot manual)
//       ... --auto --reason X       (chamado pelos db:start / db:reset / agendador)
//       ... --keep N                (quantos snapshots manter; default 15)

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const isAuto = args.includes('--auto')
const reason = argValue('--reason') ?? 'manual'
const keep = Number(argValue('--keep') ?? process.env.BACKUP_KEEP ?? 15)

// O backup antes de um RESET é a rede de segurança crítica: se falhar, devemos
// BLOQUEAR (não apagar dados sem cópia). Os outros automáticos (arranque,
// agendador) nunca devem travar o fluxo do utilizador — falham com aviso.
const failFatal = !isAuto || reason === 'pre-reset'

const BACKUP_ROOT = path.resolve('backups')

function argValue(flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ── Docker / Supabase ──────────────────────────────────────────────────────
function dockerOut(a: string[]): string {
  return (execFileSync('docker', a, { encoding: 'utf-8' }) as string).trim()
}
function run(cmd: string, a: string[]) {
  execFileSync(cmd, a, { stdio: 'inherit' })
}

// project_id do supabase/config.toml: os volumes e contentores do Supabase
// chamam-se supabase_db_<project_id>. Filtrar pelo id exato é obrigatório —
// um SEGUNDO projeto Supabase na mesma máquina entraria no snapshot (e um
// restore poderia esmagá-lo).
function readProjectId(): string | null {
  try {
    const config = readFileSync(path.resolve('supabase', 'config.toml'), 'utf-8')
    return config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1] ?? null
  } catch {
    return null
  }
}
const PROJECT_ID = readProjectId()

// Volumes de dados que interessam: BD (Postgres) e Storage (ficheiros) DESTE projeto.
function listVolumes(): string[] {
  return dockerOut(['volume', 'ls', '--format', '{{.Name}}'])
    .split('\n')
    .filter((n) => n === `supabase_db_${PROJECT_ID}` || n === `supabase_storage_${PROJECT_ID}`)
}

function isRunning(): boolean {
  return dockerOut(['ps', '--format', '{{.Names}}'])
    .split('\n')
    .some((n) => n === `supabase_db_${PROJECT_ID}`)
}

// Imagem para correr o `tar`. TEM de ser GNU tar: o Storage do Supabase guarda
// os metadados de cada ficheiro em "extended attributes" (xattrs) e só o GNU tar
// os preserva. A imagem do Postgres traz BusyBox tar, que IGNORA xattrs em
// silêncio — restaurar com ela deixava as imagens a dar erro 500 (ENODATA).
// debian:stable-slim traz GNU tar; descarrega-se uma vez e fica em cache.
const TAR_IMAGE = 'debian:stable-slim'

function ensureTarImage() {
  try {
    dockerOut(['image', 'inspect', TAR_IMAGE])
  } catch {
    console.log(`[backup] A descarregar a imagem de apoio ${TAR_IMAGE} (só na 1.ª vez)…`)
    run('docker', ['pull', TAR_IMAGE])
  }
}

function backupVolume(vol: string, destDir: string) {
  // --xattrs --xattrs-include='user.*': preserva os metadados do Storage (senão as
  // imagens vinham sem o xattr e davam 500). --numeric-owner: preserva o dono do
  // PGDATA (senão o Postgres recusa arrancar). Volume montado em leitura (:ro).
  run('docker', [
    'run', '--rm',
    '-v', `${vol}:/vol:ro`,
    '-v', `${destDir}:/backup`,
    TAR_IMAGE,
    'tar', '--xattrs', '--xattrs-include=user.*', '--numeric-owner',
    '-czf', `/backup/${vol}.tgz`, '-C', '/vol', '.',
  ])
}

function sizeOf(file: string): number {
  try { return statSync(file).size } catch { return 0 }
}

// Mantém só os últimos `keep` snapshots (ordem cronológica pelo nome ISO).
function prune() {
  if (!existsSync(BACKUP_ROOT)) return
  const dirs = readdirSync(BACKUP_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(BACKUP_ROOT, d.name, 'manifest.json')))
    .map((d) => d.name)
    .sort()
  const excess = dirs.slice(0, Math.max(0, dirs.length - keep))
  for (const name of excess) {
    rmSync(path.join(BACKUP_ROOT, name), { recursive: true, force: true })
    console.log(`[backup] Snapshot antigo removido: ${name}`)
  }
}

function fail(message: string): never {
  if (failFatal) {
    console.error(`[backup] ERRO: ${message}`)
    process.exit(1)
  }
  // Automático não-crítico: avisa mas deixa o fluxo seguir (ex.: db:start).
  console.warn(`[backup] AVISO (continuo na mesma): ${message}`)
  process.exit(0)
}

function main() {
  try {
    dockerOut(['version', '--format', '{{.Server.Version}}'])
  } catch {
    fail('O Docker não está a responder. Abre o Docker Desktop e tenta de novo.')
  }

  if (!PROJECT_ID) {
    fail('não encontrei o project_id em supabase/config.toml — sem ele não sei quais volumes copiar.')
  }

  // O critério de "há dados para guardar" são os VOLUMES, não os contentores:
  // o `supabase stop` remove os contentores mas os dados ficam nos volumes —
  // e é exatamente aí (BD parada) que o snapshot a frio é perfeito. Só no
  // 1.º arranque de todos (sem volumes) é que não há nada para guardar.
  const volumes = listVolumes()
  if (volumes.length === 0) {
    console.log('[backup] Sem dados locais para guardar (Supabase não inicializado). Ignorado.')
    process.exit(0)
  }

  // Daqui para a frente TODAS as falhas passam pelo fail(): o contrato do
  // failFatal diz que um backup automático (pre-start/agendado) nunca pode
  // travar o arranque da app — ex.: `docker pull` sem internet não pode
  // impedir o restaurante de abrir.
  try {
    ensureTarImage()
  } catch (err) {
    fail(`não consegui preparar a imagem de apoio ${TAR_IMAGE}: ${msg(err)}`)
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const destDir = path.join(BACKUP_ROOT, stamp)
  try {
    mkdirSync(destDir, { recursive: true })
  } catch (err) {
    fail(`não consegui criar a pasta do snapshot: ${msg(err)}`)
  }

  const running = isRunning()
  let stopped = false

  try {
    if (running) {
      console.log('[backup] A pausar o Supabase para um snapshot consistente…')
      run('npx', ['supabase', 'stop'])
      stopped = true
    }
    for (const vol of volumes) {
      console.log(`[backup] A copiar volume ${vol}…`)
      backupVolume(vol, destDir)
    }
  } catch (err) {
    rmSync(destDir, { recursive: true, force: true })
    if (stopped) restart()
    fail(`falhou o snapshot: ${msg(err)}`)
  }

  if (stopped) restart()

  const volumesInfo = volumes.map((v) => ({ name: v, bytes: sizeOf(path.join(destDir, `${v}.tgz`)) }))
  try {
    writeFileSync(
      path.join(destDir, 'manifest.json'),
      JSON.stringify({ timestamp: stamp, createdAt: new Date().toISOString(), reason, tarImage: TAR_IMAGE, wasRunning: running, volumes: volumesInfo }, null, 2),
    )
  } catch (err) {
    // Sem manifest o snapshot não é restaurável — não vale a pena guardar lixo.
    rmSync(destDir, { recursive: true, force: true })
    fail(`não consegui escrever o manifest do snapshot: ${msg(err)}`)
  }

  try {
    prune()
  } catch (err) {
    // Falhar a limpeza de snapshots antigos nunca é razão para travar nada.
    console.warn(`[backup] AVISO: não consegui limpar snapshots antigos: ${msg(err)}`)
  }

  const totalMb = volumesInfo.reduce((s, v) => s + v.bytes, 0) / (1024 * 1024)
  console.log(`✓ Snapshot guardado: backups/${stamp} (${totalMb.toFixed(1)} MB · motivo: ${reason})`)
  process.exit(0)
}

// Garante que o Supabase volta a arrancar mesmo que o snapshot tenha falhado a
// meio (nunca deixar a app parada por causa de um backup).
function restart() {
  try {
    console.log('[backup] A arrancar o Supabase de novo…')
    run('npx', ['supabase', 'start'])
  } catch (err) {
    console.error(`[backup] AVISO: não consegui rearrancar o Supabase: ${msg(err)} — corre "npm run db:start".`)
  }
}

main()
