// Agenda um backup automático DIÁRIO no macOS (launchd), para os dados ficarem
// protegidos mesmo com a app/terminal fechados.
//
// Porquê launchd e não cron: é o mecanismo nativo do macOS, persiste entre
// reinícios e corre no arranque/wake. Usamos um login shell (`zsh -lc`) para o
// job herdar o PATH normal (node/npm/docker) — o launchd corre com um PATH mínimo.
//
// Pré-requisito: o Docker Desktop tem de estar a correr à hora agendada; senão o
// backup desse dia falha (fica em backups/cron.log). Os backups antes de
// db:reset e a cada db:start cobrem o uso normal mesmo sem isto.
//
// Uso:  npm run db:schedule:install     (ativar)
//       npm run db:schedule:uninstall   (desativar)
//       BACKUP_HOUR=4 npm run db:schedule:install   (hora à escolha; default 3h)

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const LABEL = 'com.manageeat.dbbackup'
const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)
const projectDir = process.cwd()
const hour = Number(process.env.BACKUP_HOUR ?? 3)
const uninstall = process.argv.includes('--uninstall')

if (process.platform !== 'darwin') {
  console.error('O agendador automático só está implementado para macOS (launchd).')
  console.error('Nas outras camadas (db:reset e db:start) o backup automático funciona à mesma.')
  process.exit(1)
}

function tryLaunchctl(a: string[]) {
  try { execFileSync('launchctl', a, { stdio: 'ignore' }) } catch { /* pode não estar carregado */ }
}
function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

if (uninstall) {
  tryLaunchctl(['unload', '-w', plistPath])
  if (existsSync(plistPath)) rmSync(plistPath)
  console.log('✓ Backup agendado removido.')
  process.exit(0)
}

const logPath = path.join(projectDir, 'backups', 'cron.log')
// Depois do snapshot local, tenta a cópia off-site (2.ª cópia fora da máquina).
// Usamos `;` e não `&&`: a cópia off-site NUNCA pode marcar o job diário como
// falhado — se a pen/NAS não estiver lá, ela só avisa e sai com sucesso.
const command = `cd ${shellQuote(projectDir)} && npm run db:backup -- --auto --reason scheduled; npm run db:backup:offsite`

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>${escapeXml(command)}</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key><string>${escapeXml(logPath)}</string>
</dict>
</plist>
`

mkdirSync(path.dirname(plistPath), { recursive: true })
mkdirSync(path.join(projectDir, 'backups'), { recursive: true })
writeFileSync(plistPath, plist)

// Recarrega (unload + load) para apanhar alterações se já existir.
tryLaunchctl(['unload', '-w', plistPath])
execFileSync('launchctl', ['load', '-w', plistPath], { stdio: 'inherit' })

const hh = String(hour).padStart(2, '0')
console.log(`✓ Backup diário agendado (~${hh}:00) via launchd.`)
console.log(`  Ver:    launchctl list | grep ${LABEL}`)
console.log(`  Log:    backups/cron.log`)
console.log(`  Tirar:  npm run db:schedule:uninstall`)
console.log('  Nota:   precisa do Docker Desktop a correr à hora agendada.')
