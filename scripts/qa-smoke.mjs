import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { chromium, expect } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'

dotenv.config({ path: '.env.local' })

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const artifactsDir = path.join(repoRoot, 'qa-artifacts', 'smoke')

const baseUrl = process.env.QA_BASE_URL ?? 'http://127.0.0.1:5173'
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const anonKey = process.env.VITE_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = process.env.SEED_PASSWORD ?? 'manageeat2026!'

if (!serviceKey) {
  throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY no .env.local para criar e limpar dados QA.')
}
if (!anonKey) {
  throw new Error('Falta VITE_SUPABASE_ANON_KEY no .env.local para fechar sessões QA abertas.')
}

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const cleanupStaff = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const runId = `qa-e2e-${Date.now()}`
const qrTable = 96
const clientTable = 1
const qrSessionId = `${runId}-qr`
const clientSessionId = `${runId}-cliente`
const testSessionIds = [qrSessionId]
let clientSessionCreated = false
let qaMenuItemName = ''
let browser

const consoleProblems = []
const accessibilityWarnings = []
let cleanupStaffSignedIn = false

function usernameToEmail(username) {
  return `${username.trim().toLowerCase()}@manageeat.local`
}

function assertNoCleanupError(action, error) {
  if (error) {
    throw new Error(`Cleanup QA falhou em "${action}": ${error.message}`)
  }
}

function trackBrowserProblems(page, label) {
  page.on('console', (message) => {
    if (message.type() === 'error') {
      if (label === 'auth-errors' && message.text().includes('400 (Bad Request)')) return
      consoleProblems.push(`${label}: console.error: ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => {
    consoleProblems.push(`${label}: pageerror: ${error.message}`)
  })
}

async function newPage(label, options = {}) {
  const context = await browser.newContext({
    viewport: options.mobile ? { width: 390, height: 844 } : { width: 1440, height: 950 },
    isMobile: Boolean(options.mobile),
  })
  // Num browser limpo a app usa por defeito o proxy HTTPS da LAN (:54391),
  // cujo certificado auto-assinado o Playwright rejeita — o QA falharia logo
  // no ecrã "Sem ligação ao servidor". Pré-definimos o override para o QA
  // falar direto com o Supabase local (o mesmo supabaseUrl do setup).
  await context.addInitScript(
    ([url]) => window.localStorage.setItem('manage-eat-server-override', url),
    [supabaseUrl],
  )
  const page = await context.newPage()
  trackBrowserProblems(page, label)
  return page
}

async function saveScreenshot(page, name) {
  await mkdir(artifactsDir, { recursive: true })
  await page.screenshot({ path: path.join(artifactsDir, `${name}.png`), fullPage: true })
}

async function runStep(name, fn) {
  const startedAt = Date.now()
  try {
    await fn()
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
    console.log(`✓ ${name} (${seconds}s)`)
  } catch (error) {
    console.error(`✗ ${name}`)
    throw error
  }
}

async function runAxe(page, label) {
  // As entradas escalonadas alteram temporariamente a opacidade. A auditoria
  // deve medir o estado final, depois de a animação mais longa terminar.
  await page.waitForTimeout(1000)
  const results = await new AxeBuilder({ page }).analyze()
  const important = results.violations.filter((violation) =>
    violation.impact === 'critical' || violation.impact === 'serious',
  )

  if (important.length > 0) {
    const summary = important.map((violation) => {
      const targets = violation.nodes
        .slice(0, 5)
        .map((node) => `${node.target.join(' ')}: ${node.failureSummary ?? 'sem detalhe'}`)
        .join(', ')
      return `${violation.impact}: ${violation.id} (${violation.nodes.length}) [${targets}]`
    }).join('; ')
    accessibilityWarnings.push(`${label}: ${summary}`)
  }
}

async function login(page, username) {
  await page.goto(baseUrl, { waitUntil: 'load' })
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible()
  await page.locator('input[autocomplete="username"]').fill(username)
  await page.locator('input[autocomplete="current-password"]').fill(password)
  await page.getByRole('button', { name: 'Entrar' }).click()
}

async function logout(page) {
  await page.getByRole('button', { name: 'Sair' }).click()
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible()
  await page.context().close()
}

async function cleanupQaData() {
  const sessionsToClean = [...testSessionIds]
  if (clientSessionCreated) sessionsToClean.push(clientSessionId)
  const { data: staleSessions, error: staleError } = await admin
    .from('sessions')
    .select('id')
    .or(`id.like.qa-e2e-%,id.like.headed-qa-%,table_number.eq.${qrTable}`)
  assertNoCleanupError('listar sessões antigas', staleError)

  const allSessionIds = new Set(sessionsToClean)
  for (const session of staleSessions ?? []) {
    allSessionIds.add(session.id)
  }
  const sessionIds = [...allSessionIds]
  if (sessionIds.length === 0) return

  const paymentsResult = await admin.from('payments').delete().in('session_id', sessionIds)
  assertNoCleanupError('apagar pagamentos', paymentsResult.error)
  const callsResult = await admin.from('service_calls').delete().in('session_id', sessionIds)
  assertNoCleanupError('apagar chamadas', callsResult.error)
  const ordersResult = await admin.from('orders').delete().in('session_id', sessionIds)
  assertNoCleanupError('apagar pedidos', ordersResult.error)

  if (!cleanupStaffSignedIn) {
    const { error } = await cleanupStaff.auth.signInWithPassword({
      email: usernameToEmail('admin'),
      password,
    })
    assertNoCleanupError('autenticar admin para fechar sessões', error)
    cleanupStaffSignedIn = true
  }

  const closeResult = await cleanupStaff
    .from('sessions')
    .update({
      open: false,
      access_code_hash: null,
      opened_at: null,
      mode: null,
      entry_price: null,
      headcount: null,
    })
    .in('id', sessionIds)
  assertNoCleanupError('fechar sessões', closeResult.error)

  const sessionsResult = await admin.from('sessions').delete().in('id', sessionIds)
  assertNoCleanupError('apagar sessões', sessionsResult.error)
}

async function setupQaData() {
  await cleanupQaData()

  const { data: menuItem, error: menuError } = await admin
    .from('menu_items')
    .select('name')
    .eq('available', true)
    .order('name', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (menuError) throw menuError
  if (!menuItem?.name) throw new Error('QA smoke precisa de pelo menos um item disponível no menu.')
  qaMenuItemName = menuItem.name

  const now = new Date().toISOString()
  const { error: qrError } = await admin.from('sessions').insert({
    id: qrSessionId,
    table_number: qrTable,
    created_at: now,
    open: true,
    opened_at: now,
  })
  if (qrError) throw qrError

  const { data: existingClientSessions, error: existingClientError } = await admin
    .from('sessions')
    .select('id')
    .eq('table_number', clientTable)
    .eq('open', true)
  if (existingClientError) throw existingClientError

  if ((existingClientSessions ?? []).length === 0) {
    const { error: clientError } = await admin.from('sessions').insert({
      id: clientSessionId,
      table_number: clientTable,
      created_at: now,
      open: true,
      opened_at: now,
    })
    if (clientError) throw clientError
    clientSessionCreated = true
  }
}

async function addQaMenuItem(page) {
  await page.getByRole('button', { name: `Adicionar ${qaMenuItemName}` }).click()
}

async function authErrorsAndA11y() {
  const page = await newPage('auth-errors')
  await page.goto(baseUrl, { waitUntil: 'load' })
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible()

  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByText('Preenche o utilizador e a password.')).toBeVisible()

  await page.locator('input[autocomplete="username"]').fill('admin')
  await page.locator('input[autocomplete="current-password"]').fill('password-errada')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByText('Utilizador ou password incorretos.')).toBeVisible()

  await runAxe(page, 'login')
  await saveScreenshot(page, 'login')
  await page.context().close()
}

async function adminFlow() {
  const page = await newPage('admin')
  await login(page, 'admin')
  await expect(page).toHaveURL(/\/admin\/pedidos$/)
  await expect(page.getByRole('heading', { name: 'Pedidos', exact: true })).toBeVisible()
  await page.getByRole('link', { name: /Menu/ }).click()
  await expect(page).toHaveURL(/\/admin\/menu$/)
  await expect(page.getByRole('heading', { name: 'Menu' })).toBeVisible()
  await page.getByRole('link', { name: /Definições/ }).click()
  await expect(page).toHaveURL(/\/admin\/settings$/)
  await expect(page.getByText(/Tipo de serviço/i)).toBeVisible()
  await runAxe(page, 'admin settings')
  await saveScreenshot(page, 'admin-settings')
  await logout(page)
}

async function managerFlow() {
  const page = await newPage('gerente')
  await login(page, 'gerente')
  await expect(page).toHaveURL(/\/manager\/pedidos$/)
  await expect(page.getByRole('heading', { name: 'Pedidos', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /Definições/ })).toHaveCount(0)
  await logout(page)
}

async function employeeFlow() {
  const page = await newPage('empregado')
  await login(page, 'empregado')
  await expect(page).toHaveURL(/\/employee$/)
  await expect(page.getByRole('heading', { name: 'Empregado' })).toBeVisible()
  // Sem turno aberto o empregado não opera; picar a
  // entrada faz parte do fluxo real. Um run anterior interrompido pode ter
  // deixado o turno aberto; nesse caso o botão não existe e seguimos.
  const punchInButton = page.getByRole('button', { name: 'Picar entrada' })
  if (await punchInButton.isVisible().catch(() => false)) {
    await punchInButton.click()
  }
  await expect(page.getByText('Em turno', { exact: true })).toBeVisible()
  await expect(page.getByText('Mapa de mesas')).toBeVisible()
  await expect(page.getByRole('button', { name: /Nova mesa/ })).toBeEnabled()
  await page.getByRole('button', { name: `Pedir para a mesa ${qrTable}` }).click()
  await expect(page.getByRole('heading', { name: `Pedido para a mesa ${qrTable}` })).toBeVisible()
  await addQaMenuItem(page)
  await expect(page.getByText(`Rascunho: 1 item`)).toBeVisible()
  // A gaveta do carrinho abre a pedido (barra flutuante) — só lá dentro é que
  // vive o botão "Enviar pedido".
  await page.getByRole('button', { name: /Ver pedido da mesa/ }).click()
  await page.getByRole('button', { name: 'Enviar pedido' }).click()
  await expect(page.getByText('Pedido enviado para a cozinha')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Escolhe uma mesa para pedir' })).toBeVisible()
  await runAxe(page, 'empregado menu')
  await saveScreenshot(page, 'empregado')
  // Picar a saída antes de sair — senão o logout mostra o aviso "Ainda estás
  // em turno" e o clique em "Sair" não chega ao ecrã de login.
  await page.getByRole('button', { name: 'Picar saída' }).click()
  await page.getByRole('button', { name: 'Confirmar saída' }).click()
  await expect(page.getByRole('button', { name: 'Picar entrada' })).toBeVisible()
  await logout(page)
}

async function customerFlow() {
  const page = await newPage('cliente')
  await login(page, 'cliente')
  await expect(page).toHaveURL(/\/customer$/)
  await expect(page.getByRole('heading', { name: 'Cliente' })).toBeVisible()

  if (!clientSessionCreated) {
    // Ou a mesa está fechada (mensagem) ou já tem sessão aberta (menu com a
    // pesquisa). "Pesquisar itens" é placeholder, não texto — getByText não o vê.
    await expect(
      page.getByText(/ainda não está aberta/).or(page.getByPlaceholder('Pesquisar itens...')),
    ).toBeVisible()
    await logout(page)
    return
  }

  await addQaMenuItem(page)
  await expect(page.getByText(/O Teu Carrinho/)).toBeVisible()
  await page.getByRole('button', { name: 'Pedir' }).click()
  await expect(page.getByText('O teu pedido foi enviado para a cozinha!')).toBeVisible()
  await runAxe(page, 'cliente')
  await saveScreenshot(page, 'cliente')
  await logout(page)
}

async function qrFlow() {
  const page = await newPage('qr-mobile', { mobile: true })
  await page.goto(`${baseUrl}/mesa/${qrSessionId}`, { waitUntil: 'load' })
  await expect(page.getByRole('heading', { name: 'Cria um código de 6 dígitos' })).toBeVisible()
  await page.locator('input[inputmode="numeric"]').fill('123456')
  await page.getByRole('button', { name: 'Criar código' }).click()
  const menuHeading = page.getByRole('heading', { name: 'Menu' })
  const codeEntryHeading = page.getByRole('heading', { name: 'Introduz o código' })
  const nextQrState = await Promise.race([
    menuHeading.waitFor({ state: 'visible', timeout: 5000 }).then(() => 'menu'),
    codeEntryHeading.waitFor({ state: 'visible', timeout: 5000 }).then(() => 'code'),
  ])
  if (nextQrState === 'code') {
    await page.locator('input[inputmode="numeric"]').fill('123456')
    await page.getByRole('button', { name: 'Entrar' }).click()
  }
  await expect(menuHeading).toBeVisible()
  await expect(page.getByText(`Mesa ${qrTable}`)).toBeVisible()
  await page.getByRole('button', { name: 'Chamar empregado' }).click()
  await expect(page.getByText('O empregado foi avisado!')).toBeVisible()
  await addQaMenuItem(page)
  await page.getByRole('button', { name: 'Abrir carrinho' }).click()
  await page.getByRole('button', { name: 'Pedir', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Pedido Recebido!' })).toBeVisible()
  await runAxe(page, 'qr mobile')
  await saveScreenshot(page, 'qr-mobile')
  await page.context().close()
}

async function kitchenFlow() {
  const page = await newPage('cozinha')
  await login(page, 'cozinha')
  await expect(page).toHaveURL(/\/kitchen$/)
  await expect(page.getByRole('heading', { name: 'Cozinha', exact: true })).toBeVisible()
  const orderCard = page
    .locator('div.rounded-lg.p-6')
    .filter({ hasText: `Mesa ${qrTable}` })
    .filter({ hasText: qaMenuItemName })
    .first()
  await expect(orderCard).toBeVisible()
  await orderCard.getByRole('button', { name: 'Iniciar' }).click()
  await expect(page.locator('div').filter({ hasText: `Mesa ${qrTable}` }).filter({ hasText: qaMenuItemName }).filter({ hasText: 'Em Preparação' }).first()).toBeVisible()
  await runAxe(page, 'cozinha')
  await saveScreenshot(page, 'cozinha')
  await logout(page)
}

async function mobileEmpregadoFlow() {
  const page = await newPage('empregado-mobile', { mobile: true })
  await login(page, 'empregado')
  await expect(page.getByRole('heading', { name: 'Empregado' })).toBeVisible()
  await expect(page.getByText('Mapa de mesas')).toBeVisible()
  await expect(page.getByRole('button', { name: /Nova mesa/ })).toBeVisible()
  await page.getByRole('button', { name: `Pedir para a mesa ${qrTable}` }).click()
  await expect(page.getByRole('heading', { name: `Pedido para a mesa ${qrTable}` })).toBeVisible()
  await runAxe(page, 'empregado mobile')
  await saveScreenshot(page, 'empregado-mobile')
  await logout(page)
}

async function main() {
  console.log(`QA base URL: ${baseUrl}`)
  console.log(`QA run id: ${runId}`)

  await setupQaData()
  browser = await chromium.launch()

  try {
    await runStep('login: erros humanos + axe', authErrorsAndA11y)
    await runStep('admin: pedidos/menu/definicoes/logout', adminFlow)
    await runStep('gerente: painel limitado sem definicoes', managerFlow)
    await runStep('empregado: mapa/pedido por mesa', employeeFlow)
    await runStep('cliente autenticado: pedido em mesa fixa', customerFlow)
    await runStep('QR anonimo mobile: codigo/chamada/pedido', qrFlow)
    await runStep('cozinha: recebe e avanca pedido QR', kitchenFlow)
    await runStep('empregado mobile: mapa responsivo', mobileEmpregadoFlow)

    if (consoleProblems.length > 0) {
      throw new Error(`Erros de browser:\n${consoleProblems.join('\n')}`)
    }

    if (accessibilityWarnings.length > 0) {
      throw new Error(`Falhas axe serious/critical:\n${accessibilityWarnings.join('\n')}`)
    }
  } finally {
    await browser?.close()
    await cleanupQaData()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
