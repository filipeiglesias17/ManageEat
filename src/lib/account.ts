import type { Order } from '../@types/order'
import type { SessionMode } from '../@types/settings'
import { orderSubtotal } from './order-utils'
import { entryTotal } from './rodizio'

export type AccountSessionSnapshot = {
  id?: string
  tableNumber?: number
  openedAt?: string
  mode?: SessionMode
  entryPrice?: number
  headcount?: number
}

export type AccountTotals = {
  entry: number
  submittedExtras: number
  cartExtras: number
  extras: number
  total: number
}

export function isCancelledOrder(order: Order): boolean {
  return order.status === 'cancelled'
}

export function isUnfinishedOrder(order: Order): boolean {
  return order.status === 'pending' || order.status === 'preparing' || order.status === 'ready'
}

export function billableOrders(orders: Order[]): Order[] {
  return orders.filter((order) => !isCancelledOrder(order))
}

export function currentAccountOrders(session: AccountSessionSnapshot, orders: Order[]): Order[] {
  return orders.filter((order) => orderBelongsToCurrentAccount(session, order))
}

export function unfinishedAccountOrders(session: AccountSessionSnapshot, orders: Order[]): Order[] {
  return currentAccountOrders(session, orders).filter(isUnfinishedOrder)
}

export type TableHistoryGroups = {
  current: Order[]
  previous: Order[]
}

// Histórico de uma mesa para o empregado: todos os pedidos da mesa física,
// separados entre a conta atual (>= openedAt da sessão) e as contas anteriores.
// Inclui sessões antigas e pedidos cancelados — é uma vista de auditoria, não a
// conta a pagar. Ordenado do mais recente para o mais antigo.
export function tableHistory(session: AccountSessionSnapshot, orders: Order[]): TableHistoryGroups {
  const tableOrders = orders
    .filter((order) => session.tableNumber === undefined || order.tableNumber === session.tableNumber)
    .slice()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))

  const current = currentAccountOrders(session, tableOrders)
  const currentIds = new Set(current.map((order) => order.id))
  const previous = tableOrders.filter((order) => !currentIds.has(order.id))

  return { current, previous }
}

function orderBelongsToCurrentAccount(session: AccountSessionSnapshot, order: Order): boolean {
  if (session.tableNumber !== undefined && order.tableNumber !== session.tableNumber) {
    return false
  }

  if (session.id && order.sessionId && order.sessionId !== session.id) {
    return false
  }

  if (!session.openedAt) {
    return session.id ? order.sessionId === session.id : true
  }

  const openedAt = Date.parse(session.openedAt)
  const createdAt = Date.parse(order.createdAt)
  if (!Number.isFinite(openedAt) || !Number.isFinite(createdAt)) {
    return false
  }

  return createdAt >= openedAt
}

export function orderDiscountAmount(order: Order): number {
  if (isCancelledOrder(order)) return 0

  const subtotal = orderSubtotal(order)
  if (!order.discountValue) return 0

  const raw = order.discountType === 'percent'
    ? subtotal * (order.discountValue / 100)
    : order.discountValue

  return Math.min(Math.max(raw, 0), subtotal)
}

export function orderItemsRevenue(order: Order): number {
  if (isCancelledOrder(order)) return 0
  return orderSubtotal(order) - orderDiscountAmount(order)
}

export function accountEntryTotal(session: AccountSessionSnapshot): number {
  if (session.mode !== 'rodizio') return 0
  return entryTotal(session.entryPrice ?? 0, session.headcount ?? 0)
}

export function accountTotals(
  session: AccountSessionSnapshot,
  submittedOrders: Order[],
  cartExtras = 0,
): AccountTotals {
  const submittedExtras = billableOrders(submittedOrders).reduce(
    (sum, order) => sum + orderItemsRevenue(order),
    0,
  )
  const safeCartExtras = Number.isFinite(cartExtras) && cartExtras > 0 ? cartExtras : 0
  const entry = accountEntryTotal(session)
  const extras = submittedExtras + safeCartExtras

  return {
    entry,
    submittedExtras,
    cartExtras: safeCartExtras,
    extras,
    total: entry + extras,
  }
}
