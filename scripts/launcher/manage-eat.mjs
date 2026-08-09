#!/usr/bin/env node
// O "botão de play" do ManageEat: um único comando que prepara a máquina na
// primeira vez (npm install, certificados, .env.local) e no dia-a-dia arranca
// tudo (base de dados, frontend, proxy HTTPS) com verificações de saúde.
//
// Uso:  node scripts/launcher/manage-eat.mjs [start|stop|status|shortcuts|autostart]
//   start       arranca tudo (default). Deixa a janela aberta a supervisionar.
//   stop        para tudo (frontend, proxy e base de dados). --keep-db deixa a BD.
//   status      mostra o que está a correr e o que não está.
//   shortcuts   cria os atalhos de duplo clique no Ambiente de Trabalho.
//               --dry-run escreve todas as variantes em launcher-apps/.
//   autostart   --install liga o auto-arranque no login; --uninstall desliga.
//
// Funciona logo a seguir ao git clone (só precisa de Node 20+): é .mjs puro,
// sem dependências  o npm install é um dos passos que ele próprio corre.

import {
  projectRoot, VITE_PORT, SUPABASE_HTTP_PORT, STAFF_TLS_PORT, STUDIO_PORT,
  isInteractive, readState, writeState, isPidAlive, currentBootTime, isSameBoot,
  info, ok, warn, fail,
} from './state.mjs'
import {
  checkNodeVersion, ensureDockerRunning, ensureDependencies, ensureCertificates,
  ensureSupabase, ensureEnvLocal, offerSeed, checkLanIpChange, checkPortsFree,
  startChildren, run, isPortBusy, httpGet, waitUntil, bestLanIp,
  isSupabaseRunning, latestSnapshot, latestOffsite,
} from './steps.mjs'
import {
  isDockerResponding, killTree, looksLikeOurProcess, generateShortcuts,
  installAutostart, removeAutostart,
} from './platform.mjs'

const args = process.argv.slice(2)
const command = args[0] ?? 'start'

// Um launcher do estado só é de confiança se: a máquina não reiniciou desde
// que o PID foi escrito (senão o número pode ter sido reciclado por outro
// programa), o PID está vivo, E a linha de comando dele ainda é o launcher.
function isStateLauncherAlive(state) {
  return isSameBoot(state) && isPidAlive(state.launcherPid) &&
    looksLikeOurProcess(state.launcherPid, 'manage-eat.mjs')
}

function clearLock() {
  // Só limpa se o lock ainda for NOSSO: um arranque concorrente que perdeu a
  // corrida não pode apagar o lock do vencedor.
  if (readState().launcherPid === process.pid) {
    writeState({ launcherPid: null, children: null })
  }
}

function printUrls(ip) {
  console.log(`    Nesta máquina:       http://localhost:${VITE_PORT}`)
  console.log(`    Telemóveis/tablets:  http://${ip}:${VITE_PORT}`)
  console.log(`    Supabase Studio:     http://127.0.0.1:${STUDIO_PORT}`)
}

//  start

async function startCommand() {
  console.log('ManageEat — a arrancar…\n')

  // Lock de instância única: se já há um launcher vivo, não arrancamos outro.
  const state = readState()
  if (isStateLauncherAlive(state)) {
    ok('O ManageEat já está a correr — não é preciso fazer nada.')
    printUrls(state.lastLanIp ?? bestLanIp())
    return
  }
  if (await isPortBusy(VITE_PORT)) {
    // Porta ocupada mas sem launcher registado: pode ser um `npm run dev`
    // manual ou restos de um crash  não é seguro assumir que está tudo bem.
    warn(`Há algo a responder na porta ${VITE_PORT}, mas não parece ser um launcher supervisionado.`)
    warn('Se foi um arranque manual (npm run dev), está tudo bem. Para recomeçar do zero: npm run launcher:stop e volta a abrir.')
    printUrls(state.lastLanIp ?? bestLanIp())
    return
  }
  writeState({
    launcherPid: process.pid,
    bootTime: currentBootTime(),
    startedAt: new Date().toISOString(),
    children: null,
  })
  // Re-verificação anti-corrida: se dois arranques escreveram o lock quase ao
  // mesmo tempo, só continua aquele cujo PID ficou gravado.
  if (readState().launcherPid !== process.pid) {
    ok('Outro arranque do ManageEat ganhou a corrida — deixo-o continuar.')
    return
  }

  let children = null
  let terminating = false
  const terminate = async (code) => {
    if (terminating) return
    terminating = true
    // O try/catch protege contra EPIPE: ao fechar a janela do Terminal o
    // stdout pode já não existir quando o SIGHUP chega.
    try { console.log('') } catch { /* janela já fechada */ }
    try { info('A parar o ManageEat…') } catch { /* idem */ }
    // stop() espera pelos filhos (e escala para SIGKILL) ANTES de o estado
    // perder os PIDs  senão um filho sobrevivente ficava incontactável.
    if (children) await children.stop()
    clearLock()
    try { ok('ManageEat parado. Até já!') } catch { /* idem */ }
    process.exit(code)
  }

  // Sinais registados JÁ, antes dos passos longos: fechar a janela (SIGHUP),
  // Ctrl+C (SIGINT) ou o comando stop (SIGTERM) durante o setup fazem uma
  // paragem limpa em vez de matar o launcher a meio sem arrumar nada.
  // (Durante um passo bloqueante, o sinal fica pendente e é atendido no fim.)
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => { void terminate(0) })
  }

  try {
    checkNodeVersion()
    await ensureDockerRunning()
    ensureDependencies()
    ensureCertificates()
    await ensureSupabase()
    const { env, justCreated } = await ensureEnvLocal({ interactive: isInteractive })
    await offerSeed({ env, justCreated, interactive: isInteractive })
    const ip = await checkLanIpChange({ interactive: isInteractive })
    await checkPortsFree()

    children = startChildren({ onGiveUp: () => { void terminate(1) } })

    console.log('')
    ok('Tudo pronto! O ManageEat está a funcionar.')
    printUrls(ip)
    console.log('')
    info('Deixa esta janela aberta. Fechar a janela (ou Ctrl+C) pára o frontend e o proxy; a base de dados continua.')
    info('Para parar TUDO (e garantir o snapshot da manhã seguinte): "Parar ManageEat" ou npm run launcher:stop.')
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err))
    clearLock()
    process.exitCode = 1
  }
}

//  stop

async function stopCommand() {
  const keepDb = args.includes('--keep-db')
  const state = readState()

  if (isStateLauncherAlive(state)) {
    info('A pedir ao launcher para parar o frontend e o proxy…')
    try { process.kill(state.launcherPid, 'SIGTERM') } catch { /* já morreu */ }
    // O launcher pode estar a meio de uma operação bloqueante (ex.: o snapshot
    // do arranque)  o sinal só é atendido quando ela acabar, por isso a
    // espera é generosa. Se mesmo assim não morrer, NÃO limpamos o estado
    // (senão perdíamos o único registo dos processos dele).
    const died = await waitUntil(() => !isPidAlive(state.launcherPid), 180_000, 1000)
    if (!died) {
      fail('O launcher não parou (pode estar preso). Vê "npm run launcher:status" e tenta de novo.')
      process.exitCode = 1
      return
    }
  } else if (state.children && isSameBoot(state)) {
    // O launcher morreu sem limpar (ex.: crash)  matamos os filhos órfãos,
    // mas só depois de confirmar que cada PID ainda é MESMO um processo nosso
    // (após um crash o sistema pode ter dado o número a outro programa).
    const patterns = { vite: 'vite', tlsProxy: 'tls-proxy' }
    for (const [name, pid] of Object.entries(state.children)) {
      if (looksLikeOurProcess(pid, patterns[name] ?? 'manage-eat')) killTree(pid)
    }
  }

  if (keepDb) {
    info('(--keep-db) A base de dados fica a correr.')
  } else if (isDockerResponding()) {
    // Espera curta pelos contentores: se o stop apanhou um arranque a meio
    // (ex.: db:start acabado de terminar), eles podem aparecer já a seguir.
    const dbRunning = await waitUntil(() => isSupabaseRunning(), 6_000, 1500)
    if (dbRunning) {
      info('A parar a base de dados (os dados ficam todos guardados)…')
      try {
        run('npx', ['supabase', 'stop'])
      } catch {
        warn('Não consegui parar a base de dados — corre "npm run db:stop" à mão.')
      }
    }
  }

  writeState({ launcherPid: null, children: null })

  const frontendAlive = await isPortBusy(VITE_PORT)
  const proxyAlive = await isPortBusy(STAFF_TLS_PORT)
  if (frontendAlive || proxyAlive) {
    warn('Ainda há algo a responder nas portas da app — dá-lhe uns segundos e corre "npm run launcher:status".')
  } else {
    ok('ManageEat parado por completo. Já podes desligar a máquina.')
  }
}

//  status

async function statusCommand() {
  const state = readState()
  const line = (name, good, hint) => {
    console.log(`  ${good ? '✓' : '✖'} ${name}${good || !hint ? '' : `  →  ${hint}`}`)
  }

  console.log('Estado do ManageEat:\n')
  const docker = isDockerResponding()
  line('Docker', docker, 'abre o Docker Desktop')
  const supabase = docker && (await httpGet(`http://127.0.0.1:${SUPABASE_HTTP_PORT}/`)) !== null
  line('Base de dados (Supabase)', supabase, 'npm run launcher:start')
  line('Frontend (porta 5173)', await isPortBusy(VITE_PORT), 'npm run launcher:start')
  line('Proxy HTTPS do staff (porta 54391)', await isPortBusy(STAFF_TLS_PORT), 'npm run launcher:start')

  console.log('')
  if (isStateLauncherAlive(state)) {
    ok(`Launcher a correr (PID ${state.launcherPid}, desde ${state.startedAt ?? '?'})`)
  } else {
    info('Launcher parado.')
  }

  const ip = bestLanIp()
  if (state.lastLanIp && state.lastLanIp !== ip) {
    warn(`O endereço na rede mudou desde o último arranque (${state.lastLanIp} → ${ip}).`)
  } else {
    info(`Endereço na rede local: ${ip}`)
  }

  const snapshot = latestSnapshot()
  if (snapshot) {
    info(`Último snapshot da base de dados: backups/${snapshot}`)
  } else {
    warn('Ainda não há snapshots em backups/ — o primeiro é criado no próximo arranque a frio.')
  }

  // Cópia off-site (2.ª cópia fora da máquina). Um snapshot local não chega se o
  // disco morrer/for roubado  avisamos se a cópia externa faltar ou estiver velha.
  const OFFSITE_ALERT_DAYS = 2
  const offsite = latestOffsite()
  if (!offsite) {
    warn('Sem cópia off-site: define MANAGE_EAT_OFFSITE_BACKUP_DIR (pen/NAS) para uma 2.ª cópia dos dados fora da máquina.')
  } else if (!offsite.latest) {
    warn(`Destino off-site definido (${offsite.dir}) mas ainda sem cópias — corre "npm run db:backup:offsite" com a pen/disco ligado.`)
  } else if (offsite.ageDays !== null && offsite.ageDays > OFFSITE_ALERT_DAYS) {
    warn(`Última cópia off-site tem ${offsite.ageDays} dias (${offsite.dir}/${offsite.latest}) — liga a pen/disco e corre "npm run db:backup:offsite".`)
  } else {
    info(`Última cópia off-site: ${offsite.dir}/${offsite.latest}`)
  }
}

//  despacho

function printHelp() {
  console.log('Uso:  node scripts/launcher/manage-eat.mjs [start|stop|status|shortcuts|autostart]')
  console.log('  start                 arranca tudo (default)')
  console.log('  stop [--keep-db]      para tudo; --keep-db deixa a base de dados a correr')
  console.log('  status                mostra o que está a correr')
  console.log('  shortcuts [--dry-run] cria os atalhos de duplo clique')
  console.log('  autostart --install | --uninstall   auto-arranque no login')
}

switch (command) {
  case 'start':
    await startCommand()
    break
  case 'stop':
    await stopCommand()
    break
  case 'status':
    await statusCommand()
    break
  case 'shortcuts':
    generateShortcuts({ dryRun: args.includes('--dry-run') })
    break
  case 'autostart':
    // Flag explícita obrigatória: instalar auto-arranque por omissão (ou por
    // um typo na flag) seria uma surpresa desagradável.
    if (args.includes('--uninstall')) removeAutostart()
    else if (args.includes('--install')) installAutostart()
    else {
      fail('Usa:  autostart --install  ou  autostart --uninstall')
      process.exitCode = 1
    }
    break
  default:
    fail(`Comando desconhecido: ${command}`)
    printHelp()
    process.exitCode = 1
}
