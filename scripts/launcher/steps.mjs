// Os passos do arranque do ManageEat, um por função, pela ordem em que o
// manage-eat.mjs os corre. Cada passo é idempotente: verifica o seu próprio
// artefacto (node_modules/, certs/, .env.local, …) e só age se ele faltar —
// por isso não há flag de "primeira vez", e um setup interrompido a meio
// retoma sozinho no arranque seguinte.

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline/promises'
import {
  projectRoot, VITE_PORT, SUPABASE_HTTP_PORT, STAFF_TLS_PORT,
  readState, writeState, isPidAlive, info, ok, warn, fail,
} from './state.mjs'
import {
  isDockerResponding, tryStartDocker, dockerInstructions, mkcertInstructions,
  portDiagnosticCommand, killTree, forceKillTree,
} from './platform.mjs'

// ── Utilitários ──────────────────────────────────────────────────────────────

// Corre um comando mostrando o output ao utilizador; lança erro se falhar.
// No Windows o npm/npx são ficheiros .cmd e precisam de uma shell.
export function run(command, args) {
  if (process.platform === 'win32') {
    const r = spawnSync([command, ...args].join(' '), { cwd: projectRoot, stdio: 'inherit', shell: true })
    if (r.status !== 0) throw new Error(`O comando "${command} ${args.join(' ')}" falhou.`)
    return
  }
  execFileSync(command, args, { cwd: projectRoot, stdio: 'inherit' })
}

// Corre um comando e devolve o stdout (sem mostrar nada ao utilizador).
export function capture(command, args) {
  if (process.platform === 'win32') {
    const r = spawnSync([command, ...args].join(' '), { cwd: projectRoot, encoding: 'utf-8', shell: true })
    if (r.status !== 0) throw new Error(`O comando "${command} ${args.join(' ')}" falhou.`)
    return r.stdout ?? ''
  }
  return execFileSync(command, args, { cwd: projectRoot, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
}

export function isPortBusy(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' })
    let answered = false
    const finish = (busy) => {
      if (answered) return
      answered = true
      socket.destroy()
      resolve(busy)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(1000, () => finish(false))
  })
}

// GET simples com timeout; devolve a Response ou null se não respondeu.
export async function httpGet(url, headers = {}) {
  try {
    return await fetch(url, { headers, signal: AbortSignal.timeout(3000) })
  } catch {
    return null
  }
}

export async function waitUntil(condition, timeoutMs, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return true
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return condition()
}

async function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(`${question} (s/N) `)
    return /^s(im)?$/i.test(answer.trim())
  } finally {
    rl.close()
  }
}

// ── Passos do arranque ───────────────────────────────────────────────────────

export function checkNodeVersion() {
  const major = Number(process.versions.node.split('.')[0])
  // ≥22 porque o cliente Supabase (realtime) exige o WebSocket nativo do Node;
  // com Node 20/21 o arranque passava aqui e rebentava mais à frente no seed.
  if (Number.isNaN(major) || major < 22) {
    throw new Error(
      `Este projeto precisa do Node 22 ou mais recente (tens a ${process.versions.node}). Descarrega em https://nodejs.org e volta a tentar.`,
    )
  }
}

export async function ensureDockerRunning() {
  if (isDockerResponding()) {
    ok('Docker a correr.')
    return
  }
  info('O Docker não está a correr — a tentar arrancá-lo…')
  tryStartDocker()
  info('A aguardar pelo Docker (até 2 minutos)… se não abrir sozinho, abre-o tu que eu espero.')
  const ready = await waitUntil(() => isDockerResponding(), 120_000, 2000)
  if (!ready) {
    throw new Error(`O Docker não respondeu. ${dockerInstructions()}`)
  }
  ok('Docker pronto.')
}

export function ensureDependencies() {
  if (existsSync(path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'))) return
  info('Primeira vez nesta máquina: a instalar as dependências (npm install)… pode demorar uns minutos.')
  run('npm', ['install'])
  ok('Dependências instaladas.')
}

export function ensureCertificates() {
  if (existsSync(path.join(projectRoot, 'certs', 'lan-cert.pem'))) return
  info('Ainda não há certificados HTTPS — vou criá-los.')
  try {
    execFileSync('mkcert', ['-version'], { stdio: 'ignore' })
  } catch {
    throw new Error(`Falta o mkcert (o programa que cria os certificados HTTPS). ${mkcertInstructions()} — depois volta a abrir o ManageEat.`)
  }
  run('npm', ['run', 'setup:https'])
}

// project_id do supabase/config.toml: os contentores e volumes do Supabase
// chamam-se supabase_db_<project_id>. Sem o id, um SEGUNDO projeto Supabase na
// mesma máquina seria confundido com o nosso.
function supabaseProjectId() {
  try {
    const config = readFileSync(path.join(projectRoot, 'supabase', 'config.toml'), 'utf-8')
    return config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1] ?? null
  } catch {
    return null
  }
}

// O contentor da BD DESTE projeto está a correr? (mesmo teste do scripts/db-backup.ts)
export function isSupabaseRunning() {
  const id = supabaseProjectId()
  try {
    return capture('docker', ['ps', '--format', '{{.Names}}'])
      .split('\n')
      .some((n) => (id ? n === `supabase_db_${id}` : /^supabase_db_/.test(n)))
  } catch {
    return false
  }
}

export async function ensureSupabase() {
  if (isSupabaseRunning()) {
    // Com a BD a correr NÃO passamos pelo db:start: o snapshot pré-arranque
    // pausaria a base de dados ~20-30s — inaceitável a meio do serviço. O
    // snapshot diário fica garantido pelo ciclo Stop à noite → Start de manhã.
    info('A base de dados já está a correr — só aplico migrações pendentes.')
    run('npx', ['supabase', 'migration', 'up', '--local'])
  } else {
    info('A arrancar a base de dados (primeiro guardo um snapshot de segurança)…')
    run('npm', ['run', 'db:start'])
  }
  // Confirmação de vida: qualquer resposta HTTP (mesmo um 404) prova que o
  // Supabase está de pé.
  const response = await httpGet(`http://127.0.0.1:${SUPABASE_HTTP_PORT}/`)
  if (response === null) {
    throw new Error(`A base de dados arrancou mas não responde na porta ${SUPABASE_HTTP_PORT}. Corre "npm run db:status" para veres o estado.`)
  }
  ok('Base de dados pronta.')
}

// ── .env.local ───────────────────────────────────────────────────────────────

const MANAGED_KEYS = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
const ENV_HEADER = '# Gerado pelo launcher do ManageEat. Variáveis opcionais: ver .env.example\n'

function readEnvFile(filePath) {
  if (!existsSync(filePath)) return {}
  const vars = {}
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m) continue
    vars[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1')
  }
  return vars
}

// Lê as chaves do Supabase local. Preferimos `supabase status -o env` (formato
// de máquina); o mapeamento é por SUFIXO do nome (API_URL, ANON_KEY, …) para
// aguentar variações entre versões da CLI. Fallback: o output humano.
function supabaseValues() {
  const bySuffix = (vars, suffix) => {
    const name = Object.keys(vars).find((n) => n.endsWith(suffix))
    return name ? vars[name] : undefined
  }
  let values = {}
  try {
    const vars = {}
    for (const line of capture('npx', ['supabase', 'status', '-o', 'env']).split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m) vars[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1')
    }
    values = {
      VITE_SUPABASE_URL: bySuffix(vars, 'API_URL'),
      VITE_SUPABASE_ANON_KEY: bySuffix(vars, 'ANON_KEY'),
      SUPABASE_SERVICE_ROLE_KEY: bySuffix(vars, 'SERVICE_ROLE_KEY'),
    }
  } catch {
    // segue para o fallback
  }
  if (!MANAGED_KEYS.every((k) => values[k])) {
    try {
      const humanOutput = capture('npx', ['supabase', 'status'])
      values = {
        VITE_SUPABASE_URL: values.VITE_SUPABASE_URL ?? humanOutput.match(/API URL:\s*(\S+)/)?.[1],
        VITE_SUPABASE_ANON_KEY: values.VITE_SUPABASE_ANON_KEY ?? humanOutput.match(/anon key:\s*(\S+)/)?.[1],
        SUPABASE_SERVICE_ROLE_KEY:
          values.SUPABASE_SERVICE_ROLE_KEY ?? humanOutput.match(/service_role key:\s*(\S+)/)?.[1],
      }
    } catch {
      // fica o que houver; o chamador decide
    }
  }
  return MANAGED_KEYS.every((k) => values[k]) ? values : null
}

// Substitui só as linhas das chaves geridas; comentários e variáveis opcionais
// (SEED_PASSWORD, etc.) ficam como estavam.
function writeEnvKeys(filePath, newValues) {
  let text = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : ENV_HEADER
  for (const [key, value] of Object.entries(newValues)) {
    const line = `${key}=${value}`
    const re = new RegExp(`^${key}=.*$`, 'm')
    text = re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`
  }
  writeFileSync(filePath, text)
}

export async function ensureEnvLocal({ interactive }) {
  const filePath = path.join(projectRoot, '.env.local')
  const existed = existsSync(filePath)
  const current = readEnvFile(filePath)
  const complete = MANAGED_KEYS.every((k) => current[k])
  const newValues = supabaseValues()

  if (complete) {
    // Já está preenchido. Só avisamos se as chaves reais divergirem (ex.:
    // Supabase reinstalado noutra máquina mudou o JWT).
    if (newValues && MANAGED_KEYS.some((k) => current[k] !== newValues[k])) {
      warn('As chaves do Supabase são diferentes das que estão no .env.local.')
      if (interactive && (await ask('Atualizar o .env.local com os valores atuais?'))) {
        writeEnvKeys(filePath, newValues)
        ok('.env.local atualizado.')
      } else {
        warn('Deixei o .env.local como estava. Se o login falhar, corre "npm run db:status" e compara os valores.')
      }
    }
    return { env: readEnvFile(filePath), justCreated: false }
  }

  if (!newValues) {
    throw new Error(
      'Não consegui ler as chaves do Supabase para criar o .env.local. Corre "npm run db:status" e preenche o .env.local à mão (modelo em .env.example).',
    )
  }
  writeEnvKeys(filePath, newValues)
  ok(existed ? '.env.local completado com as chaves do Supabase.' : '.env.local criado com as chaves do Supabase.')
  return { env: readEnvFile(filePath), justCreated: !existed }
}

// ── Seed (dados de exemplo) ──────────────────────────────────────────────────

// O seed sobrescreve settings (modo, preço do rodízio, IVA) — NUNCA pode correr
// numa BD com dados reais. Guarda dupla: só com terminal interativo E com a
// tabela profiles comprovadamente vazia (verificado na BD real, não num flag —
// apagar o ficheiro de estado não abre esta porta).
export async function offerSeed({ env, justCreated, interactive }) {
  if (!justCreated || !interactive) return
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  const response = await httpGet(`${env.VITE_SUPABASE_URL}/rest/v1/profiles?select=id&limit=1`, {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  })
  if (!response || !response.ok) return // sem certeza de que a BD está vazia → não oferecer
  const rows = await response.json().catch(() => null)
  if (!Array.isArray(rows) || rows.length > 0) return

  info('A base de dados está vazia.')
  if (await ask('Criar as contas de exemplo e o menu de demonstração (seed)?')) {
    run('npm', ['run', 'seed'])
  } else {
    info('Ok. Podes criar os dados de exemplo mais tarde com:  npm run seed')
  }
}

// ── IP da LAN ────────────────────────────────────────────────────────────────

// Deteção do melhor IP da LAN. Cópia deliberada de getLocalIP/scoreNetworkAddress
// do vite.config.ts — o launcher é .mjs puro e não consegue importar esse
// ficheiro. Se mudares a lógica lá, muda aqui.
export function bestLanIp() {
  const interfaces = os.networkInterfaces()
  const candidates = []
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      candidates.push({ name, address: entry.address })
    }
  }
  if (candidates.length === 0) return 'localhost'

  const score = (interfaceName, address) => {
    const name = interfaceName.toLowerCase()
    const looksVirtual =
      name.startsWith('utun') || name.startsWith('tun') || name.startsWith('tap') ||
      name.startsWith('wg') || name.startsWith('tailscale') || name.startsWith('zt') ||
      name.startsWith('bridge') || name.startsWith('docker') || name.startsWith('vbox') ||
      name.startsWith('vmnet')
    let points = looksVirtual ? 0 : 10
    // Preferência pelas gamas privadas típicas de uma LAN doméstica/comercial:
    // 192.168.x.x (a mais comum em routers) > 10.x.x.x > 172.16-31.x.x (a gama
    // privada menos usada) > 100.64-127.x.x (CGNAT de operadora — raramente é
    // a LAN real, por isso quase não pontua).
    if (address.startsWith('192.168.')) points += 4
    else if (address.startsWith('10.')) points += 3
    else if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(address)) points += 3
    else if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address)) points += 1
    return points
  }

  return candidates
    .map((c) => ({ ...c, points: score(c.name, c.address) }))
    .sort((a, b) => b.points - a.points)[0].address
}

export async function checkLanIpChange({ interactive }) {
  const current = bestLanIp()
  const previous = readState().lastLanIp
  if (previous && previous !== current) {
    warn(`ATENÇÃO: o endereço desta máquina na rede mudou (${previous} → ${current}).`)
    warn('QR codes impressos e apps nativas podem ainda apontar ao endereço antigo.')
    warn('Nos aparelhos que não liguem, usa o ecrã "Ligação ao servidor" para apontar ao novo.')
    if (
      interactive &&
      existsSync(path.join(projectRoot, 'certs', 'lan-cert.pem')) &&
      (await ask('Regenerar os certificados HTTPS para incluírem o endereço novo?'))
    ) {
      // A CA é a mesma — os aparelhos do staff não precisam de re-confiar em nada.
      run('npm', ['run', 'setup:https'])
    }
  }
  writeState({ lastLanIp: current })
  return current
}

export async function checkPortsFree() {
  const ports = [
    ['o frontend', VITE_PORT],
    ['o proxy HTTPS do staff', STAFF_TLS_PORT],
  ]
  for (const [label, port] of ports) {
    if (await isPortBusy(port)) {
      throw new Error(
        `A porta ${port} (${label}) já está ocupada por outro programa. Vê o que lá está com:  ${portDiagnosticCommand(port)}`,
      )
    }
  }
}

// ── Processos filhos (vite + proxy TLS) ──────────────────────────────────────

const CHILDREN = {
  vite: {
    label: 'Frontend (Vite)',
    // Chamamos o vite.js diretamente com o Node atual — evita os atalhos .cmd
    // do Windows e garante que é a mesma versão de Node.
    command: () => [process.execPath, [path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'), '--host']],
    fatalHint: 'O frontend não se aguenta a correr. Vê as mensagens acima; para investigar corre "npm run dev" à mão.',
  },
  tlsProxy: {
    label: 'Proxy HTTPS do staff',
    // npx tsx é o padrão do projeto para correr scripts TypeScript.
    command: () => (process.platform === 'win32'
      ? ['npx tsx scripts/tls-proxy.ts', null]
      : ['npx', ['tsx', 'scripts/tls-proxy.ts']]),
    fatalHint: 'O proxy HTTPS não se aguenta a correr. Se as mensagens acima falarem de certificados, corre "npm run setup:https".',
  },
}

// Arranca os dois processos e mantém-nos vivos: se um morrer, reinicia com
// espera crescente (2s, 4s, 8s…). Mais de 5 mortes em 5 minutos = há um
// problema real — desistimos com uma mensagem útil em vez de reiniciar às cegas.
export function startChildren({ onGiveUp }) {
  const processes = new Map()
  const history = new Map()
  let shuttingDown = false

  function writePids() {
    const children = {}
    for (const [name, proc] of processes) children[name] = proc.pid
    writeState({ children })
  }

  // Morte de um filho, venha do 'exit' ou do 'error' (o 'error' dispara quando
  // o próprio spawn falha — ex.: o node foi atualizado e o caminho antigo já
  // não existe — e nesse caso NÃO há 'exit'; sem este caminho o supervisor
  // rebentava com uma exceção não tratada).
  function onDeath(name, reason) {
    if (shuttingDown) return
    const spec = CHILDREN[name]
    const now = Date.now()
    const recent = (history.get(name) ?? []).filter((t) => now - t < 5 * 60_000)
    recent.push(now)
    history.set(name, recent)
    if (recent.length > 5) {
      fail(`${spec.label} parou ${recent.length} vezes em 5 minutos — desisto de reiniciar.`)
      fail(spec.fatalHint)
      onGiveUp()
      return
    }
    const delay = Math.min(2000 * 2 ** (recent.length - 1), 30_000)
    warn(`${spec.label} parou (${reason}). A reiniciar em ${Math.round(delay / 1000)}s…`)
    setTimeout(() => launch(name), delay)
  }

  function launch(name) {
    if (shuttingDown) return
    const spec = CHILDREN[name]
    const [cmd, args] = spec.command()
    const options = {
      cwd: projectRoot,
      stdio: 'inherit',
      // Em POSIX cada filho fica no seu process group, para conseguirmos parar
      // a árvore inteira (vite arranca esbuild e outros netos).
      detached: process.platform !== 'win32',
    }
    const proc = args === null ? spawn(cmd, { ...options, shell: true }) : spawn(cmd, args, options)
    processes.set(name, proc)
    writePids()

    // O guarda evita contar a mesma morte duas vezes quando 'error' e 'exit'
    // disparam ambos para o mesmo processo.
    let handled = false
    proc.on('exit', (code) => {
      if (handled) return
      handled = true
      onDeath(name, `código ${code}`)
    })
    proc.on('error', (err) => {
      if (handled) return
      handled = true
      onDeath(name, `falha ao arrancar: ${err.message}`)
    })
  }

  launch('vite')
  launch('tlsProxy')

  return {
    // Paragem em duas fases: SIGTERM educado, espera curta, e SIGKILL a quem
    // sobreviver — só depois é que o chamador pode limpar os PIDs do estado.
    async stop() {
      shuttingDown = true
      const pids = [...processes.values()].map((p) => p.pid).filter(Boolean)
      for (const pid of pids) killTree(pid)
      await waitUntil(() => pids.every((pid) => !isPidAlive(pid)), 5000, 250)
      for (const pid of pids) {
        if (isPidAlive(pid)) forceKillTree(pid)
      }
    },
  }
}

// ── Info para o status ───────────────────────────────────────────────────────

export function latestSnapshot() {
  const folder = path.join(projectRoot, 'backups')
  if (!existsSync(folder)) return null
  const names = readdirSync(folder, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(folder, d.name, 'manifest.json')))
    .map((d) => d.name)
    .sort()
  return names.at(-1) ?? null
}

// Estado da cópia OFF-SITE (2.ª cópia dos dados fora da máquina). Ver
// scripts/db-backup-offsite.ts. Devolve null se o destino não estiver
// configurado (env MANAGE_EAT_OFFSITE_BACKUP_DIR). Se estiver, devolve o
// destino, a cópia mais recente lá e a sua idade em dias (para o status avisar
// quando a última cópia externa está velha ou ainda não existe).
export function latestOffsite() {
  const dir = process.env.MANAGE_EAT_OFFSITE_BACKUP_DIR?.trim()
  if (!dir) return null
  if (!existsSync(dir)) return { dir, latest: null, ageDays: null }
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(dir, d.name, 'manifest.json')))
    .map((d) => d.name)
    .sort()
  const latest = names.at(-1) ?? null
  let ageDays = null
  if (latest) {
    try {
      const ms = Date.now() - statSync(path.join(dir, latest)).mtimeMs
      ageDays = Math.floor(ms / (1000 * 60 * 60 * 24))
    } catch {
      ageDays = null
    }
  }
  return { dir, latest, ageDays }
}
