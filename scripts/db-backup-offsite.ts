// Cópia OFF-SITE do último snapshot: leva uma cópia dos dados para FORA da
// máquina do restaurante (pen/USB, disco de rede/NAS, pasta montada na cloud).
//
// Porquê: os snapshots de `npm run db:backup` vivem em `backups/`, no MESMO
// disco que a base de dados que protegem. Um disco morto, roubo ou ransomware
// leva os dados E os backups juntos. Este script resolve isso copiando o
// snapshot mais recente para um destino externo — a segunda cópia, noutro sítio.
//
// Regra de ouro (igual ao resto dos backups): NUNCA travar o fluxo. Se o destino
// não estiver configurado ou não estiver acessível (a pen não está espetada, o
// NAS está em baixo), este script AVISA e sai com sucesso (exit 0). Nunca pode
// impedir o restaurante de abrir nem falhar um job agendado.
//
// Configuração:
//   MANAGE_EAT_OFFSITE_BACKUP_DIR   pasta de destino (ex.: /Volumes/BackupUSB/manage-eat)
//   MANAGE_EAT_OFFSITE_KEEP         (opcional) quantas cópias manter no destino.
//                                   Por omissão NÃO apaga nada no destino externo
//                                   (mais seguro em media que o utilizador controla).
//
// Uso:  npm run db:backup:offsite

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const BACKUP_ROOT = path.resolve('backups')
const destRoot = process.env.MANAGE_EAT_OFFSITE_BACKUP_DIR?.trim()
const keepRaw = process.env.MANAGE_EAT_OFFSITE_KEEP
const keep = keepRaw ? Number(keepRaw) : null

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// Avisa e SAI COM SUCESSO. É o contrato deste script: uma cópia off-site em falta
// nunca pode travar nada (nem um arranque, nem um job agendado).
function skip(message: string): never {
  console.warn(`[offsite] ${message}`)
  process.exit(0)
}

// O snapshot mais recente é a última pasta (por ordem do nome ISO) que tenha um
// manifest.json — o mesmo critério que db-backup.ts usa para o prune.
function latestSnapshot(): string | null {
  if (!existsSync(BACKUP_ROOT)) return null
  const dirs = readdirSync(BACKUP_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(BACKUP_ROOT, d.name, 'manifest.json')))
    .map((d) => d.name)
    .sort()
  return dirs.length > 0 ? dirs[dirs.length - 1] : null
}

// Testa se o destino é mesmo utilizável: cria a pasta e escreve/apaga um ficheiro
// de prova. Um destino inacessível (pen fora, NAS em baixo) cai no catch → skip.
function assertWritable(dir: string): void {
  mkdirSync(dir, { recursive: true })
  const probe = path.join(dir, '.manage-eat-offsite-probe')
  writeFileSync(probe, 'ok')
  rmSync(probe, { force: true })
}

// Mantém só as últimas `keep` cópias no destino (só quando MANAGE_EAT_OFFSITE_KEEP
// está definido). Por omissão não apagamos nada em media externa.
function pruneDest(): void {
  if (keep === null || !Number.isFinite(keep) || keep <= 0) return
  const dirs = readdirSync(destRoot as string, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(destRoot as string, d.name, 'manifest.json')))
    .map((d) => d.name)
    .sort()
  const excess = dirs.slice(0, Math.max(0, dirs.length - keep))
  for (const name of excess) {
    rmSync(path.join(destRoot as string, name), { recursive: true, force: true })
    console.log(`[offsite] Cópia antiga removida no destino: ${name}`)
  }
}

function main(): void {
  if (!destRoot) {
    skip(
      'MANAGE_EAT_OFFSITE_BACKUP_DIR não está definida — sem cópia off-site. ' +
      'Aponta-a para uma pasta externa (pen/NAS) no .env.local ou no ambiente ' +
      'para ativar a segunda cópia dos dados.',
    )
  }

  const stamp = latestSnapshot()
  if (!stamp) {
    skip('ainda não há nenhum snapshot em backups/ para copiar. Corre "npm run db:backup" primeiro.')
  }

  try {
    assertWritable(destRoot)
  } catch (err) {
    skip(`o destino off-site não está acessível/gravável (${destRoot}): ${msg(err)}. ` +
      'Confirma que a pen/disco está ligado.')
  }

  const src = path.join(BACKUP_ROOT, stamp)
  const dest = path.join(destRoot, stamp)

  // Idempotente: se esta cópia já existe no destino, não a refazemos (ex.: o
  // agendador correu duas vezes sem um snapshot novo pelo meio).
  if (existsSync(path.join(dest, 'manifest.json'))) {
    console.log(`✓ Off-site já tinha o snapshot mais recente (${stamp}). Nada a fazer.`)
    pruneSafely()
    return
  }

  try {
    cpSync(src, dest, { recursive: true })
  } catch (err) {
    // Falhou a meio → não deixar uma cópia parcial (seria confundida com boa).
    rmSync(dest, { recursive: true, force: true })
    skip(`não consegui copiar o snapshot para o destino off-site: ${msg(err)}`)
  }

  const bytes = dirSize(dest)
  console.log(`✓ Cópia off-site guardada: ${dest} (${(bytes / (1024 * 1024)).toFixed(1)} MB)`)
  pruneSafely()
}

// A limpeza de cópias antigas nunca é motivo para falhar.
function pruneSafely(): void {
  try {
    pruneDest()
  } catch (err) {
    console.warn(`[offsite] AVISO: não consegui limpar cópias antigas no destino: ${msg(err)}`)
  }
}

function dirSize(dir: string): number {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) total += dirSize(p)
    else total += safeSize(p)
  }
  return total
}

function safeSize(file: string): number {
  try { return statSync(file).size } catch { return 0 }
}

main()
