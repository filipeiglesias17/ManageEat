// Tudo o que depende do sistema operativo: arrancar o Docker, gerar os atalhos
// de duplo clique e instalar/remover o auto-arranque no login.
//
// macOS é testado a fundo (é a máquina que temos). Windows e Linux estão
// escritos de forma defensiva mas POR VALIDAR em máquina real — se algo falhar
// nesses sistemas, as mensagens apontam sempre o comando manual equivalente.

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { projectRoot, info, ok, warn } from './state.mjs'

// ── Docker ───────────────────────────────────────────────────────────────────

// Mesmo teste de vida do scripts/db-backup.ts: se este comando responde, o
// daemon do Docker está pronto para trabalhar.
export function isDockerResponding() {
  try {
    execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// Tenta abrir o Docker sozinho. Devolve true se o pedido de arranque foi feito
// (o daemon ainda pode demorar a ficar pronto — quem espera é o chamador).
export function tryStartDocker() {
  if (process.platform === 'darwin') {
    // Docker Desktop primeiro; OrbStack como alternativa comum no macOS.
    for (const app of ['Docker', 'OrbStack']) {
      try {
        execFileSync('open', ['-a', app], { stdio: 'ignore' })
        info(`A abrir o ${app}…`)
        return true
      } catch {
        // Essa app não está instalada — tenta a seguinte.
      }
    }
    return false
  }
  if (process.platform === 'win32') {
    const exe = path.join(
      process.env.ProgramFiles ?? 'C:\\Program Files',
      'Docker', 'Docker', 'Docker Desktop.exe',
    )
    if (existsSync(exe)) {
      spawn(exe, [], { detached: true, stdio: 'ignore' }).unref()
      info('A abrir o Docker Desktop…')
      return true
    }
    return false
  }
  // Linux: o Docker é um serviço do sistema. Sem permissões isto falha — nesse
  // caso devolvemos false e o chamador mostra o comando manual (com sudo);
  // nunca pedimos sudo às escondidas.
  try {
    execFileSync('systemctl', ['start', 'docker'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export function dockerInstructions() {
  if (process.platform === 'darwin') {
    return 'Abre o Docker Desktop (ícone da baleia) e espera que fique "running". Se não o tens: https://docker.com/products/docker-desktop'
  }
  if (process.platform === 'win32') {
    return 'Abre o Docker Desktop no menu Iniciar e espera que fique "running". Se não o tens: https://docker.com/products/docker-desktop'
  }
  return 'Arranca o serviço do Docker:  sudo systemctl start docker  (instalar: https://docs.docker.com/engine/install/)'
}

export function mkcertInstructions() {
  if (process.platform === 'darwin') {
    return 'Instala com:  brew install mkcert nss  (o nss é para o Firefox confiar na CA)'
  }
  if (process.platform === 'win32') {
    return 'Instala com:  winget install FiloSottile.mkcert  (ou choco install mkcert)'
  }
  return 'Instala o mkcert (https://github.com/FiloSottile/mkcert/releases) e o pacote libnss3-tools:  sudo apt install libnss3-tools'
}

export function portDiagnosticCommand(port) {
  if (process.platform === 'win32') {
    return `netstat -ano | findstr ${port}`
  }
  return `lsof -i :${port}`
}

// ── Parar árvores de processos ───────────────────────────────────────────────

// Os filhos (vite, proxy) arrancam com processos-netos próprios; matar só o PID
// de topo deixava órfãos pendurados nas portas. Em POSIX cada filho tem o seu
// process group (spawn com detached:true) e matamos o grupo inteiro (-pid);
// no Windows o taskkill /T trata da árvore.
export function killTree(pid) {
  if (!pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    // O grupo pode já não existir; tenta o processo sozinho.
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // Já morreu — era isso que queríamos.
    }
  }
}

// Último recurso para quem sobrevive ao SIGTERM (processo preso ou a ignorar
// o sinal): SIGKILL não é ignorável.
export function forceKillTree(pid) {
  if (!pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Já morreu.
    }
  }
}

// Antes de matar (ou confiar em) um PID guardado no estado, confirma que ele
// ainda é um processo NOSSO: depois de um crash o sistema pode ter dado o
// mesmo número a outro programa. `pattern` é um pedaço da linha de comando
// esperada (ex.: 'manage-eat.mjs', 'vite', 'tls-proxy'). No Windows não há
// `ps` — aí confiamos no par PID + boot da máquina.
export function looksLikeOurProcess(pid, pattern) {
  if (!pid) return false
  if (process.platform === 'win32') return true
  try {
    const command = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf-8' })
    return command.includes(pattern)
  } catch {
    return false
  }
}

// ── Atalhos de duplo clique ──────────────────────────────────────────────────

function shellQuote(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

// Onde escrever os atalhos: no Ambiente de Trabalho, para o dono do restaurante
// os ver. Com --dry-run escrevemos TODAS as variantes (macOS+Windows+Linux) em
// launcher-apps/ na raiz, para inspecionar o resultado sem tocar no Desktop.
function targetFolder(dryRun) {
  if (dryRun) return path.join(projectRoot, 'launcher-apps')
  const desktop = path.join(os.homedir(), 'Desktop')
  return existsSync(desktop) ? desktop : path.join(projectRoot, 'launcher-apps')
}

export function generateShortcuts({ dryRun = false } = {}) {
  const folder = targetFolder(dryRun)
  mkdirSync(folder, { recursive: true })

  const created = []
  if (dryRun || process.platform === 'darwin') {
    created.push(generateMacosApp(folder, 'ManageEat', 'start'))
    created.push(generateMacosApp(folder, 'Parar ManageEat', 'stop'))
  }
  if (dryRun || process.platform === 'win32') {
    created.push(generateWindowsBat(folder, 'ManageEat', 'start'))
    created.push(generateWindowsBat(folder, 'Parar ManageEat', 'stop'))
  }
  if (dryRun || process.platform === 'linux') {
    created.push(generateLinuxShortcut(folder, 'ManageEat', 'start', dryRun))
    created.push(generateLinuxShortcut(folder, 'Parar ManageEat', 'stop', dryRun))
  }

  ok(`Atalhos criados em: ${folder}`)
  for (const f of created) console.log(`    ${path.basename(f)}`)
  if (process.platform === 'darwin' && !dryRun) {
    info('No 1.º duplo clique o macOS pergunta se o ManageEat pode controlar o Terminal — responde OK (só pede uma vez).')
  }
  if (process.platform === 'linux' && !dryRun) {
    info('No GNOME pode ser preciso clicar com o botão direito no atalho e escolher "Permitir execução" na primeira vez.')
  }
  return folder
}

// macOS: uma .app não precisa de Xcode — é só uma pasta com Info.plist e um
// executável. O executável é um script zsh que manda o Terminal abrir e correr
// o launcher (o restaurante PRECISA de ver a janela: é onde estão as mensagens
// e é o botão de desligar). Criada localmente não leva quarantine/Gatekeeper.
function generateMacosApp(folder, name, subcommand) {
  const appDir = path.join(folder, `${name}.app`)
  const macosDir = path.join(appDir, 'Contents', 'MacOS')
  rmSync(appDir, { recursive: true, force: true })
  mkdirSync(macosDir, { recursive: true })

  const bundleId = subcommand === 'start' ? 'com.manageeat.launcher.start' : 'com.manageeat.launcher.stop'
  writeFileSync(
    path.join(appDir, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleName</key><string>${name}</string>
  <key>CFBundleIdentifier</key><string>${bundleId}</string>
  <key>CFBundleExecutable</key><string>launch</string>
</dict>
</plist>
`,
  )

  const shellCommand = `cd ${shellQuote(projectRoot)} && node scripts/launcher/manage-eat.mjs ${subcommand}`
  // O comando vai dentro de uma string AppleScript entre aspas duplas — é
  // preciso escapar \ e " para o osascript não o partir.
  const appleScriptCommand = shellCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const appleScript = [
    'tell application "Terminal"',
    '  activate',
    `  do script "${appleScriptCommand}"`,
    'end tell',
  ].join('\n')

  const execPath = path.join(macosDir, 'launch')
  writeFileSync(execPath, `#!/bin/zsh\nexec /usr/bin/osascript -e ${shellQuote(appleScript)}\n`)
  chmodSync(execPath, 0o755)
  return appDir
}

// Windows (POR VALIDAR em máquina real): .bat de duplo clique. O chcp 65001
// põe a consola em UTF-8 para os acentos das mensagens; o pause segura a
// janela aberta quando há erro.
function generateWindowsBat(folder, name, subcommand) {
  const batPath = path.join(folder, `${name}.bat`)
  writeFileSync(
    batPath,
    [
      '@echo off',
      'chcp 65001 >nul',
      `cd /d "${projectRoot}"`,
      `node scripts\\launcher\\manage-eat.mjs ${subcommand}`,
      'pause',
      '',
    ].join('\r\n'),
  )
  return batPath
}

// Linux (POR VALIDAR em máquina real): um .sh executável + um .desktop com
// Terminal=true que o chama. O .desktop também é copiado para
// ~/.local/share/applications para aparecer no menu de aplicações.
function generateLinuxShortcut(folder, name, subcommand, dryRun) {
  const slug = subcommand === 'start' ? 'manage-eat' : 'manage-eat-parar'
  const shPath = path.join(folder, `${slug}.sh`)
  writeFileSync(
    shPath,
    `#!/bin/sh\ncd ${shellQuote(projectRoot)} || exit 1\nexec node scripts/launcher/manage-eat.mjs ${subcommand}\n`,
  )
  chmodSync(shPath, 0o755)

  const desktopPath = path.join(folder, `${name}.desktop`)
  writeFileSync(
    desktopPath,
    [
      '[Desktop Entry]',
      'Type=Application',
      `Name=${name}`,
      'Comment=POS ManageEat',
      // Aspas obrigatórias: sem elas, um caminho com espaços é partido em
      // programa + argumentos pela spec do freedesktop.
      `Exec="${shPath}"`,
      'Terminal=true',
      '',
    ].join('\n'),
  )
  chmodSync(desktopPath, 0o755)

  if (!dryRun && process.platform === 'linux') {
    const appsDir = path.join(os.homedir(), '.local', 'share', 'applications')
    try {
      mkdirSync(appsDir, { recursive: true })
      copyFileSync(desktopPath, path.join(appsDir, `${slug}.desktop`))
    } catch {
      warn('Não consegui copiar o atalho para ~/.local/share/applications (não faz mal — o do Desktop funciona).')
    }
  }
  return desktopPath
}

// ── Auto-arranque no login ───────────────────────────────────────────────────

const LAUNCHD_LABEL = 'com.manageeat.launcher'

// Helpers copiados do scripts/install-backup-schedule.ts (o padrão launchd já
// validado do backup diário) — se mudares lá, muda aqui.
function tryLaunchctl(args) {
  try {
    execFileSync('launchctl', args, { stdio: 'ignore' })
  } catch {
    // Pode não estar carregado — não é erro.
  }
}
function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function installAutostart() {
  if (process.platform === 'darwin') {
    const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`)
    const logPath = path.join(projectRoot, 'launcher.log')
    // zsh -lc para herdar o PATH normal (node/npm/docker) — o launchd corre com
    // um PATH mínimo. Sem KeepAlive: o próprio launcher supervisiona os filhos,
    // e com KeepAlive o Stop teria de lutar contra o launchd.
    const command = `cd ${shellQuote(projectRoot)} && node scripts/launcher/manage-eat.mjs start`
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>${escapeXml(command)}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key><string>${escapeXml(logPath)}</string>
</dict>
</plist>
`
    mkdirSync(path.dirname(plistPath), { recursive: true })
    writeFileSync(plistPath, plist)
    tryLaunchctl(['unload', '-w', plistPath])
    execFileSync('launchctl', ['load', '-w', plistPath], { stdio: 'inherit' })
    ok('Auto-arranque instalado: o ManageEat arranca sozinho quando ligares o Mac.')
    info(`Ver:  launchctl list | grep ${LAUNCHD_LABEL}   ·   Log:  launcher.log`)
    info('Dica: no Docker Desktop ativa "Start Docker Desktop when you sign in" — o launcher espera até 2 minutos por ele.')
    return
  }
  if (process.platform === 'win32') {
    // POR VALIDAR: .bat na pasta Startup corre no login com a consola visível.
    const startup = path.join(
      process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
      'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup',
    )
    mkdirSync(startup, { recursive: true })
    generateWindowsBat(startup, 'ManageEat', 'start')
    ok(`Auto-arranque instalado (atalho em ${startup}).`)
    info('Alternativa mais avançada, sem consola: schtasks /create /sc onlogon (não automatizado).')
    return
  }
  // Linux (POR VALIDAR): XDG autostart. Alguns ambientes de desktop ignoram o
  // Terminal=true no autostart — por isso o .sh manda o output para launcher.log.
  // Ficheiro próprio (…-autostart.sh), separado do atalho do Desktop, que não
  // redireciona o output: são conteúdos diferentes, nunca partilhar o mesmo .sh.
  const autostartDir = path.join(os.homedir(), '.config', 'autostart')
  mkdirSync(autostartDir, { recursive: true })
  const shPath = path.join(projectRoot, 'launcher-apps', 'manage-eat-autostart.sh')
  mkdirSync(path.dirname(shPath), { recursive: true })
  writeFileSync(
    shPath,
    `#!/bin/sh\ncd ${shellQuote(projectRoot)} || exit 1\nexec node scripts/launcher/manage-eat.mjs start >> launcher.log 2>&1\n`,
  )
  chmodSync(shPath, 0o755)
  writeFileSync(
    path.join(autostartDir, 'manage-eat.desktop'),
    [
      '[Desktop Entry]',
      'Type=Application',
      'Name=ManageEat',
      // Aspas: um caminho com espaços seria partido em programa + argumentos.
      `Exec="${shPath}"`,
      'Terminal=true',
      '',
    ].join('\n'),
  )
  ok('Auto-arranque instalado em ~/.config/autostart/manage-eat.desktop.')
}

export function removeAutostart() {
  if (process.platform === 'darwin') {
    const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`)
    tryLaunchctl(['unload', '-w', plistPath])
    rmSync(plistPath, { force: true })
    ok('Auto-arranque removido.')
    return
  }
  if (process.platform === 'win32') {
    const startup = path.join(
      process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
      'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup',
    )
    rmSync(path.join(startup, 'ManageEat.bat'), { force: true })
    ok('Auto-arranque removido.')
    return
  }
  rmSync(path.join(os.homedir(), '.config', 'autostart', 'manage-eat.desktop'), { force: true })
  ok('Auto-arranque removido.')
}
