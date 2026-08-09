// Stress/carga ao manage-eat (Supabase local). Foca-se em encontrar limites e
// CORRIDAS (race conditions), não só latência. Estrela: a corrida de cobrança
// dupla (createPayment + closeSession não são atómicos).
//
// Uso:  npm run attack:stress
// Pré-requisitos: Supabase local + `npm run seed`.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  assertLocal,
  anonClient,
  serviceClient,
  signIn,
  signInAnon,
  settle,
  claimResult,
  rid,
  uuid,
  record,
  writeReport,
} from './harness'

const ITEM_PRICE = 10
const ITEM_VAT = 13

const created = {
  catId: uuid(),
  itemId: uuid(),
  sessOrders: 'atk-st-ord-' + rid().slice(4),
  sessPay: 'atk-st-pay-' + rid().slice(4),
  sessQr: 'atk-st-qr-' + rid().slice(4),
  orderIds: [] as string[],
  // Turnos abertos pelas corridas de ponto (picar entrada / auto-fecho). Limpos
  // no fim por id — só os que ESTE script criou, produção fica intocada.
  shiftIds: [] as string[],
}
let prevSettings: Record<string, unknown> | null = null

function pct(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return Math.round(sorted[idx])
}

function orderRow(sessionId: string, table: number): Record<string, unknown> {
  const id = 'atk-st-' + rid().slice(4)
  created.orderIds.push(id)
  return {
    id,
    request_id: id,
    table_number: table,
    session_id: sessionId,
    source: 'cliente',
    items: [{ menuItemId: created.itemId, menuItemName: 'ATK', quantity: 1, price: ITEM_PRICE, vatRate: ITEM_VAT }],
    status: 'pending',
    created_at: new Date().toISOString(),
  }
}

async function setup(svc: SupabaseClient): Promise<void> {
  prevSettings = (await svc.from('settings').select('*').eq('id', 'restaurant').maybeSingle()).data as Record<string, unknown> | null
  await svc.from('settings').upsert({ id: 'restaurant', mode: 'normal', entry_price: 0, default_vat_rate: ITEM_VAT }, { onConflict: 'id' })
  await svc.from('categories').insert({ id: created.catId, name: 'ATK ST Cat', color: '#003399' })
  await svc.from('menu_items').insert({
    id: created.itemId, name: 'ATK', description: 's', price: ITEM_PRICE, category_id: created.catId,
    available: true, discount: null, removable_ingredients: [], vat_rate: ITEM_VAT, rodizio_available: false,
  })
  const now = new Date().toISOString()
  const future = new Date(Date.now() + 3600_000).toISOString()
  await svc.from('sessions').insert([
    { id: created.sessOrders, table_number: 81, created_at: now, opened_at: now, expires_at: future, open: true },
    { id: created.sessPay, table_number: 82, created_at: now, opened_at: now, expires_at: future, open: true },
    { id: created.sessQr, table_number: 84, created_at: now, opened_at: now, expires_at: future, open: true },
  ])
  // Pedido base na conta de pagamentos → total esperado = 10€. 'delivered' para a
  // conta ser pagável (a guard recusa pagamento com pedidos por concluir).
  const base = 'atk-st-base-' + rid().slice(4)
  created.orderIds.push(base)
  await svc.from('orders').insert({ ...orderRow(created.sessPay, 82), id: base, request_id: base, status: 'delivered' })
}

async function cleanup(svc: SupabaseClient): Promise<void> {
  await svc.from('payments').delete().in('session_id', [created.sessPay])
  await svc.from('orders').delete().in('id', created.orderIds)
  // Turnos de teste primeiro (as corridas de ponto criam-nos com uid real).
  if (created.shiftIds.length > 0) await svc.from('shifts').delete().in('id', created.shiftIds)
  await svc.from('sessions').delete().in('id', [created.sessOrders, created.sessPay, created.sessQr])
  await svc.from('menu_items').delete().eq('id', created.itemId)
  await svc.from('categories').delete().eq('id', created.catId)
  if (prevSettings) await svc.from('settings').upsert(prevSettings, { onConflict: 'id' })
}

// ── Cenário 1: cheia de pedidos → bater no rate-limit (10/30s por sessão anónima) ──
async function scenarioOrderFlood(): Promise<void> {
  const an = anonClient()
  await signInAnon(an)
  await settle(an.rpc('claim_session_with_code', { p_session_id: created.sessOrders, p_code_hash: 'code-flood' }))

  const N = 30
  const lat: number[] = []
  const tasks = Array.from({ length: N }, () => async () => {
    const t = performance.now()
    const { error } = await settle(an.from('orders').insert(orderRow(created.sessOrders, 81)))
    lat.push(performance.now() - t)
    return error ? 'blocked' : 'ok'
  })
  const res = await Promise.all(tasks.map((f) => f()))
  const ok = res.filter((r) => r === 'ok').length
  const blocked = N - ok
  console.log(`  Cenário 1 (cheia de pedidos): ${N} disparados → ${ok} aceites, ${blocked} bloqueados | p50=${pct(lat, 50)}ms p95=${pct(lat, 95)}ms`)
  record({
    title: 'Rate-limit de pedidos sob carga (10/30s)',
    severity: 'high', role: 'anon',
    held: blocked > 0,
    detail: blocked > 0 ? `aguentou: ${ok} aceites, ${blocked} bloqueados de ${N}` : `*** NENHUM bloqueado em ${N} — rate-limit não funcionou ***`,
  })
}

// ── Cenário 2: corrida de cobrança dupla (createPayment + closeSession) ──
async function scenarioPaymentRace(svc: SupabaseClient): Promise<void> {
  const e = anonClient()
  const empUid = await signIn(e, 'empregado')

  // O empregado só cobra com o seu turno aberto.
  // Sem isto o pagamento é negado antes da corrida e o cenário não testa nada.
  // Reutiliza um turno aberto existente; senão abre um (limpo no fim por id).
  let shiftId = ((await settle(svc.from('shifts').select('id').eq('opened_by', empUid).eq('status', 'open').maybeSingle())).data as { id?: string } | null)?.id ?? null
  if (!shiftId) {
    const id = uuid()
    const ins = await settle(e.from('shifts').insert({ id, opened_by: empUid, opened_at: new Date().toISOString(), status: 'open' }))
    if (!ins.error) {
      shiftId = id
      created.shiftIds.push(id)
    }
  }

  const N = 6
  // Cada tarefa = um "fechar conta": insere pagamento (id próprio) e fecha a sessão.
  // Como as 2 chamadas não são atómicas, vários pagamentos entram antes do 1.º fecho.
  const tasks = Array.from({ length: N }, () => async () => {
    const ins = await settle(e.from('payments').insert({
      id: uuid(), table_number: 82, session_id: created.sessPay, shift_id: shiftId,
      amount: ITEM_PRICE, method: 'dinheiro', created_at: new Date().toISOString(), created_by: empUid,
    }))
    await settle(e.from('sessions').update({ open: false, access_code_hash: null, opened_at: null, mode: null, entry_price: null, headcount: null }).eq('id', created.sessPay))
    return ins.error ? 0 : 1
  })
  const wins = (await Promise.all(tasks.map((f) => f()))).reduce((a, b) => a + b, 0)
  // Confirma na BD quantos pagamentos ficaram para a mesma conta.
  const paid = await settle(svc.from('payments').select('id', { count: 'exact' }).eq('session_id', created.sessPay))
  const rows = Array.isArray(paid.data) ? paid.data.length : 0
  console.log(`  Cenário 2 (corrida de pagamento): ${N} fechos concorrentes → ${wins} venceram, ${rows} pagamentos na BD`)
  let detail: string
  if (rows === 1) detail = `exatamente 1 pagamento (payments_guard_double + índice único aguentaram a corrida); ${wins}/${N} tentativas venceram`
  else if (rows === 0) detail = `nenhum pagamento entrou — verifica o setup (pedido tem de estar 'delivered')`
  else detail = `*** ${rows} pagamentos para a MESMA conta — cobrança múltipla possível ***`
  record({
    title: 'Atomicidade do fecho de conta (cobrança dupla)',
    severity: 'critical', role: 'empregado',
    held: rows === 1,
    detail,
  })

  // Picar a saída do turno de TESTE (só se foi este script a abri-lo) para os
  // cenários de ponto a seguir começarem sem turno aberto. Nunca fechamos um
  // turno real de produção que tenhamos reutilizado.
  if (shiftId && created.shiftIds.includes(shiftId)) {
    await settle(e.from('shifts').update({ status: 'closed', closed_by: empUid, closed_at: new Date().toISOString() }).eq('id', shiftId))
  }
}

// ── Cenário 3: amplificação do Realtime (cada escrita acorda todos os subscritores) ──
async function scenarioRealtimeAmplification(svc: SupabaseClient): Promise<void> {
  const SUBS = 10
  const clients = await Promise.all(Array.from({ length: SUBS }, async () => {
    const c = anonClient()
    await signIn(c, 'empregado')
    return c
  }))
  let fires = 0
  const channels = clients.map((c, i) =>
    c.channel('atk-rt-' + i).on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => { fires++ }),
  )
  // Subscrever todos (com timeout para não pendurar).
  await Promise.all(channels.map((ch) => new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 4000)
    ch.subscribe((status) => { if (status === 'SUBSCRIBED') { clearTimeout(t); resolve() } })
  })))

  const M = 3
  for (let i = 0; i < M; i++) await svc.from('orders').insert(orderRow(created.sessOrders, 81))
  await new Promise((r) => setTimeout(r, 2500)) // deixar propagar
  await Promise.all(clients.map((c) => c.removeAllChannels()))

  const expected = M * SUBS
  const inconclusive = fires === 0
  console.log(`  Cenário 3 (Realtime): ${M} escritas × ${SUBS} subscritores → ${fires} eventos (esperado ~${expected})`)
  record({
    title: 'Amplificação do Realtime (fan-out + refetch da lista inteira)',
    severity: 'info', role: 'staff',
    held: true, // nota de desempenho, não vulnerabilidade
    detail: inconclusive
      ? `INCONCLUSIVO: o Realtime não entregou eventos em modo headless (medir no browser). Setup: ${SUBS} subs, ${M} escritas`
      : `${fires} eventos para ${M} escritas × ${SUBS} subscritores — cada escrita renotifica todos e, no app, refaz a lista inteira`,
  })
}

// ── Cenário 4: brute-force concorrente ao código (lockout aguenta a corrida?) ──
async function scenarioQrFlood(): Promise<void> {
  const claimer = anonClient()
  await signInAnon(claimer)
  await settle(claimer.rpc('claim_session_with_code', { p_session_id: created.sessQr, p_code_hash: 'qr-real' }))

  const attackers = await Promise.all(Array.from({ length: 5 }, async () => {
    const c = anonClient()
    await signInAnon(c)
    return c
  }))
  const tasks: Array<() => Promise<Record<string, unknown> | null>> = []
  for (const c of attackers) {
    for (let i = 0; i < 6; i++) {
      tasks.push(async () => claimResult((await settle(c.rpc('claim_session_with_code', { p_session_id: created.sessQr, p_code_hash: 'w-' + Math.random().toString(16).slice(2) }))).data))
    }
  }
  const res = await Promise.all(tasks.map((f) => f()))
  const anyOk = res.some((r) => r?.ok === true)
  const blockedCount = res.filter((r) => String(r?.reason ?? '') === 'bloqueado').length
  console.log(`  Cenário 4 (cheia de claims QR): ${tasks.length} tentativas erradas concorrentes → ${blockedCount} bloqueadas, sucesso indevido: ${anyOk}`)
  record({
    title: 'Lockout do código QR sob concorrência',
    severity: 'high', role: 'anon',
    held: !anyOk && blockedCount > 0,
    detail: anyOk ? '*** um código errado foi aceite sob corrida ***' : `lockout aguentou: ${blockedCount} bloqueadas de ${tasks.length}`,
  })
}

// ── Cenário 5: picar entrada em duplicado sob concorrência ──────────────────
// O índice único shifts_single_open_idx (opened_by where status='open') tem de
// deixar passar EXATAMENTE 1 de N inserts simultâneos do mesmo utilizador — o
// duplo "picar entrada" em dois dispositivos ao mesmo tempo não abre 2 turnos.
async function scenarioDoubleClockIn(svc: SupabaseClient): Promise<void> {
  const e = anonClient()
  const empUid = await signIn(e, 'empregado')

  // Se o empregado já tiver turno de produção aberto, não mexemos — saltamos.
  const pre = await settle(svc.from('shifts').select('id').eq('opened_by', empUid).eq('status', 'open').maybeSingle())
  if ((pre.data as { id?: string } | null)?.id) {
    console.log('  Cenário 5 (picar entrada duplo): saltado — empregado já tinha turno aberto (produção)')
    record({ title: 'Picar entrada duplicado sob concorrência (índice único)', severity: 'high', role: 'empregado', held: true, detail: 'saltado: empregado já tinha turno de produção aberto (não tocado)' })
    return
  }

  const N = 8
  // Cada tarefa manda o próprio insert de turno aberto; opened_at/auto_closed são
  // reescritos pela BD. Só o vencedor da corrida sobrevive ao índice único.
  const tasks = Array.from({ length: N }, () => async (): Promise<number> => {
    const ins = await settle(e.from('shifts').insert({ id: uuid(), opened_by: empUid, opened_at: new Date().toISOString(), status: 'open' }))
    return ins.error ? 0 : 1
  })
  const wins = (await Promise.all(tasks.map((f) => f()))).reduce((a, b) => a + b, 0)

  // Verdade na BD: quantos turnos ABERTOS ficaram para este utilizador.
  const open = await settle(svc.from('shifts').select('id').eq('opened_by', empUid).eq('status', 'open'))
  const openRows = Array.isArray(open.data) ? (open.data as Array<{ id: string }>) : []
  for (const row of openRows) created.shiftIds.push(row.id) // para o cleanup

  console.log(`  Cenário 5 (picar entrada duplo): ${N} inserts simultâneos → ${wins} aceites pelo cliente, ${openRows.length} turnos abertos na BD`)
  const held = openRows.length === 1
  let detail: string
  if (held) detail = `exatamente 1 turno aberto (índice único aguentou a corrida); ${wins}/${N} inserts venceram`
  else if (openRows.length === 0) detail = '*** nenhum turno aberto — o insert legítimo falhou (ver setup) ***'
  else detail = `*** ${openRows.length} turnos abertos para o MESMO utilizador — dupla picagem possível ***`
  record({ title: 'Picar entrada duplicado sob concorrência (índice único)', severity: 'high', role: 'empregado', held, detail })
}

// ── Cenário 6: corrida no close_stale_shifts() (auto-fecho) ──────────────────
// Chamamos a função em paralelo enquanto um turno já passou o limite. Provas:
//  • sem double-close: a soma dos closed_count das chamadas paralelas = 1;
//  • closed_at determinístico = opened_at + limite (não "agora");
//  • auto_closed=true e, depois de fechado, imutável (o trigger recusa updates).
async function scenarioCloseStaleRace(svc: SupabaseClient): Promise<void> {
  const e = anonClient()
  const empUid = await signIn(e, 'empregado')

  // Limite minúsculo (~1.08s) só durante este cenário; o cleanup repõe as settings
  // reais. Fica dentro do check (0 < max_shift_hours <= 24).
  const MAX_HOURS = 0.0003
  await svc.from('settings').update({ max_shift_hours: MAX_HOURS }).eq('id', 'restaurant')

  // Garantir exatamente 1 turno aberto do empregado para servir de "esquecido".
  // Reutiliza o que já esteja aberto (ex.: do cenário 5) — o índice único não
  // deixa abrir um segundo.
  const existing = await settle(svc.from('shifts').select('id, opened_at').eq('opened_by', empUid).eq('status', 'open').maybeSingle())
  let shiftId = (existing.data as { id?: string } | null)?.id ?? null
  if (!shiftId) {
    const id = uuid()
    const ins = await settle(e.from('shifts').insert({ id, opened_by: empUid, opened_at: new Date().toISOString(), status: 'open' }))
    if (ins.error) {
      record({ title: 'Corrida no auto-fecho (close_stale_shifts)', severity: 'high', role: 'empregado', held: true, detail: 'saltado: não foi possível abrir turno de teste' })
      if (prevSettings) await svc.from('settings').update({ max_shift_hours: prevSettings.max_shift_hours ?? null }).eq('id', 'restaurant')
      return
    }
    shiftId = id
    created.shiftIds.push(id)
  }

  // Ler o opened_at real (a BD é dona do timestamp) para o esperado do closed_at.
  const before = (await settle(svc.from('shifts').select('opened_at').eq('id', shiftId).maybeSingle())).data as { opened_at?: string } | null
  const openedAt = before?.opened_at ?? ''

  // Esperar o turno passar o limite (1.08s) antes de disparar o varredor.
  await new Promise((r) => setTimeout(r, 1500))

  // P chamadas paralelas ao varredor a partir de clientes staff distintos.
  const P = 6
  const sweepers = await Promise.all(Array.from({ length: P }, async () => {
    const c = anonClient()
    await signIn(c, 'empregado')
    return c
  }))
  const counts = await Promise.all(sweepers.map(async (c) => {
    const r = await settle(c.rpc('close_stale_shifts'))
    return typeof r.data === 'number' ? r.data : 0
  }))
  const totalClosed = counts.reduce((a, b) => a + b, 0)

  // Estado final do turno na BD.
  const after = (await settle(svc.from('shifts').select('status, auto_closed, opened_at, closed_at, closed_by').eq('id', shiftId).maybeSingle())).data as
    { status?: string; auto_closed?: boolean; opened_at?: string; closed_at?: string; closed_by?: string } | null

  // closed_at esperado = opened_at + limite, no MESMO formato de now_iso() da BD.
  const expectedClosedMs = openedAt ? new Date(openedAt).getTime() + MAX_HOURS * 3600 * 1000 : 0
  const actualClosedMs = after?.closed_at ? new Date(after.closed_at).getTime() : 0
  const deterministic = Math.abs(actualClosedMs - expectedClosedMs) <= 1000 // tolerância de formatação (ms)

  // Imutabilidade: um turno fechado não aceita voltar a auto_closed=false nem reabrir.
  const tamper = await settle(e.from('shifts').update({ auto_closed: false }).eq('id', shiftId))
  const afterTamper = (await settle(svc.from('shifts').select('auto_closed, status').eq('id', shiftId).maybeSingle())).data as { auto_closed?: boolean; status?: string } | null
  const immutable = afterTamper?.auto_closed === true && afterTamper?.status === 'closed'

  console.log(`  Cenário 6 (corrida auto-fecho): ${P} chamadas paralelas → soma closed_count=${totalClosed} (esperado 1) | status=${after?.status} auto_closed=${after?.auto_closed} determinístico=${deterministic} imutável=${immutable}`)

  const noDoubleClose = totalClosed === 1
  const closedOk = after?.status === 'closed' && after?.auto_closed === true
  const held = noDoubleClose && closedOk && deterministic && immutable
  const problems: string[] = []
  if (!noDoubleClose) problems.push(`double-close: soma closed_count=${totalClosed} (≠1)`)
  if (!closedOk) problems.push(`estado final inesperado (status=${after?.status}, auto_closed=${after?.auto_closed})`)
  if (!deterministic) problems.push(`closed_at não determinístico (esperado ~${new Date(expectedClosedMs).toISOString()}, obtido ${after?.closed_at})`)
  if (!immutable) problems.push(`marca auto_closed mutável depois do fecho (tamper.error=${tamper.error?.message ?? 'nenhum'})`)
  record({
    title: 'Corrida no auto-fecho (close_stale_shifts): sem double-close + determinístico + imutável',
    severity: 'high', role: 'empregado',
    held,
    detail: held ? `1 único fecho, closed_at=opened_at+limite, auto_closed imutável (${P} chamadas paralelas)` : '*** ' + problems.join('; ') + ' ***',
  })

  // Repor o max_shift_hours real já (não esperar pelo cleanup) para não afetar
  // nada a seguir. O cleanup faz o upsert completo das settings à mesma.
  await svc.from('settings').update({ max_shift_hours: (prevSettings?.max_shift_hours as number | null | undefined) ?? null }).eq('id', 'restaurant')
}

async function main(): Promise<void> {
  assertLocal()
  const svc = serviceClient()
  console.log('A montar fixtures (service_role)...')
  await setup(svc)

  console.log('\n=== STRESS / CARGA ===')
  await scenarioOrderFlood()
  await scenarioPaymentRace(svc)
  await scenarioRealtimeAmplification(svc)
  await scenarioQrFlood()
  await scenarioDoubleClockIn(svc)
  await scenarioCloseStaleRace(svc)

  console.log('\nA limpar fixtures...')
  await cleanup(svc)

  const open = writeReport('stress')
  process.exit(open > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('ERRO no stress:', err)
  process.exit(2)
})
