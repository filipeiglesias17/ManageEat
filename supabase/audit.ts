// Suite de testes às políticas RLS + triggers do Supabase (espelha o antigo
// ficheiro antigo de audit. É o teste de regressão da segurança: corre-o sempre que
// mexeres nas migrações de RLS.
//
// Uso:  npx tsx supabase/audit.ts
//
// Pré-requisitos (.env.local):
//   VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY  (de `npx supabase status`)
//   As 5 contas de base existem (corre `npx tsx scripts/seed.ts` antes).
//   AUDIT_PASSWORD (opcional; default = password do seed).
//
// Diferença vs Firestore: na RLS um READ negado não dá erro — devolve 0 linhas.
// Por isso os testes de leitura verificam VISIBILIDADE (linhas devolvidas) e os
// de escrita verificam ERRO ou 0 linhas afetadas (UPDATE/DELETE filtrados pela
// USING não dão erro, afetam 0 linhas).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const url = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const anonKey = process.env.VITE_SUPABASE_ANON_KEY
if (!anonKey) {
  console.error('Falta VITE_SUPABASE_ANON_KEY no .env.local (vê `npx supabase status`).')
  process.exit(1)
}
const PW = process.env.AUDIT_PASSWORD ?? 'manageeat2026!'
const rid = () => 'audit-' + Math.random().toString(16).slice(2, 12) // ids text (orders/sessions/service_calls)
const uid = () => randomUUID() // ids uuid (categories/menu_items/shifts/payments)

function client(): SupabaseClient {
  return createClient(url, anonKey as string, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
}

// ── Mini-framework ──
type Res = { name: string; pass: boolean; detail: string }
const results: Res[] = []

type Settled = { data: unknown; error: { message?: string } | null }
async function settle(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<Settled> {
  try {
    const r = await p
    return { data: r.data ?? null, error: (r.error as { message?: string }) ?? null }
  } catch (e) {
    return { data: null, error: (e as { message?: string }) ?? { message: 'throw' } }
  }
}
function rows(data: unknown): number {
  return Array.isArray(data) ? data.length : 0
}
function msg(error: { message?: string } | null): string {
  return error?.message ?? ''
}

// Escrita permitida: sem erro (e, quando pedimos .select(), afetou ≥1 linha).
async function okWrite(name: string, p: PromiseLike<{ data: unknown; error: unknown }>, expectRows = false) {
  const { data, error } = await settle(p)
  if (error) results.push({ name, pass: false, detail: 'DEVIA PERMITIR, falhou: ' + msg(error) })
  else if (expectRows && rows(data) === 0) results.push({ name, pass: false, detail: 'DEVIA PERMITIR mas afetou 0 linhas' })
  else results.push({ name, pass: true, detail: 'permitido (esperado)' })
}
// Escrita negada: erro OU 0 linhas afetadas (UPDATE/DELETE filtrados pela USING).
async function deny(name: string, p: PromiseLike<{ data: unknown; error: unknown }>) {
  const { data, error } = await settle(p)
  if (error) results.push({ name, pass: true, detail: 'negado (esperado): ' + msg(error) })
  else if (Array.isArray(data) && data.length === 0) results.push({ name, pass: true, detail: 'negado (0 linhas)' })
  else results.push({ name, pass: false, detail: '*** DEVIA NEGAR mas PASSOU ***' })
}
async function okReadNonEmpty(name: string, p: PromiseLike<{ data: unknown; error: unknown }>) {
  const { data, error } = await settle(p)
  if (error) results.push({ name, pass: false, detail: 'erro inesperado: ' + msg(error) })
  else if (rows(data) === 0) results.push({ name, pass: false, detail: 'DEVIA VER linhas mas veio vazio' })
  else results.push({ name, pass: true, detail: 'lê (esperado)' })
}
async function okReadAny(name: string, p: PromiseLike<{ data: unknown; error: unknown }>) {
  const { error } = await settle(p)
  results.push(error
    ? { name, pass: false, detail: 'erro inesperado: ' + msg(error) }
    : { name, pass: true, detail: 'lê (esperado)' })
}
async function denyReadEmpty(name: string, p: PromiseLike<{ data: unknown; error: unknown }>) {
  const { data, error } = await settle(p)
  if (error) results.push({ name, pass: true, detail: 'negado/erro' })
  else if (rows(data) === 0) results.push({ name, pass: true, detail: 'invisível (0 linhas)' })
  else results.push({ name, pass: false, detail: '*** VIU linhas que NÃO devia ***' })
}

function rpcResult(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) return data[0] as Record<string, unknown> | undefined ?? null
  return data as Record<string, unknown> | null
}

async function okClaim(name: string, p: PromiseLike<{ data: unknown; error: unknown }>) {
  const { data, error } = await settle(p)
  const result = rpcResult(data)
  if (error) results.push({ name, pass: false, detail: 'DEVIA PERMITIR, falhou: ' + msg(error) })
  else if (!result || result.ok !== true) results.push({ name, pass: false, detail: `DEVIA PERMITIR, devolveu ${JSON.stringify(result)}` })
  else results.push({ name, pass: true, detail: 'permitido (esperado)' })
}

async function denyClaim(name: string, p: PromiseLike<{ data: unknown; error: unknown }>) {
  const { data, error } = await settle(p)
  const result = rpcResult(data)
  if (error) results.push({ name, pass: true, detail: 'negado/erro' })
  else if (result && result.ok === false) results.push({ name, pass: true, detail: `negado (esperado): ${String(result.reason)}` })
  else results.push({ name, pass: false, detail: '*** DEVIA NEGAR mas PASSOU ***' })
}

// ── Construtor de pedido (snake_case, nível BD) ──
const createdOrderIds: string[] = []
let auditMenuItemId = ''
let auditUnavailableItemId = ''
let auditRodizioItemId = ''
let auditClientSessionId = ''

function orderRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  const id = (over.id as string) ?? rid()
  const row: Record<string, unknown> = {
    id,
    request_id: (over.request_id as string) ?? id,
    table_number: 5,
    source: 'cliente',
    items: [{
      menuItemId: auditMenuItemId,
      menuItemName: 'Nome forjado pelo audit',
      quantity: 1,
      price: 999,
      vatRate: 99,
    }],
    status: 'pending',
    created_at: new Date().toISOString(),
  }
  if (auditClientSessionId) row.session_id = auditClientSessionId
  Object.assign(row, over)
  createdOrderIds.push(row.id as string)
  return row
}

async function okOrderSnapshot(
  name: string,
  writer: SupabaseClient,
  reader: SupabaseClient,
  row: Record<string, unknown>,
  expected: {
    menuItemName?: string
    price?: number
    vatRate?: number
    quantity?: number
    createdAtIsIso?: boolean
    cancelFieldsCleared?: boolean
  },
) {
  const { error } = await settle(writer.from('orders').insert(row))
  if (error) {
    results.push({ name, pass: false, detail: 'DEVIA PERMITIR, falhou: ' + msg(error) })
    return
  }

  const { data, error: readError } = await settle(
    reader
      .from('orders')
      .select('items, created_at, cancelled_at, cancelled_by, cancel_reason')
      .eq('id', row.id as string)
      .maybeSingle(),
  )
  if (readError || !data) {
    results.push({ name, pass: false, detail: 'não conseguiu reler pedido: ' + msg(readError) })
    return
  }

  const order = data as {
    items?: unknown
    created_at?: unknown
    cancelled_at?: unknown
    cancelled_by?: unknown
    cancel_reason?: unknown
  }
  const items = order.items
  const first = Array.isArray(items) ? items[0] as Record<string, unknown> : null
  const pass =
    !!first
    && (expected.menuItemName === undefined || first.menuItemName === expected.menuItemName)
    && (expected.price === undefined || Number(first.price) === expected.price)
    && (expected.vatRate === undefined || Number(first.vatRate) === expected.vatRate)
    && (expected.quantity === undefined || Number(first.quantity) === expected.quantity)
    && (!expected.createdAtIsIso || typeof order.created_at === 'string' && order.created_at.includes('T') && order.created_at.endsWith('Z'))
    && (!expected.cancelFieldsCleared || (
      order.cancelled_at == null
      && order.cancelled_by == null
      && order.cancel_reason == null
    ))

  results.push({
    name,
    pass,
    detail: pass ? 'snapshot recalculado (esperado)' : `snapshot inesperado: ${JSON.stringify(first)}`,
  })
}

async function okServiceCallInsertSnapshot(
  name: string,
  writer: SupabaseClient,
  reader: SupabaseClient,
  row: Record<string, unknown>,
) {
  const { error } = await settle(writer.from('service_calls').insert(row))
  if (error) {
    results.push({ name, pass: false, detail: 'DEVIA PERMITIR, falhou: ' + msg(error) })
    return
  }

  const { data, error: readError } = await settle(
    reader
      .from('service_calls')
      .select('status, created_at, acknowledged_at, acknowledged_by, resolved_at, resolved_by')
      .eq('id', row.id as string)
      .maybeSingle(),
  )
  const call = data as Record<string, unknown> | null
  const pass =
    !readError
    && !!call
    && call.status === 'open'
    && typeof call.created_at === 'string'
    && call.created_at.includes('T')
    && call.created_at.endsWith('Z')
    && call.created_at !== row.created_at
    && call.acknowledged_at == null
    && call.acknowledged_by == null
    && call.resolved_at == null
    && call.resolved_by == null

  results.push({
    name,
    pass,
    detail: pass ? 'nasce aberta e com timestamp da BD' : `snapshot inesperado: ${JSON.stringify(call)} ${msg(readError)}`,
  })
}

async function okServiceCallStatusSnapshot(
  name: string,
  writer: SupabaseClient,
  reader: SupabaseClient,
  callId: string,
  update: Record<string, unknown>,
  expected: { status: string; acknowledgedBy?: string | null; resolvedBy?: string | null },
) {
  const { data, error } = await settle(
    writer.from('service_calls').update(update).eq('id', callId).select(),
  )
  if (error || rows(data) === 0) {
    results.push({ name, pass: false, detail: 'DEVIA PERMITIR, falhou: ' + msg(error) })
    return
  }

  const { data: readData, error: readError } = await settle(
    reader
      .from('service_calls')
      .select('status, acknowledged_at, acknowledged_by, resolved_at, resolved_by')
      .eq('id', callId)
      .maybeSingle(),
  )
  const call = readData as Record<string, unknown> | null
  const pass =
    !readError
    && !!call
    && call.status === expected.status
    && (expected.acknowledgedBy === undefined || call.acknowledged_by === expected.acknowledgedBy)
    && (expected.resolvedBy === undefined || call.resolved_by === expected.resolvedBy)
    && (expected.status !== 'acknowledged' || typeof call.acknowledged_at === 'string')
    && (expected.status !== 'resolved' || typeof call.resolved_at === 'string')

  results.push({
    name,
    pass,
    detail: pass ? 'estado auditado (esperado)' : `estado inesperado: ${JSON.stringify(call)} ${msg(readError)}`,
  })
}

// Recalcula o total esperado de uma sessão a partir dos pedidos JÁ gravados na
// BD (que vêm normalizados por orders_validate_insert) + entrada de rodízio.
// Espelha a fórmula do trigger payments_validate_insert para que o teste use o
// mesmo amount que a BD vai aceitar, sem depender de números hardcoded.
type ExpectedSession = {
  mode?: string | null
  entryPrice?: number | null
  headcount?: number | null
  openedAt?: string | null
}
type ExpectedOrder = {
  status: string
  createdAt: string
  discountType?: string | null
  discountValue?: number | null
  items: Array<{ price?: unknown; quantity?: unknown }>
}

function expectedPaymentTotal(session: ExpectedSession, orders: ExpectedOrder[]): number {
  let entryTotal = 0
  if (session.mode === 'rodizio' && (session.entryPrice ?? 0) > 0 && (session.headcount ?? 0) > 0) {
    entryTotal = (session.entryPrice as number) * (session.headcount as number)
  }

  let ordersRevenue = 0
  for (const order of orders) {
    if (order.status === 'cancelled') continue
    // Só pedidos a partir do opened_at da sessão entram na conta atual.
    if (session.openedAt && Date.parse(order.createdAt) < Date.parse(session.openedAt)) continue

    let subtotal = 0
    for (const item of order.items) {
      const price = Math.max(Number(item.price) || 0, 0)
      const quantity = Math.min(Math.floor(Math.max(Number(item.quantity) || 0, 0)), 9999)
      subtotal += price * quantity
    }

    const rawDiscount = order.discountType === 'percent'
      ? subtotal * ((order.discountValue ?? 0) / 100)
      : (order.discountValue ?? 0)
    const discount = Math.min(Math.max(rawDiscount, 0), subtotal)
    ordersRevenue += subtotal - discount
  }

  return Math.round((entryTotal + ordersRevenue) * 100) / 100
}

async function okPaymentCreatedAtSnapshot(
  name: string,
  writer: SupabaseClient,
  reader: SupabaseClient,
  row: Record<string, unknown>,
) {
  const forgedCreatedAt = row.created_at
  const { error } = await settle(writer.from('payments').insert(row))
  if (error) {
    results.push({ name, pass: false, detail: 'DEVIA PERMITIR, falhou: ' + msg(error) })
    return
  }

  const { data, error: readError } = await settle(
    reader
      .from('payments')
      .select('created_at')
      .eq('id', row.id as string)
      .maybeSingle(),
  )
  const payment = data as Record<string, unknown> | null
  const pass =
    !readError
    && !!payment
    && typeof payment.created_at === 'string'
    && payment.created_at.includes('T')
    && payment.created_at.endsWith('Z')
    && payment.created_at !== forgedCreatedAt

  results.push({
    name,
    pass,
    detail: pass ? 'timestamp do pagamento veio da BD' : `timestamp inesperado: ${JSON.stringify(payment)} ${msg(readError)}`,
  })
}

async function okPaymentAccountSnapshot(
  name: string,
  reader: SupabaseClient,
  paymentId: string,
  expected: { openedAt: string; mode: string | null; entryPrice: number | null; headcount: number | null },
) {
  const { data, error } = await settle(
    reader
      .from('payments')
      .select('account_opened_at, account_closed_at, account_mode, account_entry_price, account_headcount')
      .eq('id', paymentId)
      .maybeSingle(),
  )
  const payment = data as Record<string, unknown> | null
  const pass =
    !error
    && !!payment
    && payment.account_opened_at === expected.openedAt
    && typeof payment.account_closed_at === 'string'
    && (expected.mode === null || payment.account_mode === expected.mode)
    && (expected.entryPrice === null || Number(payment.account_entry_price) === expected.entryPrice)
    && (expected.headcount === null || Number(payment.account_headcount) === expected.headcount)

  results.push({
    name,
    pass,
    detail: pass ? 'snapshot da conta gravado (esperado)' : `snapshot inesperado: ${JSON.stringify(payment)} ${msg(error)}`,
  })
}

async function okVoidPayment(
  name: string,
  actor: SupabaseClient,
  reader: SupabaseClient,
  params: { paymentId: string; reason: string; action: string },
  expected: { reopened: boolean },
) {
  const { data, error } = await settle(
    actor.rpc('void_payment', {
      p_payment_id: params.paymentId,
      p_reason: params.reason,
      p_action: params.action,
    }),
  )
  const result = rpcResult(data)
  if (error || !result || result.ok !== true || result.reopened !== expected.reopened) {
    results.push({
      name,
      pass: false,
      detail: `DEVIA PERMITIR, devolveu ${JSON.stringify(result)} ${msg(error)}`,
    })
    return
  }

  const { data: readData, error: readError } = await settle(
    reader
      .from('payments')
      .select('voided_at, voided_by, void_reason')
      .eq('id', params.paymentId)
      .maybeSingle(),
  )
  const payment = readData as Record<string, unknown> | null
  const pass =
    !readError
    && !!payment
    && typeof payment.voided_at === 'string'
    && typeof payment.voided_by === 'string'
    && payment.void_reason === params.reason

  results.push({
    name,
    pass,
    detail: pass ? 'anulação auditada (esperado)' : `anulação inesperada: ${JSON.stringify(payment)} ${msg(readError)}`,
  })
}

async function mustWrite(context: string, p: PromiseLike<{ data: unknown; error: unknown }>) {
  const { error } = await settle(p)
  if (error) throw new Error(`${context}: ${msg(error)}`)
}

async function moveOrderToDelivered(actor: SupabaseClient, orderId: string) {
  await mustWrite(`preparar pedido ${orderId}`, actor.from('orders').update({ status: 'preparing' }).eq('id', orderId).select())
  await mustWrite(`pedido pronto ${orderId}`, actor.from('orders').update({ status: 'ready' }).eq('id', orderId).select())
  await mustWrite(`entregar pedido ${orderId}`, actor.from('orders').update({ status: 'delivered' }).eq('id', orderId).select())
}

async function deliverSessionOrders(actor: SupabaseClient, sessionId: string) {
  const { data, error } = await settle(actor.from('orders').select('id, status').eq('session_id', sessionId))
  if (error) throw new Error(`listar pedidos da sessão ${sessionId}: ${msg(error)}`)
  const orders = Array.isArray(data) ? data as Array<{ id: string; status: string }> : []
  for (const order of orders) {
    if (order.status === 'pending') {
      await moveOrderToDelivered(actor, order.id)
    } else if (order.status === 'preparing') {
      await mustWrite(`pedido pronto ${order.id}`, actor.from('orders').update({ status: 'ready' }).eq('id', order.id).select())
      await mustWrite(`entregar pedido ${order.id}`, actor.from('orders').update({ status: 'delivered' }).eq('id', order.id).select())
    } else if (order.status === 'ready') {
      await mustWrite(`entregar pedido ${order.id}`, actor.from('orders').update({ status: 'delivered' }).eq('id', order.id).select())
    }
  }
}

async function closeSessionFixture(actor: SupabaseClient, sessionId: string) {
  await mustWrite(
    `fechar sessão ${sessionId}`,
    actor
      .from('sessions')
      .update({
        open: false,
        access_code_hash: null,
        opened_at: null,
        mode: null,
        entry_price: null,
        headcount: null,
      })
      .eq('id', sessionId)
      .select(),
  )
}

const createdSessionIds: string[] = []
const createdCatIds: string[] = []
const createdItemIds: string[] = []
const createdCallIds: string[] = []
const createdPaymentIds: string[] = []
const createdShiftIds: string[] = []
const uploadedImagePaths: string[] = []

async function main() {
  const A = client(), G = client(), E = client(), C = client(), K = client()
  const AN = client(), AN2 = client(), AN3 = client(), AN4 = client(), P = client()

  async function signIn(c: SupabaseClient, username: string): Promise<string> {
    const { data, error } = await c.auth.signInWithPassword({ email: `${username}@manageeat.local`, password: PW })
    if (error || !data.user) throw new Error(`login ${username} falhou: ${error?.message}`)
    return data.user.id
  }
  const admUid = await signIn(A, 'admin')
  const gerUid = await signIn(G, 'gerente')
  const empUid = await signIn(E, 'empregado')
  const cliUid = await signIn(C, 'cliente')
  const cozUid = await signIn(K, 'cozinha')

  // ── Setup do relógio de ponto (D1) ──
  // Um run anterior interrompido pode ter deixado turnos abertos; com o índice
  // único (1 turno aberto por pessoa) os "pica entrada" abaixo falhariam. O
  // fecho forçado pelo admin é a via legítima.
  await A.from('shifts').update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: admUid })
    .eq('status', 'open').in('opened_by', [admUid, gerUid, empUid, cozUid])
  // Operar (sessões/pedidos/chamadas) exige turno aberto do próprio para
  // empregado e gerente — os fixtures do resto do ficheiro assumem os dois em
  // turno. Os testes "fora de turno" vivem na secção de turnos, que fecha
  // estes turnos e abre outros.
  const empSetupShift = uid(); createdShiftIds.push(empSetupShift)
  await mustWrite('setup: empregado pica entrada', E.from('shifts').insert({ id: empSetupShift, opened_at: new Date().toISOString(), opened_by: empUid, status: 'open' }))
  const gerSetupShift = uid(); createdShiftIds.push(gerSetupShift)
  await mustWrite('setup: gerente pica entrada', G.from('shifts').insert({ id: gerSetupShift, opened_at: new Date().toISOString(), opened_by: gerUid, status: 'open' }))

  // Auth anónima (fluxo QR).
  let anonOk = false
  const anonRes = await settle(AN.auth.signInAnonymously())
  anonOk = !anonRes.error
  results.push({ name: 'Auth anónima ativada (fluxo QR)', pass: anonOk, detail: anonOk ? 'OK' : 'DESATIVADA — pedidos via QR seriam negados' })
  let otherAnonOk = false
  const otherAnonRes = await settle(AN2.auth.signInAnonymously())
  otherAnonOk = !otherAnonRes.error
  let thirdAnonOk = false
  let fourthAnonOk = false
  if (anonOk) {
    thirdAnonOk = !(await settle(AN3.auth.signInAnonymously())).error
    fourthAnonOk = !(await settle(AN4.auth.signInAnonymously())).error
  }

  // Cliente amarrado à mesa 5 (a order() de teste usa mesa 5).
  await A.from('profiles').update({ table_number: 5 }).eq('id', cliUid)

  // settings/restaurant em rodízio/22 para os testes de rodízio (guardar p/ repor).
  const prevSettings = (await A.from('settings').select('*').eq('id', 'restaurant').maybeSingle()).data
  await A.from('settings').upsert({ id: 'restaurant', mode: 'rodizio', entry_price: 22, default_vat_rate: 13 }, { onConflict: 'id' })

  // Itens reais usados pelos pedidos. A partir de agora o trigger recalcula o
  // snapshot contra menu_items; ids fictícios devem falhar.
  const auditCat = uid(); createdCatIds.push(auditCat)
  auditMenuItemId = uid(); createdItemIds.push(auditMenuItemId)
  auditUnavailableItemId = uid(); createdItemIds.push(auditUnavailableItemId)
  auditRodizioItemId = uid(); createdItemIds.push(auditRodizioItemId)
  await A.from('categories').insert({ id: auditCat, name: 'Audit Pedidos', color: '#123456' })
  await A.from('menu_items').insert([
    {
      id: auditMenuItemId,
      name: 'Audit Item Base',
      description: 'Item usado na auditoria',
      price: 10,
      category_id: auditCat,
      available: true,
      discount: 20,
      removable_ingredients: ['cebola', 'molho'],
      vat_rate: 13,
      rodizio_available: false,
    },
    {
      id: auditUnavailableItemId,
      name: 'Audit Indisponível',
      description: 'Item indisponível usado na auditoria',
      price: 5,
      category_id: auditCat,
      available: false,
      discount: null,
      removable_ingredients: [],
      vat_rate: 13,
      rodizio_available: false,
    },
    {
      id: auditRodizioItemId,
      name: 'Audit Rodízio Incluído',
      description: 'Item incluído no rodízio usado na auditoria',
      price: 12,
      category_id: auditCat,
      available: true,
      discount: null,
      removable_ingredients: [],
      vat_rate: 13,
      rodizio_available: true,
    },
  ])

  // Sessões base (empregado cria temporárias).
  auditClientSessionId = 'audit-sess-client-' + rid().slice(6); createdSessionIds.push(auditClientSessionId)
  await E.from('sessions').insert({
    id: auditClientSessionId,
    table_number: 5,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    open: true,
    opened_at: new Date().toISOString(),
  })
  const sessId = 'audit-sess-' + rid().slice(6); createdSessionIds.push(sessId)
  await E.from('sessions').insert({
    id: sessId,
    table_number: 77,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    open: true,
    opened_at: new Date().toISOString(),
  })
  const rodizioSessId = 'audit-sess-rod-' + rid().slice(6); createdSessionIds.push(rodizioSessId)
  await E.from('sessions').insert({
    id: rodizioSessId,
    table_number: 78,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    open: true,
    opened_at: new Date().toISOString(),
    mode: 'rodizio',
    entry_price: 22,
    headcount: 3,
  })

  // ── Leituras públicas ──
  await okReadAny('Público lê categories', P.from('categories').select('*'))
  await okReadAny('Público lê menu_items', P.from('menu_items').select('*'))
  await okReadNonEmpty('Público lê session por RPC', P.rpc('get_public_session', { session_id: sessId }))
  await okReadNonEmpty('Cliente fixo lê sessão aberta da sua mesa por RPC', C.rpc('get_customer_open_session'))
  await denyReadEmpty('Público NÃO lista sessions direto', P.from('sessions').select('*'))
  await denyReadEmpty('Público NÃO lê orders', P.from('orders').select('*'))
  await denyReadEmpty('Público NÃO lê profiles', P.from('profiles').select('*'))
  await deny('Público NÃO cria order (precisa login)', P.from('orders').insert(orderRow()))

  if (anonOk) {
    await deny('Anónimo NÃO cria pedido QR antes de provar código', AN.from('orders').insert(orderRow({ session_id: sessId, table_number: 77 })))
    await okClaim('Anónimo prova/cria código da sessão QR', AN.rpc('claim_session_with_code', { p_session_id: sessId, p_code_hash: 'audit-code-ok' }))
    await denyReadEmpty('Anónimo NÃO lê tabela sessions direto', AN.from('sessions').select('*').eq('id', sessId))
    await denyClaim('Anónimo NÃO prova sessão QR com código errado', AN.rpc('claim_session_with_code', { p_session_id: sessId, p_code_hash: 'audit-code-errado' }))
    await okClaim('Anónimo prova/cria código da sessão rodízio', AN.rpc('claim_session_with_code', { p_session_id: rodizioSessId, p_code_hash: 'audit-code-rodizio' }))
  }

  // ── Criação de pedidos: validações ──
  await deny('Order sem session_id é negado', C.from('orders').insert(orderRow({ session_id: null })))
  await okWrite('Cliente cria pedido válido', C.from('orders').insert(orderRow()))
  await okWrite('Cliente pede para a SUA mesa (5)', C.from('orders').insert(orderRow({ table_number: 5 })))
  await okOrderSnapshot(
    'BD recalcula preço/nome/IVA do item',
    C,
    A,
    orderRow({
      items: [{
        menuItemId: auditMenuItemId,
        menuItemName: 'Nome adulterado',
        quantity: 2,
        price: -50,
        vatRate: 99,
        removedIngredients: ['cebola'],
      }],
    }),
    { menuItemName: 'Audit Item Base', price: 8, vatRate: 13, quantity: 2 },
  )
  await deny('Cliente NÃO pede para outra mesa (9 != perfil 5)', C.from('orders').insert(orderRow({ table_number: 9 })))
  await deny('Cliente NÃO forja status=preparing', C.from('orders').insert(orderRow({ status: 'preparing' })))
  await deny('Cliente NÃO aplica desconto', C.from('orders').insert(orderRow({ discount_type: 'percent', discount_value: 50 })))
  await deny('Cliente NÃO aplica desconto por item', C.from('orders').insert(orderRow({
    items: [{
      menuItemId: auditMenuItemId,
      menuItemName: 'Audit Item Base',
      quantity: 1,
      price: 8,
      itemDiscountType: 'percent',
      itemDiscountValue: 50,
    }],
  })))
  await okWrite('Empregado PODE aplicar desconto', E.from('orders').insert(orderRow({ source: 'empregado', discount_type: 'percent', discount_value: 50 })))
  await okOrderSnapshot(
    'Empregado aplica desconto por item até 100%',
    E,
    A,
    orderRow({
      source: 'empregado',
      items: [{
        menuItemId: auditMenuItemId,
        menuItemName: 'Audit Item Base',
        quantity: 1,
        price: 8,
        itemDiscountType: 'percent',
        itemDiscountValue: 100,
      }],
    }),
    { menuItemName: 'Audit Item Base', price: 0, vatRate: 13, quantity: 1 },
  )
  await deny('Desconto por item >100% é negado', E.from('orders').insert(orderRow({
    source: 'empregado',
    items: [{
      menuItemId: auditMenuItemId,
      menuItemName: 'Audit Item Base',
      quantity: 1,
      price: 8,
      itemDiscountType: 'percent',
      itemDiscountValue: 101,
    }],
  })))
  await deny('Desconto por item em € não passa o preço', E.from('orders').insert(orderRow({
    source: 'empregado',
    items: [{
      menuItemId: auditMenuItemId,
      menuItemName: 'Audit Item Base',
      quantity: 1,
      price: 8,
      itemDiscountType: 'euros',
      itemDiscountValue: 9,
    }],
  })))
  await deny('Desconto global >100% é negado', E.from('orders').insert(orderRow({ source: 'empregado', discount_type: 'percent', discount_value: 101 })))
  await deny('Desconto global em € não passa o subtotal', E.from('orders').insert(orderRow({ source: 'empregado', discount_type: 'euros', discount_value: 999 })))
  await deny('Order com chave extra', C.from('orders').insert(orderRow({ hacked: true })))
  await deny('Order item com chave extra', C.from('orders').insert(orderRow({
    items: [{ menuItemId: auditMenuItemId, menuItemName: 'Audit Item Base', quantity: 1, price: 8, hacked: true }],
  })))
  await deny('Order com item inexistente', C.from('orders').insert(orderRow({
    items: [{ menuItemId: uid(), menuItemName: 'Fantasma', quantity: 1, price: 1 }],
  })))
  await deny('Order com item indisponível', C.from('orders').insert(orderRow({
    items: [{ menuItemId: auditUnavailableItemId, menuItemName: 'Audit Indisponível', quantity: 1, price: 5 }],
  })))
  await deny('Order com ingrediente removido inválido', C.from('orders').insert(orderRow({
    items: [{ menuItemId: auditMenuItemId, menuItemName: 'Audit Item Base', quantity: 1, price: 8, removedIngredients: ['tomate'] }],
  })))
  await deny('Order com quantidade >99', C.from('orders').insert(orderRow({
    items: [{ menuItemId: auditMenuItemId, menuItemName: 'Audit Item Base', quantity: 100, price: 8 }],
  })))
  await deny('Order com items vazios', C.from('orders').insert(orderRow({ items: [] })))
  await deny('Order com 31 items (>30)', C.from('orders').insert(orderRow({ items: Array.from({ length: 31 }, () => ({ menuItemId: 'x', menuItemName: 'n', quantity: 1, price: 1 })) })))
  await deny('Order com table_number 0', C.from('orders').insert(orderRow({ table_number: 0 })))
  await deny('Order com source inválido', C.from('orders').insert(orderRow({ source: 'admin' })))
  await okOrderSnapshot(
    'Order sem created_at recebe timestamp da BD',
    C,
    A,
    orderRow({ created_at: null }),
    { menuItemName: 'Audit Item Base', price: 8, vatRate: 13, quantity: 1, createdAtIsIso: true },
  )
  await okOrderSnapshot(
    'BD limpa cancelamento forjado no insert',
    C,
    A,
    orderRow({ cancelled_at: '1999-01-01T00:00:00.000Z', cancelled_by: admUid, cancel_reason: 'forjado' }),
    { menuItemName: 'Audit Item Base', price: 8, vatRate: 13, quantity: 1, cancelFieldsCleared: true },
  )
  await deny('Order com request_id != id', C.from('orders').insert(orderRow({ id: 'um-id', request_id: 'outro-id' })))

  // ── tableMatchesSession / rodízio ──
  if (anonOk) await okWrite('Order QR com mesa = sessão (77)', AN.from('orders').insert(orderRow({ session_id: sessId, table_number: 77 })))
  if (anonOk) await deny('Order QR com mesa != sessão (88)', AN.from('orders').insert(orderRow({ session_id: sessId, table_number: 88 })))
  await deny('Order QR com sessão inexistente', E.from('orders').insert(orderRow({ session_id: 'nao-existe', table_number: 5, source: 'empregado' })))
  await deny('Cliente fixo NÃO usa sessão de outra mesa', C.from('orders').insert(orderRow({ session_id: sessId, table_number: 77 })))
  if (anonOk) {
    await okOrderSnapshot(
      'Order rodízio grava item incluído a 0',
      AN,
      A,
      orderRow({
        session_id: rodizioSessId,
        table_number: 78,
        mode: 'rodizio',
        entry_price: 22,
        headcount: 3,
        items: [{
          menuItemId: auditRodizioItemId,
          menuItemName: 'Nome forjado rodízio',
          quantity: 1,
          price: 999,
        }],
      }),
      { menuItemName: 'Audit Rodízio Incluído', price: 0, vatRate: 13, quantity: 1 },
    )
  }
  await deny('Order rodízio sem sessão', C.from('orders').insert(orderRow({ session_id: null, mode: 'rodizio', entry_price: 22, headcount: 3 })))
  if (anonOk) await deny('Order rodízio com entrada != sessão', AN.from('orders').insert(orderRow({ session_id: rodizioSessId, table_number: 78, mode: 'rodizio', entry_price: 99, headcount: 3 })))
  if (anonOk) await deny('Order com entrada/headcount sem modo rodízio', AN.from('orders').insert(orderRow({ session_id: rodizioSessId, table_number: 78, entry_price: 22, headcount: 3 })))
  await denyReadEmpty('Cliente autenticado NÃO lê QR sem provar código', C.from('orders').select('*').eq('session_id', sessId))
  if (otherAnonOk) await denyReadEmpty('Outro anónimo NÃO lê pedidos QR sem provar código', AN2.from('orders').select('*').eq('session_id', sessId))
  if (anonOk) await okReadNonEmpty('Anónimo lê pedidos da sessão QR', AN.from('orders').select('*').eq('session_id', sessId))
  await denyReadEmpty('Público NÃO lê pedidos da sessão QR', P.from('orders').select('*').eq('session_id', sessId))

  // ── Invariante da entrada de rodízio ──
  // A entrada (entry_price + headcount) tem de viver sempre num pedido ATIVO e
  // igual à sessão. Testa a propagação do headcount editável e a reatribuição
  // quando o pedido portador é cancelado.
  const entrySessId = 'audit-sess-entry-' + rid().slice(6); createdSessionIds.push(entrySessId)
  await mustWrite('fixture sessão rodízio (invariante de entrada)', E.from('sessions').insert({
    id: entrySessId,
    table_number: 90,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    open: true,
    opened_at: new Date().toISOString(),
    mode: 'rodizio',
    entry_price: 22,
    headcount: 2,
  }))
  const entryCarrierId = rid()
  const entrySecondId = rid()
  const rodizioIncludedItem = { menuItemId: auditRodizioItemId, menuItemName: 'Audit Rodízio Incluído', quantity: 1, price: 0 }
  await mustWrite('fixture pedido portador da entrada', E.from('orders').insert(orderRow({
    id: entryCarrierId, source: 'empregado', session_id: entrySessId, table_number: 90,
    mode: 'rodizio', entry_price: 22, headcount: 2, items: [rodizioIncludedItem],
  })))
  await mustWrite('fixture segundo pedido (sem entrada)', E.from('orders').insert(orderRow({
    id: entrySecondId, source: 'empregado', session_id: entrySessId, table_number: 90,
    mode: 'rodizio', entry_price: 22, headcount: 2, items: [rodizioIncludedItem],
  })))

  await deny('Cliente NÃO edita headcount via RPC', C.rpc('set_session_headcount', { p_session_id: entrySessId, p_headcount: 5 }))
  await deny('Cozinha NÃO edita headcount via RPC (não é staff de sala)', K.rpc('set_session_headcount', { p_session_id: entrySessId, p_headcount: 5 }))
  await deny('Headcount fora de 1..99 é negado', E.rpc('set_session_headcount', { p_session_id: entrySessId, p_headcount: 200 }))
  await okWrite('Empregado edita headcount via RPC', E.rpc('set_session_headcount', { p_session_id: entrySessId, p_headcount: 5 }))

  const carrierAfter = await settle(A.from('orders').select('entry_price, headcount').eq('id', entryCarrierId).single())
  const carrierData = carrierAfter.data as { entry_price?: unknown; headcount?: unknown } | null
  results.push({
    name: 'Headcount editado propaga ao pedido portador',
    pass: !carrierAfter.error && Number(carrierData?.headcount) === 5 && Number(carrierData?.entry_price) === 22,
    detail: carrierAfter.error ? msg(carrierAfter.error) : `entry=${carrierData?.entry_price} headcount=${carrierData?.headcount}`,
  })

  await okWrite('Admin cancela o pedido portador da entrada', A.from('orders').update({
    status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: admUid, cancel_reason: 'Auditoria entrada',
  }).eq('id', entryCarrierId).select(), true)

  const secondAfter = await settle(A.from('orders').select('entry_price, headcount').eq('id', entrySecondId).single())
  const secondData = secondAfter.data as { entry_price?: unknown; headcount?: unknown } | null
  results.push({
    name: 'Entrada reatribuída ao próximo pedido ao cancelar o portador',
    pass: !secondAfter.error && Number(secondData?.entry_price) === 22 && Number(secondData?.headcount) === 5,
    detail: secondAfter.error ? msg(secondAfter.error) : `entry=${secondData?.entry_price} headcount=${secondData?.headcount}`,
  })

  await deny('Entrada do pedido não muda fora do resync de servidor', A.from('orders').update({ entry_price: 999 }).eq('id', entrySecondId).select())

  // ── Leitura / transições de pedidos ──
  // Pedido noutra sessão criado pelo empregado — o cliente fixo não o deve ver.
  const hiddenId = rid()
  await E.from('orders').insert(orderRow({ id: hiddenId, source: 'empregado', session_id: sessId, table_number: 77 }))
  await denyReadEmpty('Cliente NÃO vê pedido de outra sessão', C.from('orders').select('*').eq('id', hiddenId))
  await okReadNonEmpty('Cozinha lê orders', K.from('orders').select('*'))

  const flowId = rid()
  await E.from('orders').insert(orderRow({ id: flowId, source: 'empregado' }))
  await okWrite('Cozinha avança pending→preparing', K.from('orders').update({ status: 'preparing' }).eq('id', flowId).select(), true)
  await okWrite('Cozinha avança preparing→ready', K.from('orders').update({ status: 'ready' }).eq('id', flowId).select(), true)
  await okWrite('Cozinha recua ready→preparing', K.from('orders').update({ status: 'preparing' }).eq('id', flowId).select(), true)
  await deny('Cozinha NÃO salta preparing→delivered', K.from('orders').update({ status: 'delivered' }).eq('id', flowId).select())
  await deny('Cozinha NÃO altera items (só status)', K.from('orders').update({ items: [] }).eq('id', flowId).select())
  await deny('Empregado NÃO altera status', E.from('orders').update({ status: 'ready' }).eq('id', flowId).select())

  // ── Empregado cancela (só não-entregues, com motivo, sem forjar o autor) ──
  const empCancelId = rid()
  await E.from('orders').insert(orderRow({ id: empCancelId, source: 'empregado' }))
  await deny('Empregado NÃO cancela sem motivo', E.from('orders').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: empUid }).eq('id', empCancelId).select())
  await deny('Empregado NÃO forja o autor do cancelamento', E.from('orders').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: cozUid, cancel_reason: 'forjado' }).eq('id', empCancelId).select())
  await okWrite('Empregado cancela com motivo', E.from('orders').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: empUid, cancel_reason: 'Cliente desistiu' }).eq('id', empCancelId).select(), true)

  // Empregado NÃO cancela um pedido já entregue (a cozinha leva-o a delivered).
  const empDeliveredId = rid()
  await E.from('orders').insert(orderRow({ id: empDeliveredId, source: 'empregado' }))
  await K.from('orders').update({ status: 'preparing' }).eq('id', empDeliveredId)
  await K.from('orders').update({ status: 'ready' }).eq('id', empDeliveredId)
  await K.from('orders').update({ status: 'delivered' }).eq('id', empDeliveredId)
  await deny('Empregado NÃO cancela pedido já entregue', E.from('orders').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: empUid, cancel_reason: 'Tarde demais' }).eq('id', empDeliveredId).select())

  await deny('Cliente NÃO apaga pedido', C.from('orders').delete().eq('id', flowId).select())
  await deny('Cozinha NÃO apaga pedido fisicamente', K.from('orders').delete().eq('id', hiddenId).select())
  await deny('Cozinha NÃO cancela sem motivo', K.from('orders').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: cozUid }).eq('id', flowId).select())
  await okWrite('Cozinha cancela com motivo', K.from('orders').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: cozUid, cancel_reason: 'Auditoria' }).eq('id', flowId).select(), true)

  // ── Sessões ──
  await deny('Cliente NÃO cria sessão', C.from('sessions').insert({ id: 'audit-x-' + rid().slice(6), table_number: 1, created_at: new Date().toISOString() }))
  const admSess = 'audit-sess-' + rid().slice(6); createdSessionIds.push(admSess)
  await okWrite('Admin cria sessão permanente', A.from('sessions').insert({ id: admSess, table_number: 6, created_at: new Date().toISOString() }))
  const tmpSess = 'audit-sess-' + rid().slice(6); createdSessionIds.push(tmpSess)
  await okWrite('Empregado cria sessão temporária', E.from('sessions').insert({ id: tmpSess, table_number: 9, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600_000).toISOString() }))
  await deny('Empregado NÃO cria sessão permanente', E.from('sessions').insert({ id: 'audit-x-' + rid().slice(6), table_number: 12, created_at: new Date().toISOString() }))
  await deny('Cozinha NÃO cria sessão', K.from('sessions').insert({ id: 'audit-x-' + rid().slice(6), table_number: 14, created_at: new Date().toISOString() }))
  const tmpRod = 'audit-sess-' + rid().slice(6); createdSessionIds.push(tmpRod)
  await okWrite('Empregado cria sessão rodízio (entrada = settings)', E.from('sessions').insert({ id: tmpRod, table_number: 10, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600_000).toISOString(), mode: 'rodizio', entry_price: 22, headcount: 2 }))
  await deny('Sessão rodízio com entrada != settings', E.from('sessions').insert({ id: 'audit-x-' + rid().slice(6), table_number: 13, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600_000).toISOString(), mode: 'rodizio', entry_price: 18, headcount: 2 }))
  await deny('Sessão rodízio sem headcount', E.from('sessions').insert({ id: 'audit-x-' + rid().slice(6), table_number: 11, created_at: new Date().toISOString(), mode: 'rodizio', entry_price: 22 }))

  // ── Ciclo de vida da sessão (admSess permanente, idle) ──
  await deny('Cliente NÃO define código por update direto', C.from('sessions').update({ access_code_hash: 'abc123' }).eq('id', admSess).select())
  await denyClaim('Cliente NÃO prova código sem sessão aberta', C.rpc('claim_session_with_code', { p_session_id: admSess, p_code_hash: 'abc123' }))
  await okWrite('Empregado inicia sessão', E.from('sessions').update({ open: true, opened_at: new Date().toISOString() }).eq('id', admSess).select(), true)
  await deny('Empregado NÃO altera table_number via update', E.from('sessions').update({ table_number: 7 }).eq('id', admSess).select())
  await deny('Cozinha NÃO altera sessão (read-only na sala)', K.from('sessions').update({ open: false }).eq('id', admSess).select())
  await okClaim('Cliente prova/cria código de acesso via RPC', C.rpc('claim_session_with_code', { p_session_id: admSess, p_code_hash: 'abc123' }))
  await denyClaim('Cliente NÃO muda código já definido', C.rpc('claim_session_with_code', { p_session_id: admSess, p_code_hash: 'zzz999' }))
  if (otherAnonOk) {
    await denyClaim('QR tentativa errada 1/5', AN2.rpc('claim_session_with_code', { p_session_id: admSess, p_code_hash: 'err-1' }))
    await denyClaim('QR tentativa errada 2/5', AN2.rpc('claim_session_with_code', { p_session_id: admSess, p_code_hash: 'err-2' }))
    await denyClaim('QR tentativa errada 3/5', AN2.rpc('claim_session_with_code', { p_session_id: admSess, p_code_hash: 'err-3' }))
    await denyClaim('QR tentativa errada 4/5', AN2.rpc('claim_session_with_code', { p_session_id: admSess, p_code_hash: 'err-4' }))
    await denyClaim('QR bloqueia à 5ª tentativa errada', AN2.rpc('claim_session_with_code', { p_session_id: admSess, p_code_hash: 'err-5' }))
    // O anónimo bloqueado NÃO pode apagar as próprias tentativas para limpar o
    // lockout (auditoria rls-definer-privesc-0). A linha existe (5 falhas acima);
    // a policy só deixa o staff apagar. Se isto passasse, a linha 'ainda bloqueado'
    // a seguir também falharia.
    await deny('QR anónimo NÃO apaga as próprias tentativas (contornar lockout)', AN2.from('session_code_attempts').delete().eq('session_id', admSess).select())
    await denyClaim('QR bloqueado NÃO entra mesmo com código certo', AN2.rpc('claim_session_with_code', { p_session_id: admSess, p_code_hash: 'abc123' }))
    await okWrite('Empregado reseta código QR', E.rpc('reset_session_access_code', { p_session_id: admSess }))
    await okClaim('QR entra após reset com novo código', AN2.rpc('claim_session_with_code', { p_session_id: admSess, p_code_hash: 'novo123' }))
  }
  if (otherAnonOk && thirdAnonOk && fourthAnonOk) {
    const sessionLockSess = 'audit-sess-qr-lock-' + rid().slice(6); createdSessionIds.push(sessionLockSess)
    await okWrite('Empregado cria sessão dedicada ao bloqueio QR', E.from('sessions').insert({
      id: sessionLockSess,
      table_number: 86,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      open: true,
      opened_at: new Date().toISOString(),
    }))
    await okClaim('QR define código na sessão dedicada', AN.rpc('claim_session_with_code', { p_session_id: sessionLockSess, p_code_hash: 'codigo-certo' }))
    for (let i = 1; i <= 5; i++) {
      await denyClaim(`QR atacante A tentativa errada ${i}/5`, AN2.rpc('claim_session_with_code', { p_session_id: sessionLockSess, p_code_hash: `a-err-${i}` }))
    }
    for (let i = 1; i <= 4; i++) {
      await denyClaim(`QR atacante B tentativa errada ${i}/5`, AN3.rpc('claim_session_with_code', { p_session_id: sessionLockSess, p_code_hash: `b-err-${i}` }))
    }
    await denyClaim('QR bloqueio por sessão dispara com tentativas distribuídas', AN3.rpc('claim_session_with_code', { p_session_id: sessionLockSess, p_code_hash: 'b-err-5' }))
    await denyClaim('QR bloqueio por sessão trava novo anónimo com código certo', AN4.rpc('claim_session_with_code', { p_session_id: sessionLockSess, p_code_hash: 'codigo-certo' }))
    await okWrite('Empregado reseta bloqueio QR da sessão', E.rpc('reset_session_access_code', { p_session_id: sessionLockSess }))
    await okClaim('QR entra depois do reset do bloqueio por sessão', AN4.rpc('claim_session_with_code', { p_session_id: sessionLockSess, p_code_hash: 'codigo-novo' }))
  }
  const oldPermanentOrder = rid()
  await E.from('orders').insert(orderRow({ id: oldPermanentOrder, source: 'empregado', session_id: admSess, table_number: 6 }))
  // D6: fechar mesa exige pedidos arrumados — entregar antes de fechar.
  await deliverSessionOrders(A, admSess)
  await okWrite('Empregado fecha sessão', E.from('sessions').update({ open: false, access_code_hash: null, opened_at: null }).eq('id', admSess).select(), true)
  await new Promise((resolve) => setTimeout(resolve, 1100))
  await okWrite('Empregado reabre QR permanente para nova conta', E.from('sessions').update({ open: true, opened_at: new Date().toISOString() }).eq('id', admSess).select(), true)
  await okClaim('QR prova código da nova conta', AN.rpc('claim_session_with_code', { p_session_id: admSess, p_code_hash: 'conta-nova' }))
  const newPermanentOrder = rid()
  await okWrite('QR da nova conta cria pedido', AN.from('orders').insert(orderRow({ id: newPermanentOrder, source: 'cliente', session_id: admSess, table_number: 6 })))
  await denyReadEmpty('QR da nova conta NÃO vê pedidos da conta antiga', AN.from('orders').select('*').eq('id', oldPermanentOrder))
  if (otherAnonOk) {
    await denyReadEmpty('QR antigo NÃO vê pedidos da nova conta sem novo código', AN2.from('orders').select('*').eq('id', newPermanentOrder))
  }
  await deliverSessionOrders(A, admSess)
  await okWrite('Empregado fecha sessão reaberta', E.from('sessions').update({ open: false, access_code_hash: null, opened_at: null }).eq('id', admSess).select(), true)

  // QR permanente reutilizado em rodízio: a entrada pertence à conta aberta
  // atual (opened_at). Pedidos antigos da mesma sessão não podem impedir o
  // primeiro pedido da nova conta de carregar entry_price/headcount.
  const rodPermSess = 'audit-sess-rod-perm-' + rid().slice(6); createdSessionIds.push(rodPermSess)
  const rodPermOldOpenedAt = new Date().toISOString()
  await okWrite('Admin cria QR permanente rodízio', A.from('sessions').insert({
    id: rodPermSess,
    table_number: 91,
    created_at: rodPermOldOpenedAt,
    open: true,
    opened_at: rodPermOldOpenedAt,
    mode: 'rodizio',
    entry_price: 22,
    headcount: 2,
  }))
  await okWrite('Pedido antigo do QR permanente rodízio carrega entrada', E.from('orders').insert(orderRow({
    source: 'empregado',
    session_id: rodPermSess,
    table_number: 91,
    mode: 'rodizio',
    entry_price: 22,
    headcount: 2,
    items: [rodizioIncludedItem],
  })))
  await deliverSessionOrders(A, rodPermSess)
  await okWrite('Empregado fecha QR permanente rodízio antigo', E.from('sessions').update({
    open: false,
    access_code_hash: null,
    opened_at: null,
    mode: null,
    entry_price: null,
    headcount: null,
  }).eq('id', rodPermSess).select(), true)
  await new Promise((resolve) => setTimeout(resolve, 1100))
  const rodPermNewOpenedAt = new Date().toISOString()
  await okWrite('Empregado reabre QR permanente rodízio para nova conta', E.from('sessions').update({
    open: true,
    opened_at: rodPermNewOpenedAt,
    mode: 'rodizio',
    entry_price: 22,
    headcount: 3,
  }).eq('id', rodPermSess).select(), true)
  if (anonOk) await okClaim('QR prova código da nova conta rodízio permanente', AN.rpc('claim_session_with_code', { p_session_id: rodPermSess, p_code_hash: 'rod-perm-nova' }))
  const rodPermNewOrder = rid()
  if (anonOk) await okWrite('QR permanente rodízio cria pedido da nova conta', AN.from('orders').insert(orderRow({
    id: rodPermNewOrder,
    source: 'cliente',
    session_id: rodPermSess,
    table_number: 91,
    mode: 'rodizio',
    entry_price: 22,
    headcount: 3,
    items: [rodizioIncludedItem],
  })))
  const rodPermNew = await settle(A.from('orders').select('entry_price, headcount').eq('id', rodPermNewOrder).single())
  const rodPermNewData = rodPermNew.data as { entry_price?: unknown; headcount?: unknown } | null
  if (anonOk) {
    results.push({
      name: 'QR permanente rodízio nova conta recebe entrada própria',
      pass: !rodPermNew.error && Number(rodPermNewData?.entry_price) === 22 && Number(rodPermNewData?.headcount) === 3,
      detail: rodPermNew.error ? msg(rodPermNew.error) : `entry=${rodPermNewData?.entry_price} headcount=${rodPermNewData?.headcount}`,
    })
  }
  await deliverSessionOrders(A, rodPermSess)
  await okWrite('Empregado fecha QR permanente rodízio reaberto', E.from('sessions').update({
    open: false,
    access_code_hash: null,
    opened_at: null,
    mode: null,
    entry_price: null,
    headcount: null,
  }).eq('id', rodPermSess).select(), true)

  // ── Chamadas de serviço ──
  await denyReadEmpty('Público NÃO lê service_calls', P.from('service_calls').select('*'))
  await okReadAny('Staff lê service_calls', K.from('service_calls').select('*'))
  const call1 = rid(); createdCallIds.push(call1)
  await okServiceCallInsertSnapshot(
    'Cliente cria chamada; BD força open/timestamp',
    C,
    A,
    {
      id: call1,
      type: 'waiter',
      table_number: 5,
      session_id: auditClientSessionId,
      created_at: '1999-01-01T00:00:00.000Z',
      status: 'resolved',
      resolved_at: '1999-01-01T00:00:00.000Z',
      resolved_by: admUid,
    },
  )
  await deny('Chamada sem session_id é negada', C.from('service_calls').insert({ id: rid(), type: 'waiter', table_number: 5, created_at: new Date().toISOString() }))
  const call2 = rid(); createdCallIds.push(call2)
  await okWrite('Anónimo cria chamada QR (mesa = sessão)', (anonOk ? AN : C).from('service_calls').insert({ id: call2, type: 'waiter', table_number: 77, session_id: sessId, created_at: new Date().toISOString() }))
  if (otherAnonOk) {
    const helpSess = 'audit-sess-help-' + rid().slice(6); createdSessionIds.push(helpSess)
    await okWrite('Empregado cria sessão dedicada a chamada sem código', E.from('sessions').insert({
      id: helpSess,
      table_number: 79,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      open: true,
      opened_at: new Date().toISOString(),
    }))
    const helpCall = rid(); createdCallIds.push(helpCall)
    await okWrite('Outro anónimo PODE chamar empregado QR sem código', AN2.from('service_calls').insert({ id: helpCall, type: 'waiter', table_number: 79, session_id: helpSess, created_at: new Date().toISOString() }))
    await deny('Outro anónimo NÃO duplica chamada ativa sem código', AN2.from('service_calls').insert({ id: rid(), type: 'waiter', table_number: 79, session_id: helpSess, created_at: new Date().toISOString() }))
    await deny('Outro anónimo NÃO pede conta QR sem código', AN2.from('service_calls').insert({ id: rid(), type: 'bill', table_number: 79, session_id: helpSess, created_at: new Date().toISOString() }))
  }
  await deny('Chamada com type inválido', C.from('service_calls').insert({ id: rid(), type: 'hack', table_number: 5, session_id: auditClientSessionId, created_at: new Date().toISOString() }))
  await deny('Chamada com table_number 0', C.from('service_calls').insert({ id: rid(), type: 'waiter', table_number: 0, session_id: auditClientSessionId, created_at: new Date().toISOString() }))
  await deny('Cliente NÃO cria chamada noutra mesa', C.from('service_calls').insert({ id: rid(), type: 'waiter', table_number: 9, session_id: auditClientSessionId, created_at: new Date().toISOString() }))
  if (anonOk) await deny('Chamada QR com mesa != sessão', AN.from('service_calls').insert({ id: rid(), type: 'waiter', table_number: 88, session_id: sessId, created_at: new Date().toISOString() }))
  await okServiceCallStatusSnapshot(
    'Empregado assume chamada e BD grava quem/quando',
    E,
    A,
    call1,
    { status: 'acknowledged', acknowledged_by: admUid, acknowledged_at: '1999-01-01T00:00:00.000Z' },
    { status: 'acknowledged', acknowledgedBy: empUid, resolvedBy: null },
  )
  await deny('Cozinha NÃO resolve chamada', K.from('service_calls').update({ status: 'resolved' }).eq('id', call1).select())
  await okServiceCallStatusSnapshot(
    'Gerente resolve chamada assumida',
    G,
    A,
    call1,
    { status: 'resolved', resolved_by: admUid, resolved_at: '1999-01-01T00:00:00.000Z' },
    { status: 'resolved', acknowledgedBy: empUid, resolvedBy: gerUid },
  )
  await deny('Empregado NÃO reabre chamada resolvida', E.from('service_calls').update({ status: 'open' }).eq('id', call1).select())
  await deny('Cliente NÃO atualiza chamada', C.from('service_calls').update({ status: 'acknowledged' }).eq('id', call2).select())
  await deny('Empregado NÃO altera mesa/tipo da chamada', E.from('service_calls').update({ table_number: 6, type: 'bill' }).eq('id', call2).select())
  await okServiceCallStatusSnapshot(
    'Admin resolve chamada diretamente',
    A,
    A,
    call2,
    { status: 'resolved' },
    { status: 'resolved', acknowledgedBy: null, resolvedBy: admUid },
  )
  await deny('Gerente NÃO apaga chamada fisicamente', G.from('service_calls').delete().eq('id', call1).select())
  await okWrite('Admin apaga chamada fisicamente (correção/cleanup)', A.from('service_calls').delete().eq('id', call1).select(), true)

  // ── Profiles / escalonamento ──
  await okReadNonEmpty('Cliente lê o PRÓPRIO profile', C.from('profiles').select('*').eq('id', cliUid))
  await denyReadEmpty('Cliente NÃO lê profile alheio', C.from('profiles').select('*').eq('id', empUid))
  await okReadNonEmpty('Admin lê profile alheio', A.from('profiles').select('*').eq('id', empUid))
  await deny('Empregado NÃO escala o próprio role p/ admin', E.from('profiles').update({ role: 'admin' }).eq('id', empUid).select())
  await deny('Cliente NÃO desativa outro user', C.from('profiles').update({ active: false }).eq('id', empUid).select())

  // ── Menu / categorias: escrita admin/gerente, validada ──
  await deny('Empregado NÃO cria categoria', E.from('categories').insert({ name: 'Hack' }))
  await deny('Cliente NÃO cria menu item', C.from('menu_items').insert({ name: 'Hack', price: 1, category_id: 'x', available: true, discount: null, description: '' }))
  const cat1 = uid(); createdCatIds.push(cat1)
  await okWrite('Admin cria categoria', A.from('categories').insert({ id: cat1, name: 'Audit Cat', color: '#123456' }))
  const item1 = uid(); createdItemIds.push(item1)
  await okWrite('Admin cria menu item', A.from('menu_items').insert({ id: item1, name: 'Audit Item', description: 'x', price: 5, category_id: cat1, available: true, discount: null }))
  await okWrite('Admin toggla available (update parcial)', A.from('menu_items').update({ available: false }).eq('id', item1).select(), true)
  await deny('Item com price negativo', A.from('menu_items').insert({ id: uid(), name: 'x', description: 'x', price: -1, category_id: cat1, available: true, discount: null }))
  await deny('Item com campo desconhecido', A.from('menu_items').insert({ id: uid(), name: 'x', description: 'x', price: 1, category_id: cat1, available: true, discount: null, hacked: true }))
  await deny('Categoria sem nome', A.from('categories').insert({ id: uid(), name: '' }))

  // ── Settings ──
  await okReadAny('Público lê settings', P.from('settings').select('*').eq('id', 'restaurant'))
  await deny('Empregado NÃO escreve settings', E.from('settings').upsert({ id: 'audit-settings', mode: 'normal', entry_price: 0 }, { onConflict: 'id' }))
  await deny('Admin NÃO escreve settings mixed sem entrada', A.from('settings').upsert({ id: 'audit-settings', mode: 'mixed', entry_price: 0 }, { onConflict: 'id' }))
  await okWrite('Admin escreve settings (doc de teste)', A.from('settings').upsert({ id: 'audit-settings', mode: 'normal', entry_price: 0, name: 'Teste', nif: '500123456', default_vat_rate: 13 }, { onConflict: 'id' }))
  await deny('Admin NÃO escreve settings com IVA > 100', A.from('settings').upsert({ id: 'audit-settings', mode: 'normal', entry_price: 0, default_vat_rate: 150 }, { onConflict: 'id' }))

  // ── Turnos (relógio de ponto) / pagamentos ──
  // Fechar TODOS os turnos abertos (incluindo os do setup) para testar o D1
  // "fora de turno" e para os "pica entrada" abaixo não colidirem com o
  // índice único (1 turno aberto por pessoa).
  await A.from('shifts').update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: admUid })
    .eq('status', 'open').in('opened_by', [admUid, gerUid, empUid, cozUid])

  // ── D1: fora de turno não se opera; admin e cozinha são isentos ──
  // Fixtures criados por quem não precisa de turno (admin/cliente): um pedido
  // pendente e uma chamada aberta para o empregado/gerente tentarem mexer.
  const d1OrderId = rid()
  await mustWrite('fixture pedido para os testes D1', A.from('orders').insert(orderRow({ id: d1OrderId, source: 'empregado' })))
  const d1CallId = rid(); createdCallIds.push(d1CallId)
  await mustWrite('fixture chamada para os testes D1', C.from('service_calls').insert({ id: d1CallId, type: 'waiter', table_number: 5, session_id: auditClientSessionId, created_at: new Date().toISOString() }))
  await deny('Empregado fora de turno NÃO cria sessão', E.from('sessions').insert({ id: 'audit-x-' + rid().slice(6), table_number: 15, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600_000).toISOString() }))
  await deny('Empregado fora de turno NÃO envia pedido', E.from('orders').insert(orderRow({ source: 'empregado' })))
  await deny('Empregado fora de turno NÃO cancela pedido', E.from('orders').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: empUid, cancel_reason: 'D1 fora de turno' }).eq('id', d1OrderId).select())
  await deny('Empregado fora de turno NÃO assume chamada de mesa', E.from('service_calls').update({ status: 'acknowledged' }).eq('id', d1CallId).select())
  await deny('Gerente fora de turno NÃO muda estado de pedido', G.from('orders').update({ status: 'preparing' }).eq('id', d1OrderId).select())
  await okWrite('Cozinha muda estado de pedido sem turno (isenta)', K.from('orders').update({ status: 'preparing' }).eq('id', d1OrderId).select(), true)
  const d1AdminSess = 'audit-sess-d1-admin-' + rid().slice(6); createdSessionIds.push(d1AdminSess)
  await okWrite('Admin cria sessão sem turno (isento)', A.from('sessions').insert({ id: d1AdminSess, table_number: 15, created_at: new Date().toISOString() }))
  // Gerir a mesa também é operação: abrir, fechar, headcount e reset do código
  // passam pelo mesmo gate (trigger de UPDATE de sessions).
  await deny('Empregado fora de turno NÃO abre a mesa', E.from('sessions').update({ open: true, opened_at: new Date().toISOString() }).eq('id', d1AdminSess).select())
  await deny('Empregado fora de turno NÃO fecha a mesa', E.from('sessions').update({ open: false, access_code_hash: null, opened_at: null }).eq('id', auditClientSessionId).select())
  await deny('Empregado fora de turno NÃO muda o headcount', E.rpc('set_session_headcount', { p_session_id: rodizioSessId, p_headcount: 4 }))
  await deny('Empregado fora de turno NÃO reseta o código QR', E.rpc('reset_session_access_code', { p_session_id: sessId }))

  const shift1 = uid(); createdShiftIds.push(shift1)
  await okWrite('Admin cria turno fechado de teste', A.from('shifts').insert({
    id: shift1,
    opened_at: new Date(Date.now() - 60_000).toISOString(),
    opened_by: admUid,
    status: 'closed',
    closed_at: new Date().toISOString(),
    closed_by: admUid,
  }))
  await okReadAny('Empregado lê turnos', E.from('shifts').select('*'))
  const empShift = uid(); createdShiftIds.push(empShift)
  await okWrite('Empregado pica entrada (abre o seu turno)', E.from('shifts').insert({ id: empShift, opened_at: new Date().toISOString(), opened_by: empUid, status: 'open' }))
  // D1: com o turno aberto volta a poder operar — fecha a chamada dos testes
  // "fora de turno" acima (e prova o caminho feliz do gate).
  await okWrite('Empregado em turno volta a operar (assume a chamada)', E.from('service_calls').update({ status: 'acknowledged' }).eq('id', d1CallId).select(), true)
  await okWrite('Empregado em turno resolve a chamada', E.from('service_calls').update({ status: 'resolved' }).eq('id', d1CallId).select(), true)
  await okWrite('Empregado em turno abre a mesa', E.from('sessions').update({ open: true, opened_at: new Date().toISOString() }).eq('id', d1AdminSess).select(), true)
  await okWrite('Empregado em turno fecha a mesa', E.from('sessions').update({ open: false, access_code_hash: null, opened_at: null }).eq('id', d1AdminSess).select(), true)

  // ── D3: apagar QR permanente com conta aberta é negado ──
  const d3PermSess = 'audit-sess-d3-perm-' + rid().slice(6); createdSessionIds.push(d3PermSess)
  await mustWrite('fixture QR permanente aberto (D3)', A.from('sessions').insert({ id: d3PermSess, table_number: 16, created_at: new Date().toISOString(), open: true, opened_at: new Date().toISOString() }))
  await deny('Admin NÃO apaga QR permanente com conta aberta', A.from('sessions').delete().eq('id', d3PermSess).select())
  await okWrite('Admin fecha a conta do QR permanente', A.from('sessions').update({ open: false, access_code_hash: null, opened_at: null }).eq('id', d3PermSess).select(), true)
  await okWrite('Admin apaga QR permanente fechado', A.from('sessions').delete().eq('id', d3PermSess).select(), true)
  await deny('Empregado NÃO pica entrada com turno já aberto', E.from('shifts').insert({ id: uid(), opened_at: new Date().toISOString(), opened_by: empUid, status: 'open' }))
  await deny('Empregado NÃO abre turno de outro', E.from('shifts').insert({ id: uid(), opened_at: new Date().toISOString(), opened_by: admUid, status: 'open' }))
  await deny('Gerente NÃO cria turno com opened_by forjado', G.from('shifts').insert({ id: uid(), opened_at: new Date().toISOString(), opened_by: admUid, status: 'open' }))
  await deny('Gerente NÃO cria turno fechado com closed_by forjado', G.from('shifts').insert({ id: uid(), opened_at: new Date().toISOString(), opened_by: gerUid, status: 'closed', closed_at: new Date().toISOString(), closed_by: admUid }))
  const cozShift = uid(); createdShiftIds.push(cozShift)
  await okWrite('Cozinha pica entrada (abre o seu turno)', K.from('shifts').insert({ id: cozShift, opened_at: new Date().toISOString(), opened_by: cozUid, status: 'open' }))
  await deny('Empregado NÃO fecha turno de outro', E.from('shifts').update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: empUid }).eq('id', cozShift).select())
  await okWrite('Admin força a saída do turno de outro', A.from('shifts').update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: admUid }).eq('id', cozShift).select(), true)
  await deny('Turno fechado não se altera', A.from('shifts').update({ closed_at: new Date().toISOString(), closed_by: admUid }).eq('id', cozShift).select())
  const admShift = uid(); createdShiftIds.push(admShift)
  await okWrite('Admin pica entrada (abre o seu turno)', A.from('shifts').insert({ id: admShift, opened_at: new Date().toISOString(), opened_by: admUid, status: 'open' }))
  // Sessão à la carte numa mesa que mais nenhum teste usa (mesa 3). O empregado
  // mete pedidos reais nela; o pagamento só passa se o amount = total recalculado.
  const paySessOpenedAt = new Date().toISOString()
  const paySess = 'audit-sess-pay-' + rid().slice(6); createdSessionIds.push(paySess)
  await E.from('sessions').insert({
    id: paySess,
    table_number: 3,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    open: true,
    opened_at: paySessOpenedAt,
  })
  // Dois pedidos válidos do empregado nesta sessão. As linhas ficam normalizadas
  // pelo trigger de orders (preço do menu com desconto), por isso reler da BD dá
  // o snapshot fiável para calcular o total.
  await E.from('orders').insert(orderRow({ id: rid(), source: 'empregado', session_id: paySess, table_number: 3 }))
  await E.from('orders').insert(orderRow({ id: rid(), source: 'empregado', session_id: paySess, table_number: 3, items: [{ menuItemId: auditMenuItemId, menuItemName: 'x', quantity: 2, price: 1, vatRate: 1 }] }))
  const paySessOrders = (await E.from('orders').select('status, created_at, discount_type, discount_value, items').eq('session_id', paySess)).data ?? []
  const paySessTotal = expectedPaymentTotal(
    { mode: 'normal', openedAt: paySessOpenedAt },
    (paySessOrders as Array<Record<string, unknown>>).map((o) => ({
      status: o.status as string,
      createdAt: o.created_at as string,
      discountType: o.discount_type as string | null,
      discountValue: o.discount_value as number | null,
      items: o.items as Array<{ price?: unknown; quantity?: unknown }>,
    })),
  )
  await deny('Pagamento com pedidos por concluir é negado', E.from('payments').insert({
    id: uid(),
    table_number: 3,
    session_id: paySess,
    amount: paySessTotal,
    method: 'cartao',
    shift_id: empShift,
    created_at: new Date().toISOString(),
    created_by: empUid,
  }))
  await deliverSessionOrders(A, paySess)
  // As guardas do turno testam-se ANTES do 1.º pagamento: depois dele, quem
  // dispara primeiro é a guarda "conta já tem um pagamento ativo" e o teste
  // passaria pelo motivo errado.
  await deny('Pagamento sem turno é negado', E.from('payments').insert({ id: uid(), table_number: 3, session_id: paySess, amount: paySessTotal, method: 'dinheiro', created_at: new Date().toISOString(), created_by: empUid }))
  await deny('Pagamento com turno de outro utilizador é negado', E.from('payments').insert({ id: uid(), table_number: 3, session_id: paySess, amount: paySessTotal, method: 'dinheiro', shift_id: admShift, created_at: new Date().toISOString(), created_by: empUid }))
  await deny('Pagamento com turno inexistente é negado', E.from('payments').insert({ id: uid(), table_number: 3, session_id: paySess, amount: paySessTotal, method: 'dinheiro', shift_id: uid(), created_at: new Date().toISOString(), created_by: empUid }))
  await deny('Pagamento com turno fechado é negado', E.from('payments').insert({ id: uid(), table_number: 3, session_id: paySess, amount: paySessTotal, method: 'dinheiro', shift_id: shift1, created_at: new Date().toISOString(), created_by: empUid }))
  const pay1 = uid(); createdPaymentIds.push(pay1)
  await okPaymentCreatedAtSnapshot(
    'Pagamento recalcula total e força timestamp da BD',
    E,
    A,
    {
      id: pay1,
      table_number: 3,
      session_id: paySess,
      amount: paySessTotal,
      method: 'cartao',
      shift_id: empShift,
      created_at: '1900-01-01T00:00:00.000Z',
      created_by: empUid,
    },
  )
  await okPaymentAccountSnapshot('Pagamento grava snapshot seguro da conta', A, pay1, {
    openedAt: paySessOpenedAt,
    mode: 'normal',
    entryPrice: null,
    headcount: null,
  })
  await deny('Pagamento com amount inflacionado é negado', E.from('payments').insert({ id: uid(), table_number: 3, session_id: paySess, amount: paySessTotal + 50, method: 'cartao', shift_id: empShift, created_at: new Date().toISOString(), created_by: empUid }))
  await deny('Pagamento com amount a zero/baixo é negado', E.from('payments').insert({ id: uid(), table_number: 3, session_id: paySess, amount: 0.01, method: 'dinheiro', shift_id: empShift, created_at: new Date().toISOString(), created_by: empUid }))
  await okReadAny('Staff lê pagamentos', E.from('payments').select('*'))
  await deny('Pagamento sem session_id é negado', E.from('payments').insert({ id: uid(), table_number: 3, amount: paySessTotal, method: 'dinheiro', shift_id: empShift, created_at: new Date().toISOString(), created_by: empUid }))
  await deny('Pagamento com método inválido', E.from('payments').insert({ id: uid(), table_number: 3, session_id: paySess, amount: paySessTotal, method: 'cripto', shift_id: empShift, created_at: new Date().toISOString(), created_by: empUid }))
  await deny('Pagamento com created_by forjado', E.from('payments').insert({ id: uid(), table_number: 3, session_id: paySess, amount: paySessTotal, method: 'dinheiro', created_at: new Date().toISOString(), created_by: admUid }))
  await deny('Cliente NÃO cria pagamento', C.from('payments').insert({ id: uid(), table_number: 3, session_id: paySess, amount: paySessTotal, method: 'dinheiro', created_at: new Date().toISOString(), created_by: cliUid }))
  await deny('Cozinha NÃO cria pagamento', K.from('payments').insert({ id: uid(), table_number: 3, session_id: paySess, amount: paySessTotal, method: 'dinheiro', created_at: new Date().toISOString(), created_by: cozUid }))
  await closeSessionFixture(E, paySess)
  await deny('Empregado NÃO anula pagamento', E.rpc('void_payment', { p_payment_id: pay1, p_reason: 'Sem permissão', p_action: 'void_only' }))
  await deny('Cozinha NÃO anula pagamento', K.rpc('void_payment', { p_payment_id: pay1, p_reason: 'Sem permissão', p_action: 'void_only' }))
  await deny('Cliente NÃO anula pagamento', C.rpc('void_payment', { p_payment_id: pay1, p_reason: 'Sem permissão', p_action: 'void_only' }))
  await deny('Anulação sem motivo é negada', G.rpc('void_payment', { p_payment_id: pay1, p_reason: '   ', p_action: 'void_only' }))
  await okVoidPayment('Gerente anula pagamento e reabre mesa', G, A, {
    paymentId: pay1,
    reason: 'Correção auditada pelo teste',
    action: 'reopen_session',
  }, { reopened: true })
  await okReadNonEmpty('Anulação com reabertura restaura sessão aberta', A.from('sessions').select('*').eq('id', paySess).eq('open', true).eq('opened_at', paySessOpenedAt))
  await deny('Pagamento já anulado NÃO anula de novo', G.rpc('void_payment', { p_payment_id: pay1, p_reason: 'Duplicado', p_action: 'void_only' }))
  await closeSessionFixture(E, paySess)
  const emptyPaySess = 'audit-sess-empty-pay-' + rid().slice(6); createdSessionIds.push(emptyPaySess)
  await E.from('sessions').insert({
    id: emptyPaySess,
    table_number: 85,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    open: true,
    opened_at: new Date().toISOString(),
  })
  await deny('Pagamento zero numa conta vazia é negado', E.from('payments').insert({ id: uid(), table_number: 85, session_id: emptyPaySess, amount: 0, method: 'dinheiro', shift_id: empShift, created_at: new Date().toISOString(), created_by: empUid }))
  const adminPaySessOpenedAt = new Date().toISOString()
  const adminPaySess = 'audit-sess-admin-pay-' + rid().slice(6); createdSessionIds.push(adminPaySess)
  await E.from('sessions').insert({
    id: adminPaySess,
    table_number: 87,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    open: true,
    opened_at: adminPaySessOpenedAt,
  })
  await E.from('orders').insert(orderRow({ id: rid(), source: 'empregado', session_id: adminPaySess, table_number: 87 }))
  await deliverSessionOrders(A, adminPaySess)
  const adminPayOrders = (await E.from('orders').select('status, created_at, discount_type, discount_value, items').eq('session_id', adminPaySess)).data ?? []
  const adminPayTotal = expectedPaymentTotal(
    { mode: 'normal', openedAt: adminPaySessOpenedAt },
    (adminPayOrders as Array<Record<string, unknown>>).map((o) => ({
      status: o.status as string,
      createdAt: o.created_at as string,
      discountType: o.discount_type as string | null,
      discountValue: o.discount_value as number | null,
      items: o.items as Array<{ price?: unknown; quantity?: unknown }>,
    })),
  )
  // D1 (isenção do admin): o dono cobra sem turno, mas um shift_id enviado
  // valida-se sempre — os denies correm ANTES do pagamento ok (gotcha da
  // guarda "conta já tem pagamento ativo").
  await deny('Admin NÃO cobra com shift_id de turno fechado', A.from('payments').insert({ id: uid(), table_number: 87, session_id: adminPaySess, amount: adminPayTotal, method: 'dinheiro', shift_id: shift1, created_at: new Date().toISOString(), created_by: admUid }))
  const adminPay = uid(); createdPaymentIds.push(adminPay)
  await okWrite('Admin cobra sem turno (shift_id null aceite)', A.from('payments').insert({ id: adminPay, table_number: 87, session_id: adminPaySess, amount: adminPayTotal, method: 'dinheiro', created_at: new Date().toISOString(), created_by: admUid }))
  {
    const adminPayRow = (await A.from('payments').select('shift_id').eq('id', adminPay).maybeSingle()).data as { shift_id?: unknown } | null
    results.push({ name: 'Pagamento do admin fica sem turno associado', pass: !!adminPayRow && adminPayRow.shift_id === null, detail: adminPayRow ? `shift_id=${String(adminPayRow.shift_id)}` : 'não encontrado' })
  }
  await okVoidPayment('Admin anula pagamento sem reabrir mesa', A, A, {
    paymentId: adminPay,
    reason: 'Correção sem reabertura',
    action: 'void_only',
  }, { reopened: false })

  const rodizioVoidOpenedAt = new Date().toISOString()
  const rodizioVoidSess = 'audit-sess-rod-void-' + rid().slice(6); createdSessionIds.push(rodizioVoidSess)
  await E.from('sessions').insert({
    id: rodizioVoidSess,
    table_number: 89,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    open: true,
    opened_at: rodizioVoidOpenedAt,
    mode: 'rodizio',
    entry_price: 22,
    headcount: 2,
  })
  await E.from('orders').insert(orderRow({
    id: rid(),
    source: 'empregado',
    session_id: rodizioVoidSess,
    table_number: 89,
    mode: 'rodizio',
    entry_price: 22,
    headcount: 2,
    items: [
      { menuItemId: auditRodizioItemId, menuItemName: 'forjado incluído', quantity: 2, price: 999, vatRate: 99 },
      { menuItemId: auditMenuItemId, menuItemName: 'forjado extra', quantity: 1, price: 999, vatRate: 99 },
    ],
  }))
  await deliverSessionOrders(A, rodizioVoidSess)
  const rodizioVoidOrders = (await E.from('orders').select('status, created_at, discount_type, discount_value, items').eq('session_id', rodizioVoidSess)).data ?? []
  const rodizioVoidTotal = expectedPaymentTotal(
    { mode: 'rodizio', entryPrice: 22, headcount: 2, openedAt: rodizioVoidOpenedAt },
    (rodizioVoidOrders as Array<Record<string, unknown>>).map((o) => ({
      status: o.status as string,
      createdAt: o.created_at as string,
      discountType: o.discount_type as string | null,
      discountValue: o.discount_value as number | null,
      items: o.items as Array<{ price?: unknown; quantity?: unknown }>,
    })),
  )
  const rodizioVoidPay = uid(); createdPaymentIds.push(rodizioVoidPay)
  await okWrite('Pagamento rodízio grava snapshot para reabertura futura', E.from('payments').insert({
    id: rodizioVoidPay,
    table_number: 89,
    session_id: rodizioVoidSess,
    amount: rodizioVoidTotal,
    method: 'dinheiro',
    shift_id: empShift,
    created_at: new Date().toISOString(),
    created_by: empUid,
  }))
  await closeSessionFixture(E, rodizioVoidSess)
  await okWrite('Admin muda settings para normal depois do fecho rodízio', A.from('settings').upsert({
    id: 'restaurant',
    mode: 'normal',
    entry_price: 0,
    default_vat_rate: 13,
  }, { onConflict: 'id' }))
  await okVoidPayment('Anulação reabre rodízio pelo snapshot, não pelas settings atuais', A, A, {
    paymentId: rodizioVoidPay,
    reason: 'Reabrir snapshot rodízio histórico',
    action: 'reopen_session',
  }, { reopened: true })
  await okReadNonEmpty('Sessão rodízio reaberta mantém entrada/headcount históricos', A.from('sessions').select('*').eq('id', rodizioVoidSess).eq('open', true).eq('mode', 'rodizio').eq('entry_price', 22).eq('headcount', 2))
  await closeSessionFixture(E, rodizioVoidSess)

  // ── Sessão expirada: consumo novo (orders/service_calls) é bloqueado, mas
  //    fechar a conta (payments) tem de funcionar SEMPRE ──
  // A TTL (expires_at) é segurança do QR contra consumo novo, não barreira ao
  // fecho. Os triggers de orders/service_calls rejeitam sessões expiradas; o de
  // payments NÃO (uma sessão temporária pode expirar com a conta por pagar).

  // (a) Sessão JÁ expirada (expires_at no passado). O sessions_validate_insert
  //     permite criar com open=true + expires_at passado, por isso conseguimos
  //     o fixture sem esperar. Mesa 81, dedicada.
  const expiredSessId = 'audit-sess-expired-' + rid().slice(6); createdSessionIds.push(expiredSessId)
  await E.from('sessions').insert({
    id: expiredSessId,
    table_number: 81,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() - 60_000).toISOString(), // 1 min no passado
    open: true,
    opened_at: new Date().toISOString(),
  })
  await deny('Order em sessão expirada é negado', E.from('orders').insert(orderRow({
    id: rid(),
    source: 'empregado',
    session_id: expiredSessId,
    table_number: 81,
  })))
  await deny('Chamada em sessão expirada é negada', E.from('service_calls').insert({
    id: (() => { const cid = rid(); createdCallIds.push(cid); return cid })(),
    type: 'bill',
    table_number: 81,
    session_id: expiredSessId,
    created_at: new Date().toISOString(),
  }))
  await okWrite('Chamada do tipo waiter em sessão expirada é permitida', E.from('service_calls').insert({
    id: (() => { const cid = rid(); createdCallIds.push(cid); return cid })(),
    type: 'waiter',
    table_number: 81,
    session_id: expiredSessId,
    created_at: new Date().toISOString(),
  }))

  // (b) Pagamento numa sessão que expira com a conta aberta DEVE PASSAR.
  //     Como não dá para inserir orders depois de expirar, usamos uma TTL curta:
  //     criamos a sessão, metemos 1 order JÁ (ainda não expirou), esperamos a
  //     expiração e só então pagamos — provando que o check de expiry foi removido
  //     apenas no trigger de payments. Mesa 82, dedicada.
  const shortTtlOpenedAt = new Date().toISOString()
  const shortTtlSessId = 'audit-sess-shortttl-' + rid().slice(6); createdSessionIds.push(shortTtlSessId)
  await E.from('sessions').insert({
    id: shortTtlSessId,
    table_number: 82,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 2000).toISOString(), // expira daqui a 2s
    open: true,
    opened_at: shortTtlOpenedAt,
  })
  // Order válido enquanto a sessão ainda não expirou.
  await E.from('orders').insert(orderRow({ id: rid(), source: 'empregado', session_id: shortTtlSessId, table_number: 82 }))
  await deliverSessionOrders(A, shortTtlSessId)
  // Esperar a sessão expirar (2.5s > os 2s da TTL). Há já um setTimeout no script,
  // por isso este sleep adicional é aceitável para provar o cenário real.
  await new Promise((resolve) => setTimeout(resolve, 2500))
  // A sessão está agora expirada (open=true, expires_at no passado). Order/chamada
  // novos já não passariam aqui, mas o pagamento tem de fechar a conta na mesma.
  await deny('Order numa sessão já expirada (TTL curta) é negado', E.from('orders').insert(orderRow({ id: rid(), source: 'empregado', session_id: shortTtlSessId, table_number: 82 })))
  const shortTtlOrders = (await E.from('orders').select('status, created_at, discount_type, discount_value, items').eq('session_id', shortTtlSessId)).data ?? []
  const shortTtlTotal = expectedPaymentTotal(
    { mode: 'normal', openedAt: shortTtlOpenedAt },
    (shortTtlOrders as Array<Record<string, unknown>>).map((o) => ({
      status: o.status as string,
      createdAt: o.created_at as string,
      discountType: o.discount_type as string | null,
      discountValue: o.discount_value as number | null,
      items: o.items as Array<{ price?: unknown; quantity?: unknown }>,
    })),
  )
  const expiredPay = uid(); createdPaymentIds.push(expiredPay)
  await okWrite('Pagamento numa sessão expirada (aberta) é permitido', E.from('payments').insert({
    id: expiredPay,
    table_number: 82,
    session_id: shortTtlSessId,
    amount: shortTtlTotal,
    method: 'dinheiro',
    shift_id: empShift,
    created_at: new Date().toISOString(),
    created_by: empUid,
  }))

  // Ponto: com os pagamentos do empregado/admin todos gravados, cada um pica
  // a própria saída. Um turno fechado é imutável (não reabre).
  await okWrite('Empregado pica a própria saída', E.from('shifts').update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: empUid }).eq('id', empShift).select(), true)
  await deny('Turno fechado não reabre', E.from('shifts').update({ status: 'open' }).eq('id', empShift).select())
  await okWrite('Admin pica a própria saída', A.from('shifts').update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: admUid }).eq('id', admShift).select(), true)

  // Repicar a entrada: o resto da auditoria continua a operar como empregado
  // (D1 exige turno aberto para sessões/pedidos/chamadas).
  const empShift2 = uid(); createdShiftIds.push(empShift2)
  await mustWrite('repicar entrada do empregado', E.from('shifts').insert({ id: empShift2, opened_at: new Date().toISOString(), opened_by: empUid, status: 'open' }))

  // ── D6: fechar mesa com pedidos por entregar é negado ──
  // A cozinha não pode ficar a preparar comida de uma conta já fechada; o
  // fecho só passa com os pedidos entregues ou cancelados (igual ao cobrar).
  const d6Sess = 'audit-sess-d6-' + rid().slice(6); createdSessionIds.push(d6Sess)
  await mustWrite('fixture sessão D6', E.from('sessions').insert({
    id: d6Sess,
    table_number: 17,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    open: true,
    opened_at: new Date().toISOString(),
  }))
  await mustWrite('fixture pedido pendente D6', E.from('orders').insert(orderRow({ id: rid(), source: 'empregado', session_id: d6Sess, table_number: 17 })))
  await deny('Fechar mesa com pedido por entregar é negado', E.from('sessions').update({ open: false, access_code_hash: null, opened_at: null }).eq('id', d6Sess).select())
  await deny('Nem o admin fecha mesa com pedidos por entregar', A.from('sessions').update({ open: false, access_code_hash: null, opened_at: null }).eq('id', d6Sess).select())
  await deliverSessionOrders(A, d6Sess)
  await okWrite('Mesa fecha depois de entregar/cancelar os pedidos', E.from('sessions').update({ open: false, access_code_hash: null, opened_at: null }).eq('id', d6Sess).select(), true)

  // (c) Índice único sessions_one_open_per_table_idx: só 1 sessão aberta por mesa.
  //     A 2ª sessão open=true na mesma mesa (83) tem de falhar (unique violation).
  const dupOpenSess1 = 'audit-sess-dup1-' + rid().slice(6); createdSessionIds.push(dupOpenSess1)
  await okWrite('1ª sessão aberta na mesa dedicada (83)', E.from('sessions').insert({
    id: dupOpenSess1,
    table_number: 83,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    open: true,
    opened_at: new Date().toISOString(),
  }))
  const dupOpenSess2 = 'audit-sess-dup2-' + rid().slice(6); createdSessionIds.push(dupOpenSess2)
  await deny('2ª sessão aberta na mesma mesa é negada', E.from('sessions').insert({
    id: dupOpenSess2,
    table_number: 83,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    open: true,
    opened_at: new Date().toISOString(),
  }))

  // (d) get_customer_open_session vazio: o cliente fixo numa mesa SEM sessão
  //     aberta não recebe linhas. Movemos o cliente para uma mesa dedicada (84)
  //     que não tem sessão e confirmamos 0 linhas; depois repomos a mesa 5.
  await A.from('profiles').update({ table_number: 84 }).eq('id', cliUid)
  await denyReadEmpty('get_customer_open_session vazio quando a mesa não tem sessão aberta', C.rpc('get_customer_open_session'))
  await A.from('profiles').update({ table_number: 5 }).eq('id', cliUid)

  // ── Gerente (admin menos contas privilegiadas e purga física) ──
  const gerCat = uid(); createdCatIds.push(gerCat)
  await okWrite('Gerente cria categoria', G.from('categories').insert({ id: gerCat, name: 'Audit Ger Cat' }))
  const gerItem = uid(); createdItemIds.push(gerItem)
  await okWrite('Gerente cria menu item', G.from('menu_items').insert({ id: gerItem, name: 'Audit Ger Item', description: '', price: 3, category_id: gerCat, available: true, discount: null }))
  await deny('Gerente NÃO escreve settings', G.from('settings').upsert({ id: 'audit-settings', mode: 'normal', entry_price: 0 }, { onConflict: 'id' }))
  // Ponto do gerente: pica a entrada (o turno serve também para o pagamento
  // dele mais abaixo). A antiga guarda "não fechar com mesas abertas" saiu com
  // o relógio de ponto — picar a saída não depende do estado das mesas.
  const gerShift = uid(); createdShiftIds.push(gerShift)
  await okWrite('Gerente pica entrada (abre o seu turno)', G.from('shifts').insert({ id: gerShift, opened_at: new Date().toISOString(), opened_by: gerUid, status: 'open' }))
  const gerOrder = rid()
  await E.from('orders').insert(orderRow({ id: gerOrder, source: 'empregado' }))
  await okWrite('Gerente avança pending→preparing', G.from('orders').update({ status: 'preparing' }).eq('id', gerOrder).select(), true)
  await okWrite('Gerente cancela com motivo', G.from('orders').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: gerUid, cancel_reason: 'Auditoria gerente' }).eq('id', gerOrder).select(), true)
  const gerDel = rid()
  await E.from('orders').insert(orderRow({ id: gerDel, source: 'empregado' }))
  await deny('Gerente NÃO apaga pedido fisicamente', G.from('orders').delete().eq('id', gerDel).select())
  const gerPaySessOpenedAt = new Date().toISOString()
  const gerPaySess = 'audit-sess-ger-pay-' + rid().slice(6); createdSessionIds.push(gerPaySess)
  await G.from('sessions').insert({
    id: gerPaySess,
    table_number: 4,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    open: true,
    opened_at: gerPaySessOpenedAt,
  })
  // Pedido real na mesa 4 para o pagamento do gerente ter um total > 0 a bater.
  await E.from('orders').insert(orderRow({ id: rid(), source: 'empregado', session_id: gerPaySess, table_number: 4 }))
  await deliverSessionOrders(A, gerPaySess)
  const gerPayOrders = (await E.from('orders').select('status, created_at, discount_type, discount_value, items').eq('session_id', gerPaySess)).data ?? []
  const gerPayTotal = expectedPaymentTotal(
    { mode: 'normal', openedAt: gerPaySessOpenedAt },
    (gerPayOrders as Array<Record<string, unknown>>).map((o) => ({
      status: o.status as string,
      createdAt: o.created_at as string,
      discountType: o.discount_type as string | null,
      discountValue: o.discount_value as number | null,
      items: o.items as Array<{ price?: unknown; quantity?: unknown }>,
    })),
  )
  const gerPay = uid(); createdPaymentIds.push(gerPay)
  await okWrite('Gerente cria pagamento', G.from('payments').insert({ id: gerPay, table_number: 4, session_id: gerPaySess, amount: gerPayTotal, method: 'dinheiro', shift_id: gerShift, created_at: new Date().toISOString(), created_by: gerUid }))
  await closeSessionFixture(G, gerPaySess)
  await okVoidPayment('Gerente anula pagamento e prepara refecho', G, A, {
    paymentId: gerPay,
    reason: 'Refazer registo de fecho',
    action: 'reopen_and_close',
  }, { reopened: true })
  await okReadNonEmpty('Anulação para refazer deixa mesa reaberta', A.from('sessions').select('*').eq('id', gerPaySess).eq('open', true).eq('opened_at', gerPaySessOpenedAt))
  await deny('Gerente NÃO apaga pagamento', G.from('payments').delete().eq('id', gerPay).select())
  await closeSessionFixture(G, gerPaySess)
  await okWrite('Gerente pica a própria saída', G.from('shifts').update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: gerUid }).eq('id', gerShift).select(), true)
  // Profiles: o gerente gere staff (usamos o cozinha como alvo gerível), mas
  // nunca toca em contas admin/gerente nem escala privilégios.
  await okReadAny('Gerente lê profiles', G.from('profiles').select('*'))
  await okWrite('Gerente edita profile staff (cozinha)', G.from('profiles').update({ username: 'cozinha' }).eq('id', cozUid).select(), true)
  await deny('Gerente NÃO promove staff a admin', G.from('profiles').update({ role: 'admin' }).eq('id', cozUid).select())
  await deny('Gerente NÃO promove staff a gerente', G.from('profiles').update({ role: 'gerente' }).eq('id', cozUid).select())
  await deny('Gerente NÃO edita profile do admin', G.from('profiles').update({ username: 'hack' }).eq('id', admUid).select())
  await deny('Gerente NÃO desativa o admin', G.from('profiles').update({ active: false }).eq('id', admUid).select())

  // ── Storage: imagens do menu (upload só admin/gerente) ──
  const pngBlob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' })
  const adminImgPath = `audit-admin-${rid()}.png`
  const gerenteImgPath = `audit-gerente-${rid()}.png`
  uploadedImagePaths.push(adminImgPath, gerenteImgPath)
  await okWrite('Admin faz upload de imagem do menu', A.storage.from('menu-images').upload(adminImgPath, pngBlob, { contentType: 'image/png' }))
  await okWrite('Gerente faz upload de imagem do menu', G.storage.from('menu-images').upload(gerenteImgPath, pngBlob, { contentType: 'image/png' }))
  await deny('Empregado NÃO faz upload de imagem do menu', E.storage.from('menu-images').upload(`audit-${rid()}.png`, pngBlob, { contentType: 'image/png' }))
  await deny('Cozinha NÃO faz upload de imagem do menu', K.storage.from('menu-images').upload(`audit-${rid()}.png`, pngBlob, { contentType: 'image/png' }))
  await deny('Cliente NÃO faz upload de imagem do menu', C.storage.from('menu-images').upload(`audit-${rid()}.png`, pngBlob, { contentType: 'image/png' }))
  if (anonOk) await deny('Anónimo NÃO faz upload de imagem do menu', AN.storage.from('menu-images').upload(`audit-${rid()}.png`, pngBlob, { contentType: 'image/png' }))
  await deny('Cozinha NÃO apaga imagem do menu', K.storage.from('menu-images').remove([adminImgPath]))
  await okWrite('Gerente apaga imagem do menu', G.storage.from('menu-images').remove([gerenteImgPath]))

  // ── Canal OTA: app_release + bucket app-bundles (escrita só admin) ──
  // É a única superfície que reescreve o código de TODOS os POS. Sem estes
  // testes, uma regressão que abrisse a escrita a não-admin passaria o gate verde.
  const prevRelease = (await A.from('app_release').select('*').eq('id', 'current').maybeSingle()).data
  await okReadAny('Público lê app_release', P.from('app_release').select('*'))
  await deny('Empregado NÃO escreve app_release', E.from('app_release').upsert({ id: 'current', version: 'audit-emp', object_path: 'audit/x.zip' }, { onConflict: 'id' }))
  await deny('Cozinha NÃO escreve app_release', K.from('app_release').upsert({ id: 'current', version: 'audit-coz', object_path: 'audit/x.zip' }, { onConflict: 'id' }))
  await deny('Cliente NÃO escreve app_release', C.from('app_release').upsert({ id: 'current', version: 'audit-cli', object_path: 'audit/x.zip' }, { onConflict: 'id' }))
  if (anonOk) await deny('Anónimo NÃO escreve app_release', AN.from('app_release').upsert({ id: 'current', version: 'audit-anon', object_path: 'audit/x.zip' }, { onConflict: 'id' }))
  await deny('Gerente NÃO escreve app_release', G.from('app_release').upsert({ id: 'current', version: 'audit-ger', object_path: 'audit/x.zip' }, { onConflict: 'id' }))
  await okWrite('Admin escreve app_release', A.from('app_release').upsert({ id: 'current', version: 'audit-1.0.0', object_path: 'audit/bundle.zip', checksum: 'deadbeef' }, { onConflict: 'id' }))
  await okWrite('Admin atualiza app_release', A.from('app_release').update({ version: 'audit-1.0.1' }).eq('id', 'current').select(), true)
  // Repor o estado anterior do app_release (pode ter sido publicado em dev).
  if (prevRelease) await A.from('app_release').upsert(prevRelease as Record<string, unknown>, { onConflict: 'id' })
  else await A.from('app_release').delete().eq('id', 'current')

  // Bucket app-bundles: leitura pública (usada em runtime via getPublicUrl),
  // upload/delete só admin (o gerente, que pode mexer no menu-images, NÃO pode aqui).
  const bundleBlob = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], { type: 'application/zip' })
  const adminBundlePath = `audit-bundle-${rid()}.zip`
  await okWrite('Admin faz upload de bundle OTA', A.storage.from('app-bundles').upload(adminBundlePath, bundleBlob, { contentType: 'application/zip' }))
  await deny('Empregado NÃO faz upload de bundle OTA', E.storage.from('app-bundles').upload(`audit-${rid()}.zip`, bundleBlob, { contentType: 'application/zip' }))
  await deny('Cozinha NÃO faz upload de bundle OTA', K.storage.from('app-bundles').upload(`audit-${rid()}.zip`, bundleBlob, { contentType: 'application/zip' }))
  await deny('Cliente NÃO faz upload de bundle OTA', C.storage.from('app-bundles').upload(`audit-${rid()}.zip`, bundleBlob, { contentType: 'application/zip' }))
  if (anonOk) await deny('Anónimo NÃO faz upload de bundle OTA', AN.storage.from('app-bundles').upload(`audit-${rid()}.zip`, bundleBlob, { contentType: 'application/zip' }))
  await deny('Gerente NÃO faz upload de bundle OTA', G.storage.from('app-bundles').upload(`audit-${rid()}.zip`, bundleBlob, { contentType: 'application/zip' }))
  await deny('Cozinha NÃO apaga bundle OTA', K.storage.from('app-bundles').remove([adminBundlePath]))
  await okWrite('Admin apaga bundle OTA', A.storage.from('app-bundles').remove([adminBundlePath]))

  // ── Autoclose de sessões expiradas com guarda de conta (auditoria 2026-06-26) ──
  // Mesa 92: expirada SEM consumo + chamada aberta → nova sessão fecha a antiga.
  const autocloseOld = 'audit-sess-autoclose-' + rid().slice(6); createdSessionIds.push(autocloseOld)
  await E.from('sessions').insert({
    id: autocloseOld,
    table_number: 92,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() - 60_000).toISOString(),
    open: true,
    opened_at: new Date().toISOString(),
  })
  const autocloseCall = rid(); createdCallIds.push(autocloseCall)
  await okWrite('Chamada aberta na sessão expirada (mesa 92)', E.from('service_calls').insert({
    id: autocloseCall,
    type: 'waiter',
    table_number: 92,
    session_id: autocloseOld,
    created_at: new Date().toISOString(),
  }))
  const autocloseNew = 'audit-sess-autoclose-new-' + rid().slice(6); createdSessionIds.push(autocloseNew)
  await okWrite('Nova sessão na mesa 92 fecha a expirada sem consumo', E.from('sessions').insert({
    id: autocloseNew,
    table_number: 92,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    open: true,
    opened_at: new Date().toISOString(),
  }))
  {
    const oldRow = (await A.from('sessions').select('open').eq('id', autocloseOld).maybeSingle()).data as { open?: boolean } | null
    results.push({ name: 'Autoclose fechou a sessão expirada sem consumo (mesa 92)', pass: !!oldRow && oldRow.open === false, detail: oldRow ? `open=${oldRow.open}` : 'não encontrada' })
    const callRow = (await A.from('service_calls').select('status').eq('id', autocloseCall).maybeSingle()).data as { status?: string } | null
    results.push({ name: 'Autoclose resolveu a chamada da sessão expirada (mesa 92)', pass: !!callRow && callRow.status === 'resolved', detail: callRow ? `status=${callRow.status}` : 'não encontrada' })
  }

  // Mesa 93: rodízio expirado com entrada por cobrar → NÃO autoclose (fecho manual).
  // Um teste anterior pôs as settings em 'normal'; voltamos a rodízio só para criar
  // esta sessão de rodízio e repomos a seguir.
  await A.from('settings').upsert({ id: 'restaurant', mode: 'rodizio', entry_price: 22, default_vat_rate: 13 }, { onConflict: 'id' })
  const autocloseRod = 'audit-sess-autoclose-rod-' + rid().slice(6); createdSessionIds.push(autocloseRod)
  await E.from('sessions').insert({
    id: autocloseRod,
    table_number: 93,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() - 60_000).toISOString(),
    open: true,
    opened_at: new Date().toISOString(),
    mode: 'rodizio',
    entry_price: 22,
    headcount: 2,
  })
  const autocloseRodBlocked = 'audit-sess-autoclose-rod2-' + rid().slice(6); createdSessionIds.push(autocloseRodBlocked)
  await deny('Nova sessão bloqueada se a conta de rodízio expirada não foi cobrada (mesa 93)', E.from('sessions').insert({
    id: autocloseRodBlocked,
    table_number: 93,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    open: true,
    opened_at: new Date().toISOString(),
  }))
  {
    const rodRow = (await A.from('sessions').select('open').eq('id', autocloseRod).maybeSingle()).data as { open?: boolean } | null
    results.push({ name: 'Sessão de rodízio expirada por cobrar permanece aberta (mesa 93)', pass: !!rodRow && rodRow.open === true, detail: rodRow ? `open=${rodRow.open}` : 'não encontrada' })
  }
  // Repor as settings em 'normal' como estavam antes deste teste.
  await A.from('settings').upsert({ id: 'restaurant', mode: 'normal', entry_price: 0, default_vat_rate: 13 }, { onConflict: 'id' })

  // ── Rate-limit nos writes QR (finding #8) ──
  // Numa sessão dedicada, o anónimo enche a janela e o write seguinte é bloqueado.
  // Os limites espelham os da migração 20260620120200_rate_limit.sql.
  if (anonOk) {
    const ORDERS_RL = 10
    const CALLS_RL = 5
    const rlSess = 'audit-sess-rl-' + rid().slice(6); createdSessionIds.push(rlSess)
    await E.from('sessions').insert({
      id: rlSess,
      table_number: 91,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      open: true,
      opened_at: new Date().toISOString(),
    })
    await AN.rpc('claim_session_with_code', { p_session_id: rlSess, p_code_hash: 'rl-code' })

    let ordersBurstOk = true
    for (let i = 0; i < ORDERS_RL; i++) {
      const r = await settle(AN.from('orders').insert(orderRow({ session_id: rlSess, table_number: 91 })))
      if (r.error) ordersBurstOk = false
    }
    results.push({
      name: `Rate-limit deixa passar ${ORDERS_RL} pedidos QR na janela`,
      pass: ordersBurstOk,
      detail: ordersBurstOk ? 'permitido (esperado)' : 'um pedido dentro do limite falhou',
    })
    await deny('Rate-limit bloqueia o pedido QR acima do limite', AN.from('orders').insert(orderRow({ session_id: rlSess, table_number: 91 })))

    let callsBurstOk = true
    for (let i = 0; i < CALLS_RL; i++) {
      const cid = rid(); createdCallIds.push(cid)
      const r = await settle(AN.from('service_calls').insert({ id: cid, type: 'waiter', table_number: 91, session_id: rlSess, created_at: new Date().toISOString() }))
      if (r.error) callsBurstOk = false
      else {
        const resolved = await settle(E.from('service_calls').update({ status: 'resolved' }).eq('id', cid).select())
        if (resolved.error || rows(resolved.data) === 0) callsBurstOk = false
      }
    }
    results.push({
      name: `Rate-limit deixa passar ${CALLS_RL} chamadas QR na janela`,
      pass: callsBurstOk,
      detail: callsBurstOk ? 'permitido (esperado)' : 'uma chamada dentro do limite falhou',
    })
    await deny('Rate-limit bloqueia a chamada QR acima do limite', AN.from('service_calls').insert({ id: rid(), type: 'waiter', table_number: 91, session_id: rlSess, created_at: new Date().toISOString() }))
  }

  // ── D2: mudar as settings a meio do serviço NÃO afeta contas abertas ──
  // A sessão guarda o snapshot de modo/entrada ao abrir; pedidos e pagamento
  // validam contra a SESSÃO, não contra as settings do momento. Mesa 88 (livre).
  await A.from('settings').upsert({ id: 'restaurant', mode: 'rodizio', entry_price: 22, default_vat_rate: 13 }, { onConflict: 'id' })
  const d2OpenedAt = new Date().toISOString()
  const d2Sess = 'audit-sess-d2-' + rid().slice(6); createdSessionIds.push(d2Sess)
  await mustWrite('fixture sessão rodízio D2', E.from('sessions').insert({
    id: d2Sess,
    table_number: 88,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    open: true,
    opened_at: d2OpenedAt,
    mode: 'rodizio',
    entry_price: 22,
    headcount: 2,
  }))
  await okWrite('Admin muda a entrada nas settings com conta rodízio aberta', A.from('settings').upsert({ id: 'restaurant', mode: 'rodizio', entry_price: 30, default_vat_rate: 13 }, { onConflict: 'id' }))
  await okReadNonEmpty('Conta aberta mantém o snapshot antigo da entrada (22)', A.from('sessions').select('*').eq('id', d2Sess).eq('entry_price', 22))
  await okWrite('Pedido na conta antiga carrega a entrada do snapshot (22)', E.from('orders').insert(orderRow({
    source: 'empregado', session_id: d2Sess, table_number: 88,
    mode: 'rodizio', entry_price: 22, headcount: 2, items: [rodizioIncludedItem],
  })))
  await deny('Pedido com a entrada NOVA das settings é negado na conta antiga', E.from('orders').insert(orderRow({
    source: 'empregado', session_id: d2Sess, table_number: 88,
    mode: 'rodizio', entry_price: 30, headcount: 2, items: [rodizioIncludedItem],
  })))
  // Editar o nº de pessoas de uma conta antiga tem de continuar a funcionar
  // mesmo com a entrada das settings já diferente — a conta vive do snapshot.
  await okWrite('Headcount edita-se na conta antiga apesar das settings novas', E.rpc('set_session_headcount', { p_session_id: d2Sess, p_headcount: 3 }))
  await deliverSessionOrders(A, d2Sess)
  const d2Orders = (await E.from('orders').select('status, created_at, discount_type, discount_value, items').eq('session_id', d2Sess)).data ?? []
  const d2Total = expectedPaymentTotal(
    { mode: 'rodizio', entryPrice: 22, headcount: 3, openedAt: d2OpenedAt },
    (d2Orders as Array<Record<string, unknown>>).map((o) => ({
      status: o.status as string,
      createdAt: o.created_at as string,
      discountType: o.discount_type as string | null,
      discountValue: o.discount_value as number | null,
      items: o.items as Array<{ price?: unknown; quantity?: unknown }>,
    })),
  )
  const d2Pay = uid(); createdPaymentIds.push(d2Pay)
  await okWrite('Pagamento recalcula com o snapshot da sessão, não com as settings', E.from('payments').insert({
    id: d2Pay, table_number: 88, session_id: d2Sess, amount: d2Total, method: 'dinheiro',
    shift_id: empShift2, created_at: new Date().toISOString(), created_by: empUid,
  }))
  await closeSessionFixture(E, d2Sess)
  await A.from('settings').upsert({ id: 'restaurant', mode: 'normal', entry_price: 0, default_vat_rate: 13 }, { onConflict: 'id' })

  // ── D7: auto-fecho de turnos esquecidos ──
  // Limite em frações de hora para testar em segundos: 0.0006h = 2.16s. O
  // empShift2 (aberto há minutos) fica logo "esquecido". Este bloco fecha os
  // turnos todos — tem de ser o último antes do cleanup.
  await deny('Settings com max_shift_hours acima de 24 são negadas', A.from('settings').upsert({ id: 'restaurant', mode: 'normal', entry_price: 0, default_vat_rate: 13, max_shift_hours: 25 }, { onConflict: 'id' }))
  await okWrite('Admin define as horas máximas de turno', A.from('settings').upsert({ id: 'restaurant', mode: 'normal', entry_price: 0, default_vat_rate: 13, max_shift_hours: 0.0006 }, { onConflict: 'id' }))
  const kShift3 = uid(); createdShiftIds.push(kShift3)
  await okWrite('Picar entrada não aceita auto_closed forjado', K.from('shifts').insert({ id: kShift3, opened_at: new Date().toISOString(), opened_by: cozUid, status: 'open', auto_closed: true }))
  {
    const forged = (await A.from('shifts').select('auto_closed').eq('id', kShift3).maybeSingle()).data as { auto_closed?: boolean } | null
    results.push({ name: 'Marca de auto-fecho forjada é limpa pela BD', pass: !!forged && forged.auto_closed === false, detail: forged ? `auto_closed=${forged.auto_closed}` : 'não encontrado' })
  }
  // Esperar o turno da cozinha passar o limite de 2.16s (o do empregado já passou).
  await new Promise((resolve) => setTimeout(resolve, 2500))
  {
    const { data, error } = await settle(E.rpc('close_stale_shifts'))
    const count = typeof data === 'number' ? data : Number(data)
    results.push({
      name: 'close_stale_shifts fecha os turnos esquecidos',
      pass: !error && count >= 2,
      detail: error ? msg(error) : `fechou ${count} turno(s)`,
    })
    const stale = (await A.from('shifts').select('status, auto_closed, opened_at, opened_by, closed_at, closed_by').eq('id', empShift2).maybeSingle()).data as
      { status?: string; auto_closed?: boolean; opened_at?: string; opened_by?: string; closed_at?: string; closed_by?: string } | null
    const expectedClosedMs = stale?.opened_at ? Date.parse(stale.opened_at) + 0.0006 * 3600 * 1000 : NaN
    const closedMs = stale?.closed_at ? Date.parse(stale.closed_at) : NaN
    const pass =
      !!stale
      && stale.status === 'closed'
      && stale.auto_closed === true
      && stale.closed_by === stale.opened_by
      // Hora determinística: saída = entrada + limite (tolerância de 5ms do
      // arredondamento a milissegundos do to_char).
      && Math.abs(closedMs - expectedClosedMs) <= 5
    results.push({
      name: 'Turno esquecido fecha com hora determinística (entrada + limite)',
      pass,
      detail: pass ? `closed_at = opened_at + 2.16s` : `inesperado: ${JSON.stringify(stale)}`,
    })
  }
  await deny('Turno auto-fechado é imutável', E.from('shifts').update({ closed_at: new Date().toISOString(), closed_by: empUid }).eq('id', empShift2).select())
  // Fecho manual normal não ganha a marca de auto-fecho.
  const empShift3 = uid(); createdShiftIds.push(empShift3)
  await mustWrite('repicar entrada (fecho manual D7)', E.from('shifts').insert({ id: empShift3, opened_at: new Date().toISOString(), opened_by: empUid, status: 'open' }))
  await okWrite('Empregado pica a saída normalmente', E.from('shifts').update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: empUid }).eq('id', empShift3).select(), true)
  {
    const manual = (await A.from('shifts').select('auto_closed').eq('id', empShift3).maybeSingle()).data as { auto_closed?: boolean } | null
    results.push({ name: 'Fecho manual não ganha a marca de auto-fecho', pass: !!manual && manual.auto_closed === false, detail: manual ? `auto_closed=${manual.auto_closed}` : 'não encontrado' })
  }
  // Desligar o auto-fecho de novo (o restore final das settings repõe o resto).
  await A.from('settings').upsert({ id: 'restaurant', mode: 'normal', entry_price: 0, default_vat_rate: 13, max_shift_hours: null }, { onConflict: 'id' })

  // ── Primeira instalação: bootstrap do 1.º admin ──
  // NOTA: aqui a BD já tem admin (o seed correu), por isso só testamos o lado
  // NEGADO — que depois de existir admin ninguém re-bootstrapa (nem o próprio
  // admin, nem staff, nem anónimo). O caso PERMITIDO (BD sem admin nenhum) não
  // cabe neste harness (que pressupõe seed) — cobre-se por teste manual E2E
  // documentado no plano (BD vazia → ecrã de setup → criar admin).
  const setupBool = (await A.rpc('system_needs_setup')).data
  results.push({ name: 'system_needs_setup devolve false quando já há admin', pass: setupBool === false, detail: `devolveu ${JSON.stringify(setupBool)}` })
  await denyClaim('Admin NÃO re-bootstrapa (já existe admin)', A.rpc('bootstrap_first_admin', { p_username: 'intruso' }))
  await denyClaim('Gerente NÃO ganha admin via bootstrap', G.rpc('bootstrap_first_admin', { p_username: 'intruso' }))
  await denyClaim('Empregado NÃO ganha admin via bootstrap', E.rpc('bootstrap_first_admin', { p_username: 'intruso' }))
  await denyClaim('Cliente NÃO ganha admin via bootstrap', C.rpc('bootstrap_first_admin', { p_username: 'intruso' }))
  await denyClaim('Cozinha NÃO ganha admin via bootstrap', K.rpc('bootstrap_first_admin', { p_username: 'intruso' }))
  // Anónimo (sem sessão): a função é auto-guardada (auth.uid() null → recusa),
  // por isso mesmo com o EXECUTE default a public não consegue criar nada.
  await denyClaim('Anónimo NÃO cria admin via bootstrap', AN.rpc('bootstrap_first_admin', { p_username: 'intruso' }))

  // ── Admin muda password de terceiros (admin_set_user_password) ──
  // O positivo repõe a MESMA password do seed (PW) — exercita o caminho de
  // sucesso sem alterar o valor, por isso os logins seguintes continuam a valer.
  await okWrite('Admin muda password de um utilizador gerível', A.rpc('admin_set_user_password', { p_user_id: cozUid, p_password: PW }))
  await deny('Empregado NÃO muda password de terceiros', E.rpc('admin_set_user_password', { p_user_id: cozUid, p_password: 'passwordlonga12' }))
  await deny('Gerente NÃO muda password de terceiros', G.rpc('admin_set_user_password', { p_user_id: cozUid, p_password: 'passwordlonga12' }))
  await deny('Admin NÃO muda password de outro admin', A.rpc('admin_set_user_password', { p_user_id: admUid, p_password: 'passwordlonga12' }))
  await deny('Password curta é negada', A.rpc('admin_set_user_password', { p_user_id: cozUid, p_password: 'curta' }))

  // ── Cleanup (como admin) ──
  let cleaned = 0
  async function del(table: string, ids: string[]) {
    for (const id of ids) {
      const { error } = await settle(A.from(table).delete().eq('id', id))
      if (!error) cleaned++
    }
  }
  await del('orders', createdOrderIds)
  await del('sessions', createdSessionIds)
  await del('menu_items', createdItemIds)
  await del('categories', createdCatIds)
  await del('service_calls', createdCallIds)
  await del('payments', createdPaymentIds)
  await del('shifts', createdShiftIds)
  if (uploadedImagePaths.length) await settle(A.storage.from('menu-images').remove(uploadedImagePaths))
  await A.from('settings').delete().eq('id', 'audit-settings')
  // Repor settings/restaurant e o estado das contas tocadas.
  if (prevSettings) await A.from('settings').upsert(prevSettings, { onConflict: 'id' })
  else await A.from('settings').delete().eq('id', 'restaurant')
  await A.from('profiles').update({ table_number: 1 }).eq('id', cliUid)
  await A.from('profiles').update({ role: 'empregado', username: 'empregado' }).eq('id', empUid)
  await A.from('profiles').update({ role: 'cozinha', username: 'cozinha' }).eq('id', cozUid)

  // ── Report ──
  const pass = results.filter((r) => r.pass).length
  const fail = results.length - pass
  console.log('\n══════════ TESTES ÀS POLÍTICAS RLS (SUPABASE) ══════════')
  for (const r of results) console.log(`${r.pass ? '✓' : '✗ FALHA'}  ${r.name}  —  ${r.detail}`)
  console.log('────────────────────────────────────────────────────────')
  console.log(`TOTAL: ${results.length} | PASS: ${pass} | FAIL: ${fail} | cleanup: ${cleaned} linhas`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('ERRO FATAL no harness:', e); process.exit(1) })
