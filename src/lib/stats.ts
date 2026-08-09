// Lógica pura das Análises do admin.
//
// Toda a matemática (períodos, filtros, agregações, comparação com o período
// anterior, matriz de menu, CSV) vive aqui, separada da UI em `admin-stats.tsx`.
// Vantagem: a página fica só com a apresentação e estes helpers são simples de
// ler e de testar isoladamente. Defendem-se sempre contra dados maus reusando
// os utilitários de `order-utils.ts` (quantidades/preços sãos).

import type { Order } from '../@types/order'
import type { MenuItem } from '../@types/menu-item'
import type { Category } from '../@types/category'
import type { Payment, PaymentMethod } from '../@types/payment'
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL } from '../@types/payment'
import type { StaffAuditRow } from './staff-audit'
import { lineTotal, safeQuantity, orderSubtotal } from './order-utils'
import { entryTotal } from './rodizio'
import {
  billableOrders,
  isCancelledOrder,
  orderDiscountAmount,
  orderItemsRevenue,
  accountEntryTotal,
} from './account'

// Paleta de recurso para categorias sem cor própria definida pelo admin.
export const SLICE_COLORS = ['#f97316', '#22d3ee', '#a78bfa', '#4ade80', '#fb7185', '#facc15', '#60a5fa', '#f472b6']

// Dias da semana em PT, já na ordem que um restaurante espera (Seg → Dom).
export const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']

// ── Dia civil local ────────────────────────────────────────────────
//
// Usamos o dia LOCAL de ponta a ponta (presets, filtro, gráficos) porque é o
// que o dono do restaurante espera: um pedido às 00:30 conta em "hoje". Misturar
// dia UTC (toISOString) com dia local fazia os pedidos perto da meia-noite cair
// no dia errado.

export function localDay(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Dia local em que um pedido foi feito (a partir do createdAt em UTC).
export function orderDay(order: Order): string {
  return localDay(new Date(order.createdAt))
}

export function isoToday(): string {
  return localDay(new Date())
}

// Deslocamento em dias a partir de HOJE (negativo = passado).
export function isoOffset(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return localDay(d)
}

// Desloca um dia ISO concreto (YYYY-MM-DD) por N dias. Fixamos o meio-dia para
// não tropeçar em mudanças de hora (horário de verão).
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return localDay(d)
}

// Nº de dias civis no intervalo [from, to], inclusive (1 = um único dia).
export function daysBetween(from: string, to: string): number {
  const ms = new Date(to + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime()
  return Math.round(ms / 86_400_000) + 1
}

// ── Receita e descontos ────────────────────────────────────────────

// Desconto global em euros, sempre entre 0 e o subtotal (nem negativo, que
// inflava a receita, nem maior que o pedido, que dava receita negativa).
export function orderDiscount(order: Order): number {
  return orderDiscountAmount(order)
}

export function orderRevenue(order: Order): number {
  return orderItemsRevenue(order)
}

export function rodizioEntryRevenue(order: Order): number {
  if (
    order.entryPrice === undefined ||
    order.entryPrice === null ||
    order.headcount === undefined ||
    order.headcount === null
  ) {
    return 0
  }
  return accountEntryTotal({
    mode: 'rodizio',
    entryPrice: order.entryPrice,
    headcount: safeQuantity(order.headcount),
  })
}

// ── Entrada de rodízio a partir do PAGAMENTO (fonte fiscal) ─────────
//
// A conta paga é a fonte única da entrada de rodízio: o trigger
// payments_validate_insert calcula-a da SESSÃO e grava o snapshot
// (accountMode/accountEntryPrice/accountHeadcount) no pagamento. Os totais
// fiscais (receita total, IVA, SAF-T) leem a entrada daqui — e não de um pedido
// portador — para que a entrada cobrada não desapareça quando todos os pedidos
// da conta são cancelados (auditoria gap-0-0).
export function paymentEntryRevenue(payment: Payment): number {
  if (payment.voidedAt) return 0 // pagamento anulado não é receita
  if (payment.accountMode !== 'rodizio') return 0
  return entryTotal(payment.accountEntryPrice ?? 0, safeQuantity(payment.accountHeadcount ?? 0))
}

export function totalEntryRevenue(payments: Payment[]): number {
  return payments.reduce((sum, payment) => sum + paymentEntryRevenue(payment), 0)
}

export type OrderRevenueBreakdown = {
  order: Order
  itemsRevenue: number
  entryRevenue: number
  revenue: number
}

// A receita de entrada do rodízio é lida estritamente de cada pedido individual
// que contenha entryPrice e headcount definidos.
export function orderRevenueBreakdown(orders: Order[]): OrderRevenueBreakdown[] {
  const activeOrders = billableOrders(orders)

  return activeOrders.map((order) => {
    const itemsRevenue = orderRevenue(order)
    const entryRevenue = rodizioEntryRevenue(order)
    return {
      order,
      itemsRevenue,
      entryRevenue,
      revenue: itemsRevenue + entryRevenue,
    }
  })
}

// Calcula a receita total de uma lista de pedidos: extras/descontos por pedido +
// entrada de rodízio nos pedidos que carregam esse snapshot. Em QR permanente,
// o mesmo sessionId pode representar várias contas; por isso a entrada não pode
// ser deduplicada apenas por sessão.
export function totalRevenue(orders: Order[]): number {
  return orderRevenueBreakdown(orders).reduce((sum, row) => sum + row.revenue, 0)
}

// Quantidade total de itens vendidos num pedido.
export function orderItemCount(order: Order): number {
  if (order.status === 'cancelled') return 0
  return order.items.reduce((sum, item) => sum + safeQuantity(item.quantity), 0)
}

// ── IVA (para os relatórios) ───────────────────────────────────────
//
// Preços em PT são IVA incluído. Para cada linha: base = bruto / (1 + taxa) e
// IVA = bruto − base. A taxa vem do snapshot do item (item.vatRate); itens sem
// taxa própria usam a taxa por defeito do restaurante. O desconto global é
// distribuído pelas linhas (proporcional ao seu peso) para a soma das bases +
// IVA bater certo com a receita total.

export type VatLine = {
  rate: number    // taxa de IVA em %
  base: number    // base tributável (sem IVA)
  vat: number     // IVA
  gross: number   // total com IVA incluído
}

export function vatBreakdown(orders: Order[], payments: Payment[], defaultVatRate: number): VatLine[] {
  const grossByRate = new Map<number, number>()
  const addGross = (rate: number, gross: number) => {
    if (gross <= 0) return
    grossByRate.set(rate, (grossByRate.get(rate) ?? 0) + gross)
  }

  orderRevenueBreakdown(orders).forEach(({ order, itemsRevenue }) => {
    const subtotal = orderSubtotal(order)
    order.items.forEach((item) => {
      const rate = item.vatRate ?? defaultVatRate
      // Quota da linha na receita do pedido (já líquida do desconto global).
      const share = subtotal > 0 ? (lineTotal(item) / subtotal) * itemsRevenue : 0
      addGross(rate, share)
    })
  })

  // A entrada do rodízio vai à taxa por defeito e vem das contas pagas (fonte
  // fiscal única — ver totalEntryRevenue), não dos pedidos.
  addGross(defaultVatRate, totalEntryRevenue(payments))

  return [...grossByRate.entries()]
    .map(([rate, gross]) => {
      const base = gross / (1 + rate / 100)
      return { rate, base, vat: gross - base, gross }
    })
    .sort((a, b) => a.rate - b.rate)
}

// ── Presets de período ─────────────────────────────────────────────

export type Preset = 'today' | '7d' | '30d' | '90d' | 'all'

export const PRESET_LABELS: Record<Preset, string> = {
  today: 'Hoje',
  '7d': '7 dias',
  '30d': '30 dias',
  '90d': '90 dias',
  all: 'Tudo',
}

// Intervalo de datas de um preset. `null` = "Tudo" (sem limites).
export function presetRange(p: Preset): { from: string; to: string } | null {
  if (p === 'all') return null
  const to = isoToday()
  if (p === 'today') return { from: to, to }
  if (p === '7d') return { from: isoOffset(-6), to }
  if (p === '30d') return { from: isoOffset(-29), to }
  if (p === '90d') return { from: isoOffset(-89), to }
  return null
}

// ── Filtragem por intervalo ────────────────────────────────────────

export function filterByRange(orders: Order[], from: string, to: string): Order[] {
  if (!from && !to) return orders
  return orders.filter(o => {
    const d = orderDay(o)
    if (from && d < from) return false
    if (to && d > to) return false
    return true
  })
}

// Período imediatamente anterior, com a mesma duração. Ex.: 7 dias atuais → os 7
// dias que terminam na véspera do início atual. Serve para comparar evolução.
export function previousRange(from: string, to: string): { from: string; to: string } | null {
  if (!from || !to) return null
  const length = daysBetween(from, to)
  const prevTo = addDaysIso(from, -1)
  const prevFrom = addDaysIso(prevTo, -(length - 1))
  return { from: prevFrom, to: prevTo }
}

// ── Resumo de um período (KPIs) ────────────────────────────────────

export type Summary = {
  revenue: number
  orders: number
  items: number
  avgTicket: number
  discount: number
}

// A receita do período = receita dos itens dos pedidos faturáveis + entrada de
// rodízio cobrada nas contas pagas. A entrada vem do PAGAMENTO (não de um pedido
// portador) para reconciliar com a soma dos pagamentos e não desaparecer quando
// todos os pedidos são cancelados (auditoria gap-0-0).
export function summarize(orders: Order[], payments: Payment[]): Summary {
  const activeOrders = billableOrders(orders)
  const itemsRevenue = activeOrders.reduce((sum, order) => sum + orderRevenue(order), 0)
  const revenue = itemsRevenue + totalEntryRevenue(payments)
  const items = activeOrders.reduce((s, o) => s + orderItemCount(o), 0)
  const discount = activeOrders.reduce((s, o) => s + orderDiscount(o), 0)
  const count = activeOrders.length
  return {
    revenue,
    orders: count,
    items,
    discount,
    avgTicket: count > 0 ? revenue / count : 0,
  }
}

// Variação percentual entre dois valores. `null` quando não há base de
// comparação (período anterior sem dados) — a UI mostra "—" nesse caso.
export function pctDelta(current: number, previous: number): number | null {
  if (previous <= 0) return null
  return ((current - previous) / previous) * 100
}

// ── Cancelamentos ──────────────────────────────────────────────────

export type CancellationStats = {
  total: number       // todos os pedidos do período (cancelados incluídos)
  cancelled: number
  rate: number        // % de cancelados (0–100)
  lostValue: number   // valor bruto dos itens cancelados (o que não entrou)
  reasons: { reason: string; count: number }[] // motivos mais frequentes
}

// Recebe os pedidos do período JÁ filtrados, com os cancelados incluídos (o
// filtro por data não os remove — só billableOrders é que os tira).
export function cancellationStats(orders: Order[]): CancellationStats {
  const total = orders.length
  const cancelled = orders.filter(isCancelledOrder)
  const lostValue = cancelled.reduce((sum, o) => sum + orderSubtotal(o), 0)

  const reasonCounts = new Map<string, number>()
  cancelled.forEach((o) => {
    const reason = (o.cancelReason ?? '').trim() || 'Sem motivo'
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1)
  })
  const reasons = [...reasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)

  return {
    total,
    cancelled: cancelled.length,
    rate: total > 0 ? (cancelled.length / total) * 100 : 0,
    lostValue,
    reasons,
  }
}

// ── Receita por mesa e nº de pessoas ───────────────────────────────

export type TableStat = {
  tableNumber: number
  revenue: number
  orders: number
  covers: number   // nº de pessoas (headcount do rodízio, uma vez por sessão)
}

export function tableStats(orders: Order[]): TableStat[] {
  const byTable = new Map<number, { revenue: number; orders: number; covers: number }>()

  orderRevenueBreakdown(orders).forEach(({ order, revenue }) => {
    const entry = byTable.get(order.tableNumber) ?? { revenue: 0, orders: 0, covers: 0 }
    entry.revenue += revenue
    entry.orders += 1
    // O headcount conta no pedido que carrega a entrada. Isto distingue contas
    // sucessivas no mesmo QR permanente, onde o sessionId é reutilizado.
    if (order.mode === 'rodizio' && order.entryPrice != null && order.headcount != null) {
      entry.covers += safeQuantity(order.headcount ?? 0)
    }
    byTable.set(order.tableNumber, entry)
  })

  return [...byTable.entries()]
    .map(([tableNumber, v]) => ({ tableNumber, ...v }))
    .sort((a, b) => b.revenue - a.revenue)
}

// Total de pessoas servidas no período (só rodízio tem headcount fiável).
export function totalCovers(orders: Order[]): number {
  return tableStats(orders).reduce((sum, t) => sum + t.covers, 0)
}

// ── Meios de pagamento ─────────────────────────────────────────────

export function isVoidedPayment(payment: Payment): boolean {
  return Boolean(payment.voidedAt)
}

export function activePayments(payments: Payment[]): Payment[] {
  return payments.filter((payment) => !isVoidedPayment(payment))
}

function paymentCoversOrder(payment: Payment, order: Order): boolean {
  if (!payment.sessionId || payment.sessionId !== order.sessionId) return false
  if (!payment.accountOpenedAt) return true

  const orderTime = new Date(order.createdAt).getTime()
  const openedTime = new Date(payment.accountOpenedAt).getTime()
  const closedTime = payment.accountClosedAt ? new Date(payment.accountClosedAt).getTime() : Infinity

  if (!Number.isFinite(orderTime) || !Number.isFinite(openedTime)) return false
  return orderTime >= openedTime && orderTime <= closedTime
}

// Quando uma conta tem apenas pagamentos anulados, não deve alimentar relatórios
// financeiros. Em QR permanente, a "conta" é a janela accountOpenedAt/ClosedAt,
// não apenas o sessionId, porque o mesmo QR é reutilizado por visitas diferentes.
export function ordersWithoutVoidedOnlyPayments(orders: Order[], payments: Payment[]): Order[] {
  const active = activePayments(payments)
  const voided = payments.filter(isVoidedPayment)

  return orders.filter((order) => {
    if (!order.sessionId) return true

    if (active.some((payment) => paymentCoversOrder(payment, order))) return true
    if (voided.some((payment) => paymentCoversOrder(payment, order))) return false

    return true
  })
}

export function paymentDay(payment: Payment): string {
  return localDay(new Date(payment.createdAt))
}

export function filterPaymentsByRange(payments: Payment[], from: string, to: string): Payment[] {
  if (!from && !to) return payments
  return payments.filter((p) => {
    const d = paymentDay(p)
    if (from && d < from) return false
    if (to && d > to) return false
    return true
  })
}

export type PaymentStat = {
  method: PaymentMethod
  count: number
  amount: number
}

// Repartição por meio de pagamento. Devolve sempre as 3 entradas (mesmo a 0)
// para a UI ter uma lista estável.
export function paymentStats(payments: Payment[]): PaymentStat[] {
  const byMethod = new Map<PaymentMethod, { count: number; amount: number }>()
  activePayments(payments).forEach((p) => {
    const entry = byMethod.get(p.method) ?? { count: 0, amount: 0 }
    entry.count += 1
    entry.amount += Number.isFinite(p.amount) && p.amount > 0 ? p.amount : 0
    byMethod.set(p.method, entry)
  })
  return PAYMENT_METHODS.map((method) => ({
    method,
    count: byMethod.get(method)?.count ?? 0,
    amount: byMethod.get(method)?.amount ?? 0,
  }))
}

// ── Série diária ───────────────────────────────────────────────────

export type DayPoint = {
  day: string      // YYYY-MM-DD
  label: string    // legível no eixo
  revenue: number
  orders: number
  items: number
}

// Uma entrada por dia civil do intervalo (mesmo dias sem pedidos = 0), para os
// gráficos de evolução e as sparklines nunca terem "buracos".
export function dailySeries(orders: Order[], from: string, to: string): DayPoint[] {
  if (!from || !to) return []
  const total = daysBetween(from, to)
  if (total < 1) return []

  // Agrupa pedidos e receita por dia uma só vez. A receita vem do breakdown para
  // a entrada do rodízio não duplicar se a mesma sessão atravessar a meia-noite.
  const ordersByDay = new Map<string, Order[]>()
  const revenueByDay = new Map<string, number>()
  orderRevenueBreakdown(orders).forEach(({ order, revenue }) => {
    const day = orderDay(order)
    const bucket = ordersByDay.get(day)
    if (bucket) bucket.push(order)
    else ordersByDay.set(day, [order])
    revenueByDay.set(day, (revenueByDay.get(day) ?? 0) + revenue)
  })

  const useWeekday = total <= 8
  return Array.from({ length: total }, (_, i) => {
    const day = addDaysIso(from, i)
    const dayOrders = ordersByDay.get(day) ?? []
    const date = new Date(day + 'T12:00:00')
    return {
      day,
      label: useWeekday
        ? date.toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric' })
        : date.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' }),
      revenue: revenueByDay.get(day) ?? 0,
      orders: dayOrders.length,
      items: dayOrders.reduce((s, o) => s + orderItemCount(o), 0),
    }
  })
}

// Junta a série atual e a do período anterior alinhadas pela mesma posição (dia
// 1 vs dia 1), para o gráfico desenhar as duas linhas sobrepostas.
export type ComparePoint = { label: string; current: number; previous: number | null }

export function alignSeries(
  current: DayPoint[],
  previous: DayPoint[],
  metric: 'revenue' | 'orders',
): ComparePoint[] {
  return current.map((point, i) => ({
    label: point.label,
    current: point[metric],
    previous: previous[i] ? previous[i][metric] : null,
  }))
}

// ── Itens ──────────────────────────────────────────────────────────

export type ItemStat = { id: string; name: string; qty: number; revenue: number }

export function itemStats(orders: Order[]): ItemStat[] {
  const map = new Map<string, ItemStat>()
  billableOrders(orders).forEach(order => {
    order.items.forEach(item => {
      const entry = map.get(item.menuItemId) ?? { id: item.menuItemId, name: item.menuItemName, qty: 0, revenue: 0 }
      entry.name = item.menuItemName
      entry.qty += safeQuantity(item.quantity)
      entry.revenue += lineTotal(item)
      map.set(item.menuItemId, entry)
    })
  })
  return [...map.values()].sort((a, b) => b.qty - a.qty)
}

// ── Matriz de engenharia de menu ───────────────────────────────────
//
// Técnica clássica de restauração: cruzar POPULARIDADE (nº de pedidos) com
// CONTRIBUIÇÃO (receita gerada) e dividir o menu em quatro quadrantes pela
// mediana de cada eixo. Sem dados de custo (o protótipo só tem preço), usamos a
// receita como eixo de valor — honesto e na mesma acionável.
//
//   estrela → muito pedido + muita receita  (proteger, destacar no menu)
//   popular → muito pedido + pouca receita   (subir preço ou fazer upsell)
//   nicho   → pouco pedido + muita receita    (promover, dar visibilidade)
//   fraco   → pouco pedido + pouca receita     (rever ou remover)

export type Quadrant = 'estrela' | 'popular' | 'nicho' | 'fraco'

export type MatrixPoint = ItemStat & { quadrant: Quadrant }

export type MenuMatrix = {
  points: MatrixPoint[]
  medianQty: number
  medianRevenue: number
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]
  return (sorted[mid - 1] + sorted[mid]) / 2
}

export function menuMatrix(items: ItemStat[]): MenuMatrix {
  const medianQty = median(items.map(i => i.qty))
  const medianRevenue = median(items.map(i => i.revenue))

  const points = items.map(item => {
    const highQty = item.qty >= medianQty
    const highRevenue = item.revenue >= medianRevenue
    let quadrant: Quadrant
    if (highQty && highRevenue) quadrant = 'estrela'
    else if (highQty && !highRevenue) quadrant = 'popular'
    else if (!highQty && highRevenue) quadrant = 'nicho'
    else quadrant = 'fraco'
    return { ...item, quadrant }
  })

  return { points, medianQty, medianRevenue }
}

// Cores dos quadrantes: "Estrelas" usa a cor da marca via var() (reage ao tema);
// as restantes são categóricas fixas, escolhidas para nunca colidirem com o azul
// da marca (por isso "Populares" é âmbar e não azul).
export const QUADRANT_META: Record<Quadrant, { label: string; color: string; hint: string }> = {
  estrela: { label: 'Estrelas', color: 'var(--brand)', hint: 'Muito pedidos e muita receita — proteger e destacar.' },
  popular: { label: 'Populares', color: '#f59e0b', hint: 'Muito pedidos, pouca receita — subir preço ou upsell.' },
  nicho: { label: 'Nicho', color: '#a78bfa', hint: 'Pouco pedidos, boa receita — dar mais visibilidade.' },
  fraco: { label: 'A rever', color: 'var(--muted-foreground)', hint: 'Pouco pedidos e pouca receita — rever ou remover.' },
}

// ── Categorias ─────────────────────────────────────────────────────

export type CatStat = { name: string; qty: number; revenue: number; color: string }

function mapById<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]))
}

export function categoryStats(orders: Order[], menuItems: MenuItem[], categories: Category[]): CatStat[] {
  const menuItemsById = mapById(menuItems)
  const categoriesById = mapById(categories)
  const map = new Map<string, { qty: number; revenue: number }>()

  billableOrders(orders).forEach(order => {
    order.items.forEach(item => {
      const catId = menuItemsById.get(item.menuItemId)?.categoryId ?? '__other__'
      const entry = map.get(catId) ?? { qty: 0, revenue: 0 }
      entry.qty += safeQuantity(item.quantity)
      entry.revenue += lineTotal(item)
      map.set(catId, entry)
    })
  })
  return [...map.entries()]
    .map(([catId, agg], i) => {
      const cat = categoriesById.get(catId)
      return {
        name: cat?.name ?? '—',
        qty: agg.qty,
        revenue: agg.revenue,
        color: cat?.color ?? SLICE_COLORS[i % SLICE_COLORS.length],
      }
    })
    .sort((a, b) => b.qty - a.qty)
}

// ── Origem dos pedidos (canal) ─────────────────────────────────────
//
// O cliente que faz o pedido pelo QR à mesa vs o pedido lançado pelo empregado.
// É a leitura de "canal" que os POS mostram (dine-in vs balcão) com os dados que
// temos.

export type SourceStat = { key: 'cliente' | 'empregado'; label: string; orders: number; revenue: number; color: string }

export function sourceStats(orders: Order[]): SourceStat[] {
  const base: Record<'cliente' | 'empregado', { orders: number; revenue: number }> = {
    cliente: { orders: 0, revenue: 0 },
    empregado: { orders: 0, revenue: 0 },
  }
  orderRevenueBreakdown(orders).forEach(({ order, revenue }) => {
    const key = order.source === 'cliente' ? 'cliente' : 'empregado'
    base[key].orders += 1
    base[key].revenue += revenue
  })
  return [
    { key: 'cliente', label: 'Cliente (QR)', orders: base.cliente.orders, revenue: base.cliente.revenue, color: 'var(--brand)' },
    { key: 'empregado', label: 'Empregado', orders: base.empregado.orders, revenue: base.empregado.revenue, color: '#a78bfa' },
  ]
}

// ── Mapa de calor: dia da semana × hora ────────────────────────────
//
// Matriz 7×24 (Seg→Dom, 0→23h) com a contagem de pedidos por célula. É o gráfico
// que falta para perceber *quando* vale a pena ter mais gente ao serviço — os
// POS profissionais mostram exatamente isto.

export type Heatmap = {
  grid: number[][]              // [dia 0-6][hora 0-23]
  max: number                   // valor máximo de uma célula (escala de cor)
  dayTotals: number[]           // total por dia da semana
  hourTotals: number[]          // total por hora
  busiest: { day: number; hour: number; count: number } | null
}

export function weekdayHourHeatmap(orders: Order[]): Heatmap {
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0))
  billableOrders(orders).forEach(o => {
    const date = new Date(o.createdAt)
    // getDay(): 0=Domingo … 6=Sábado. Convertemos para Seg=0 … Dom=6.
    const day = (date.getDay() + 6) % 7
    grid[day][date.getHours()] += 1
  })

  let max = 0
  let busiest: Heatmap['busiest'] = null
  const dayTotals = new Array(7).fill(0)
  const hourTotals = new Array(24).fill(0)
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const count = grid[d][h]
      dayTotals[d] += count
      hourTotals[h] += count
      if (count > max) max = count
      if (count > 0 && (!busiest || count > busiest.count)) {
        busiest = { day: d, hour: h, count }
      }
    }
  }
  return { grid, max, dayTotals, hourTotals, busiest }
}

// ── Combinações frequentes (análise de cabaz) ──────────────────────
//
// Pares de itens que aparecem juntos no mesmo pedido. Ajuda a desenhar menus de
// combo e sugestões de upsell. Só conta itens das categorias selecionadas.

export type Combination = { a: string; b: string; count: number }

export function combinations(orders: Order[], menuItems: MenuItem[], allowedCats: Set<string>): Combination[] {
  const menuItemsById = mapById(menuItems)
  const pairMap = new Map<string, Combination>()

  billableOrders(orders).forEach(order => {
    // Itens distintos do pedido que pertencem às categorias permitidas.
    const inOrder = new Map<string, string>()
    order.items.forEach(item => {
      if (inOrder.has(item.menuItemId)) return
      const mi = menuItemsById.get(item.menuItemId)
      if (mi && allowedCats.has(mi.categoryId)) {
        inOrder.set(item.menuItemId, item.menuItemName)
      }
    })
    const entries = [...inOrder.entries()]
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [idA, nameA] = entries[i]
        const [idB, nameB] = entries[j]
        // Ordena o par por id para "A+B" e "B+A" contarem como o mesmo.
        const [ka, kb, na, nb] = idA < idB ? [idA, idB, nameA, nameB] : [idB, idA, nameB, nameA]
        const key = `${ka}|||${kb}`
        const existing = pairMap.get(key)
        if (existing) existing.count++
        else pairMap.set(key, { a: na, b: nb, count: 1 })
      }
    }
  })
  return [...pairMap.values()].sort((a, b) => b.count - a.count).slice(0, 8)
}

// ── Itens ativos que nunca foram pedidos ───────────────────────────

export function neverOrdered(orders: Order[], menuItems: MenuItem[]): MenuItem[] {
  const orderedIds = new Set(billableOrders(orders).flatMap(o => o.items.map(i => i.menuItemId)))
  return menuItems.filter(m => m.available && !orderedIds.has(m.id))
}

// ── Exportação CSV ─────────────────────────────────────────────────
//
// Gera o CSV do resumo diário do período. Sem dependências — só uma string que
// a página entrega como download. Escapamos com aspas porque os nomes podem ter
// vírgulas.

export function csvCell(value: string | number): string {
  const text = String(value)
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export function buildCsv(rows: Array<Array<string | number>>): string {
  return rows.map(row => row.map(csvCell).join(',')).join('\n')
}

// Junta as linhas de comentário (cada uma como `# ...`) ANTES do CSV. O Excel e
// o pandas ignoram linhas que começam por `#`, por isso servem para metadados e
// avisos legais sem estragar a tabela. Quem chama decide o que vai em `comments`
// (ex: metaRows achatado + LEGAL_NO_FISCAL); aqui só prefixamos.
function withCommentLines(csv: string, comments?: string[]): string {
  if (!comments || comments.length === 0) return csv
  const commentLines = comments.map(line => `# ${line}`).join('\n')
  return `${commentLines}\n${csv}`
}

export function buildDailyCsv(series: DayPoint[], comments?: string[]): string {
  const header = ['Dia', 'Receita', 'Pedidos', 'Itens']
  const rows = series.map(p => [p.day, p.revenue.toFixed(2), p.orders, p.items])
  return withCommentLines(buildCsv([header, ...rows]), comments)
}

export function buildItemsCsv(items: ItemStat[], comments?: string[]): string {
  const header = ['Item', 'Qtd', 'Receita']
  const rows = items.map(i => [i.name, i.qty, i.revenue.toFixed(2)])
  return withCommentLines(buildCsv([header, ...rows]), comments)
}

export function buildCategoriesCsv(cats: CatStat[], comments?: string[]): string {
  const header = ['Categoria', 'Qtd', 'Receita']
  const rows = cats.map(c => [c.name, c.qty, c.revenue.toFixed(2)])
  return withCommentLines(buildCsv([header, ...rows]), comments)
}

export function buildPaymentsCsv(pays: PaymentStat[], comments?: string[]): string {
  const header = ['Método', 'Nº', 'Valor']
  const rows = pays.map(p => [PAYMENT_METHOD_LABEL[p.method], p.count, p.amount.toFixed(2)])
  return withCommentLines(buildCsv([header, ...rows]), comments)
}

export function buildVatCsv(vat: VatLine[], comments?: string[]): string {
  const header = ['Taxa', 'Base', 'IVA', 'Total']
  const rows = vat.map(v => [`${v.rate}%`, v.base.toFixed(2), v.vat.toFixed(2), v.gross.toFixed(2)])
  return withCommentLines(buildCsv([header, ...rows]), comments)
}

export function buildStaffAuditCsv(rows: StaffAuditRow[], comments?: string[]): string {
  const header = ['Staff', 'Cancelamentos', 'Pagamentos', 'Valor', 'Anulações', 'Turnos abertos', 'Turnos fechados', 'Horas']
  const body = rows.map(r => [
    r.name,
    r.cancellations,
    r.paymentsRegistered,
    r.amountRegistered.toFixed(2),
    r.paymentsVoided,
    r.shiftsOpened,
    r.shiftsClosed,
    r.hoursWorked.toFixed(2),
  ])
  return withCommentLines(buildCsv([header, ...body]), comments)
}
