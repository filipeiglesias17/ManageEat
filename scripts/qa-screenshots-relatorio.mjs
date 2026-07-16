// Capturas de ecrã para o relatório TeSP (qa-artifacts/relatorio/*.png).
// Baseado no qa-smoke.mjs: cria dados QA temporários (mesa 96) e limpa tudo no fim.
// Uso: com a app a correr (launcher:start), `node scripts/qa-screenshots-relatorio.mjs`
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { chromium, expect } from '@playwright/test'

dotenv.config({ path: '.env.local' })

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const artifactsDir = path.join(repoRoot, 'qa-artifacts', 'relatorio')

const baseUrl = process.env.QA_BASE_URL ?? 'http://127.0.0.1:5173'
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const anonKey = process.env.VITE_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = process.env.SEED_PASSWORD ?? 'manageeat2026!'
const fechoOnly = process.argv.includes('--fecho-only')

if (!serviceKey) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY no .env.local.')
if (!anonKey) throw new Error('Falta VITE_SUPABASE_ANON_KEY no .env.local.')

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const cleanupStaff = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const kitchenStaff = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const runId = `relatorio-${Date.now()}`
const qrTable = 96
const qrSessionId = `${runId}-qr`
let menuItemNames = []
let browser
let cleanupStaffSignedIn = false
let kitchenStaffSignedIn = false

function usernameToEmail(username) {
  return `${username.trim().toLowerCase()}@manageeat.local`
}

async function newPage(options = {}) {
  const context = await browser.newContext({
    viewport: options.mobile ? { width: 390, height: 844 } : { width: 1440, height: 950 },
    isMobile: Boolean(options.mobile),
    deviceScaleFactor: 2, // imagens nítidas para impressão
  })
  // Override do servidor: o QA fala direto com o Supabase local (sem proxy TLS)
  await context.addInitScript(
    ([url]) => window.localStorage.setItem('manage-eat-server-override', url),
    [supabaseUrl],
  )
  return context.newPage()
}

async function shot(page, name) {
  if (fechoOnly && name !== 'relatorio-fecho-conta') return
  await mkdir(artifactsDir, { recursive: true })
  await page.screenshot({ path: path.join(artifactsDir, `${name}.png`), fullPage: false })
  console.log(`  ✓ ${name}.png`)
}

async function login(page, username) {
  await page.goto(baseUrl, { waitUntil: 'load' })
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible()
  await page.locator('input[autocomplete="username"]').fill(username)
  await page.locator('input[autocomplete="current-password"]').fill(password)
  await page.getByRole('button', { name: 'Entrar' }).click()
}

async function cleanupQaData() {
  const { data: staleSessions, error: staleError } = await admin
    .from('sessions')
    .select('id')
    .or(`id.like.relatorio-%,id.like.qa-e2e-%,table_number.eq.${qrTable}`)
  if (staleError) throw staleError

  const sessionIds = [...new Set([qrSessionId, ...(staleSessions ?? []).map((s) => s.id)])]
  if (sessionIds.length === 0) return

  for (const [table, col] of [['payments', 'session_id'], ['service_calls', 'session_id'], ['orders', 'session_id']]) {
    const { error } = await admin.from(table).delete().in(col, sessionIds)
    if (error) throw new Error(`Cleanup falhou em ${table}: ${error.message}`)
  }

  if (!cleanupStaffSignedIn) {
    const { error } = await cleanupStaff.auth.signInWithPassword({
      email: usernameToEmail('admin'),
      password,
    })
    if (error) throw error
    cleanupStaffSignedIn = true
  }
  const { error: closeError } = await cleanupStaff
    .from('sessions')
    .update({ open: false, access_code_hash: null, opened_at: null, mode: null, entry_price: null, headcount: null })
    .in('id', sessionIds)
  if (closeError) throw closeError
  const { error: delError } = await admin.from('sessions').delete().in('id', sessionIds)
  if (delError) throw delError
}

async function setupQaData() {
  await cleanupQaData()
  const { data: items, error } = await admin
    .from('menu_items')
    .select('name')
    .eq('available', true)
    .order('name', { ascending: true })
    .limit(3)
  if (error) throw error
  menuItemNames = (items ?? []).map((i) => i.name)
  if (menuItemNames.length === 0) throw new Error('É preciso pelo menos 1 item disponível no menu.')

  const now = new Date().toISOString()
  const { error: qrError } = await admin.from('sessions').insert({
    id: qrSessionId,
    table_number: qrTable,
    created_at: now,
    open: true,
    opened_at: now,
  })
  if (qrError) throw qrError
}

async function completeTableOrders() {
  if (!kitchenStaffSignedIn) {
    const { error } = await kitchenStaff.auth.signInWithPassword({
      email: usernameToEmail('cozinha'),
      password,
    })
    if (error) throw error
    kitchenStaffSignedIn = true
  }

  const { data: sessionOrders, error: ordersError } = await kitchenStaff
    .from('orders')
    .select('id,status')
    .eq('session_id', qrSessionId)
    .neq('status', 'cancelled')
  if (ordersError) throw ordersError

  const flow = ['pending', 'preparing', 'ready', 'delivered']
  for (const order of sessionOrders ?? []) {
    let position = flow.indexOf(order.status)
    if (position === -1) throw new Error(`Estado inesperado no pedido ${order.id}: ${order.status}`)

    while (position < flow.length - 1) {
      position += 1
      const { error } = await kitchenStaff
        .from('orders')
        .update({ status: flow[position] })
        .eq('id', order.id)
      if (error) throw error
    }
  }
}

// ── Capturas ────────────────────────────────────────────────────

async function loginShot() {
  const page = await newPage()
  await page.goto(baseUrl, { waitUntil: 'load' })
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible()
  await page.waitForTimeout(400)
  await shot(page, 'relatorio-login')
  await page.context().close()
}

async function qrMobileShots() {
  const page = await newPage({ mobile: true })
  await page.goto(`${baseUrl}/mesa/${qrSessionId}`, { waitUntil: 'load' })
  await expect(page.getByRole('heading', { name: 'Cria um código de 6 dígitos' })).toBeVisible()
  await page.locator('input[inputmode="numeric"]').fill('123456')
  await page.getByRole('button', { name: 'Criar código' }).click()
  const menuHeading = page.getByRole('heading', { name: 'Menu' })
  const codeEntryHeading = page.getByRole('heading', { name: 'Introduz o código' })
  const next = await Promise.race([
    menuHeading.waitFor({ state: 'visible', timeout: 5000 }).then(() => 'menu'),
    codeEntryHeading.waitFor({ state: 'visible', timeout: 5000 }).then(() => 'code'),
  ])
  if (next === 'code') {
    await page.locator('input[inputmode="numeric"]').fill('123456')
    await page.getByRole('button', { name: 'Entrar' }).click()
  }
  await expect(menuHeading).toBeVisible()
  await page.getByRole('button', { name: `Adicionar ${menuItemNames[0]}` }).click()
  await page.waitForTimeout(600)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(400)
  await shot(page, 'relatorio-cliente-menu')
  // envia o pedido — alimenta o ecrã da cozinha e a conta da mesa
  await page.getByRole('button', { name: 'Abrir carrinho' }).click()
  await page.getByRole('button', { name: 'Pedir', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Pedido Recebido!' })).toBeVisible()
  await page.context().close()
}

async function empregadoShots() {
  const page = await newPage()
  await login(page, 'empregado')
  await expect(page.getByRole('heading', { name: 'Empregado' })).toBeVisible()
  const punchIn = page.getByRole('button', { name: 'Picar entrada' })
  if (await punchIn.isVisible().catch(() => false)) await punchIn.click()
  await expect(page.getByText('Em turno', { exact: true })).toBeVisible()
  await expect(page.getByText('Mapa de mesas')).toBeVisible()
  await page.waitForTimeout(600)
  await shot(page, 'relatorio-mapa-mesas')

  // pedido com carrinho aberto (rascunho local; enviado para alimentar a conta)
  await page.getByRole('button', { name: `Pedir para a mesa ${qrTable}` }).click()
  await expect(page.getByRole('heading', { name: `Pedido para a mesa ${qrTable}` })).toBeVisible()
  for (const name of menuItemNames) {
    await page.getByRole('button', { name: `Adicionar ${name}` }).click()
  }
  await page.getByRole('button', { name: /Ver pedido da mesa/ }).click()
  await page.waitForTimeout(500)
  await shot(page, 'relatorio-pedido-carrinho')
  await page.getByRole('button', { name: 'Enviar pedido' }).click()
  await expect(page.getByText('Pedido enviado para a cozinha')).toBeVisible()
  await page.context().close()
}

async function cozinhaShot() {
  const page = await newPage()
  await login(page, 'cozinha')
  await expect(page.getByRole('heading', { name: 'Cozinha', exact: true })).toBeVisible()
  // avança um pedido para "Em Preparação" para o quadro mostrar dois estados.
  // Por role e não por classes CSS: o cartão mudou de p-6 para p-4 e o seletor
  // antigo (div.rounded-lg.p-6) deixava este clique falhar em silêncio.
  const iniciar = page.getByRole('button', { name: 'Iniciar' }).first()
  try {
    // espera explícita: os cartões chegam por fetch/realtime depois do heading,
    // e um isVisible() imediato saltava o clique em silêncio
    await iniciar.waitFor({ state: 'visible', timeout: 5000 })
    await iniciar.click()
    await page.waitForTimeout(600)
  } catch {
    // sem pedidos pendentes — segue sem avançar nenhum cartão
  }
  await shot(page, 'relatorio-cozinha')

  // Antes de pedir a conta, todos os pedidos da mesa têm de estar concluídos.
  // Fazemos as mesmas transições sequenciais da cozinha, autenticados como
  // cozinha, para a captura não depender da posição dos cartões no kanban.
  await completeTableOrders()

  const { data: remainingOrders, error: remainingError } = await admin
    .from('orders')
    .select('id,status')
    .eq('session_id', qrSessionId)
    .not('status', 'in', '(delivered,cancelled)')
  if (remainingError) throw remainingError
  if ((remainingOrders ?? []).length > 0) {
    throw new Error(`Ainda existem ${remainingOrders.length} pedidos por concluir antes da conta.`)
  }
  await page.context().close()
}

async function fechoContaShot() {
  const page = await newPage()
  await login(page, 'empregado')
  await expect(page.getByRole('heading', { name: 'Empregado' })).toBeVisible()
  await expect(page.getByText('Em turno', { exact: true })).toBeVisible()

  // Só agora, com os pedidos entregues, abrimos a composição da conta.
  await page.getByRole('button', { name: `Fechar conta da mesa ${qrTable}` }).click()
  await expect(page.getByRole('dialog', { name: `Fechar conta — Mesa ${qrTable}` })).toBeVisible()
  await expect(page.getByText('Há pedidos por concluir')).toHaveCount(0)
  await page.waitForTimeout(800)
  await shot(page, 'relatorio-fecho-conta')
  await page.keyboard.press('Escape')

  // Deixar o turno fechado e o ambiente temporário pronto para a limpeza.
  await page.getByRole('button', { name: 'Picar saída' }).click()
  await page.getByRole('button', { name: 'Confirmar saída' }).click()
  await expect(page.getByRole('button', { name: 'Picar entrada' })).toBeVisible()
  await page.context().close()
}

async function adminShots() {
  const page = await newPage()
  await login(page, 'admin')
  await expect(page).toHaveURL(/\/admin\/pedidos$/)
  await page.getByRole('link', { name: /Menu/ }).click()
  await expect(page).toHaveURL(/\/admin\/menu$/)
  await page.waitForTimeout(800)
  await shot(page, 'relatorio-admin-menu')

  await page.getByRole('link', { name: /Análises/ }).click()
  await expect(page).toHaveURL(/\/admin\/analises$/)
  await page.waitForTimeout(1200)
  // tenta mostrar 30 dias (mais dados nos gráficos); segue em frente se não existir
  const btn30 = page.getByRole('button', { name: /30/ }).first()
  if (await btn30.isVisible().catch(() => false)) {
    await btn30.click()
    await page.waitForTimeout(1500)
  }
  await shot(page, 'relatorio-analises-resumo')
  await page.context().close()
}

async function main() {
  console.log(`Base URL: ${baseUrl}`)
  console.log(`Run: ${runId}`)
  await setupQaData()
  browser = await chromium.launch()
  try {
    if (!fechoOnly) { console.log('login…'); await loginShot() }
    console.log('cliente QR…');   await qrMobileShots()
    console.log('empregado…');    await empregadoShots()
    console.log('cozinha…');      await cozinhaShot()
    console.log('conta…');        await fechoContaShot()
    if (!fechoOnly) { console.log('admin…'); await adminShots() }
    console.log(`\nCapturas em qa-artifacts/relatorio/`)
  } finally {
    await browser?.close()
    await cleanupQaData()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
