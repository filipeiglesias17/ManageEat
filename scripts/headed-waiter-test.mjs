import { chromium, expect } from '@playwright/test'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

const baseUrl = 'http://localhost:5173'
const supabaseUrl = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = process.env.SEED_PASSWORD ?? 'manageeat2026!'

if (!serviceKey) {
  console.error('Falta SUPABASE_SERVICE_ROLE_KEY no .env.local.')
  process.exit(1)
}

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const qrTable = 96
const sessionId = `headed-qa-${Date.now()}`

async function main() {
  console.log('1. A preparar dados de teste...')
  // Garantir que a mesa está limpa e aberta
  await admin.from('orders').delete().eq('session_id', sessionId)
  await admin.from('sessions').delete().eq('id', sessionId)
  
  const now = new Date().toISOString()
  await admin.from('sessions').insert({
    id: sessionId,
    table_number: qrTable,
    created_at: now,
    open: true,
    opened_at: now,
  })

  // Obter um item do menu
  const { data: menuItem } = await admin
    .from('menu_items')
    .select('name')
    .eq('available', true)
    .limit(1)
    .single()
  const itemName = menuItem?.name ?? 'Sopa Alentejana'

  console.log('2. A iniciar browser visível (modo cabeçado)...')
  const browser = await chromium.launch({
    headless: false,
    slowMo: 1500, // Lentidão intencional para o utilizador acompanhar visualmente
  })

  // Simular viewport do iPhone 16
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  })

  const page = await context.newPage()
  
  try {
    console.log('3. A navegar para a página de login...')
    await page.goto(baseUrl, { waitUntil: 'load' })
    
    console.log('4. A preencher credenciais do Empregado...')
    await page.locator('input[autocomplete="username"]').fill('empregado')
    await page.locator('input[autocomplete="current-password"]').fill(password)
    
    console.log('5. A submeter login...')
    await page.getByRole('button', { name: 'Entrar' }).click()
    
    console.log('6. A aguardar o painel do Empregado...')
    await expect(page).toHaveURL(/\/empregado$/)
    await expect(page.getByRole('heading', { name: 'Empregado' })).toBeVisible()
    
    console.log(`7. A iniciar pedido para a mesa ${qrTable}...`)
    // Como a sessão está aberta para a mesa qrTable (96), podemos clicar no botão
    await page.getByRole('button', { name: `Pedir para a mesa ${qrTable}` }).click()
    
    console.log('8. A adicionar item ao rascunho...')
    await page.getByRole('button', { name: `Adicionar ${itemName}` }).click()
    await expect(page.getByText('Rascunho: 1 item')).toBeVisible()
    
    console.log('9. A enviar o pedido para a cozinha...')
    await page.getByRole('button', { name: 'Enviar pedido' }).click()
    
    console.log('10. Pedido enviado com sucesso!')
    await expect(page.getByText('Pedido enviado para a cozinha!')).toBeVisible()
    
    console.log('Teste concluído com sucesso. A fechar browser em 5 segundos...')
    await page.waitForTimeout(5000)
  } catch (error) {
    console.error('Erro durante o teste:', error)
  } finally {
    await browser.close()
    // Limpeza
    await admin.from('orders').delete().eq('session_id', sessionId)
    await admin.from('sessions').delete().eq('id', sessionId)
  }
}

main()
