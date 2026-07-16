import { supabase } from '../supabase'
import type { Order, OrderItem, OrderStatus } from '../../@types/order'
import {
  throwOnError,
  subscribeTable,
  ORDERS_LIMIT,
  EXPORT_PAGE_SIZE,
  localRangeToUtcWindow,
  fetchAllPages,
} from './base'

// Inputs de criação
type CreateOrderInput = Omit<Order, 'id' | 'sessionId'> & { sessionId: string }

export function rowToOrder(r: Record<string, unknown>): Order {
  const order: Order = {
    id: r.id as string,
    requestId: r.request_id as string,
    tableNumber: Number(r.table_number),
    source: r.source as Order['source'],
    items: r.items as OrderItem[],
    status: r.status as OrderStatus,
    createdAt: r.created_at as string,
  }
  if (r.session_id != null) order.sessionId = r.session_id as string
  if (r.discount_type != null) order.discountType = r.discount_type as Order['discountType']
  if (r.discount_value != null) order.discountValue = Number(r.discount_value)
  if (r.entry_price != null) order.entryPrice = Number(r.entry_price)
  if (r.headcount != null) order.headcount = Number(r.headcount)
  if (r.mode != null) order.mode = r.mode as Order['mode']
  if (r.cancelled_at != null) order.cancelledAt = r.cancelled_at as string
  if (r.cancelled_by != null) order.cancelledBy = r.cancelled_by as string
  if (r.cancel_reason != null) order.cancelReason = r.cancel_reason as string
  return order
}

export async function getOrders(): Promise<Order[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(ORDERS_LIMIT)
  throwOnError(error)
  return (data ?? []).map(rowToOrder)
}

// Traz TODOS os pedidos de um intervalo de dias LOCAIS, para os exports não
// ficarem cortados aos 200 das subscrições. fromIso/toIso são YYYY-MM-DD (ou
// strings vazias = "Tudo", sem limites de data). A janela UTC é alargada de
// propósito (±1 dia); o corte fino por dia local é feito por filterByRange.
export async function getOrdersInRange(fromIso: string, toIso: string): Promise<Order[]> {
  const window = localRangeToUtcWindow(fromIso, toIso)

  const rows = await fetchAllPages<Record<string, unknown>>((offset) => {
    let query = supabase
      .from('orders')
      .select('*')
      // Ordenação estável por (created_at, id) → paginação keyset sem saltos
      // nem duplicados em empates de timestamp.
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })

    if (window.gte) query = query.gte('created_at', window.gte)
    if (window.lte) query = query.lte('created_at', window.lte)

    return query.range(offset, offset + EXPORT_PAGE_SIZE - 1)
  })

  return rows.map(rowToOrder)
}

export async function createOrder(data: CreateOrderInput): Promise<Order> {
  const row = {
    id: data.requestId,
    request_id: data.requestId,
    table_number: data.tableNumber,
    source: data.source,
    items: data.items,
    status: data.status,
    created_at: data.createdAt,
    session_id: data.sessionId ?? null,
    discount_type: data.discountType ?? null,
    discount_value: data.discountValue ?? null,
    entry_price: data.entryPrice ?? null,
    headcount: data.headcount ?? null,
    mode: data.mode ?? null,
  }
  const { error } = await supabase.from('orders').upsert(row, { onConflict: 'id', ignoreDuplicates: true })
  throwOnError(error)
  return { id: data.requestId, ...data }
}

export async function updateOrderStatus(id: string, status: OrderStatus): Promise<void> {
  const { error } = await supabase.from('orders').update({ status }).eq('id', id)
  throwOnError(error)
}

export async function cancelOrder(id: string, reason: string, byUid: string): Promise<void> {
  const { error } = await supabase.from('orders').update({
    status: 'cancelled',
    cancelled_at: new Date().toISOString(),
    cancelled_by: byUid,
    cancel_reason: reason.trim(),
  }).eq('id', id)
  throwOnError(error)
}

export async function deleteOrder(id: string): Promise<void> {
  const { error } = await supabase.from('orders').delete().eq('id', id)
  throwOnError(error)
}

export function subscribeOrders(
  callback: (orders: Order[]) => void,
  onError?: (error: Error) => void,
): () => void {
  return subscribeTable('orders', getOrders, callback, { onError })
}

export async function getOrdersBySession(sessionId: string, since?: string): Promise<Order[]> {
  let query = supabase
    .from('orders')
    .select('*')
    .eq('session_id', sessionId)

  if (since) {
    query = query.gte('created_at', since)
  }

  const { data, error } = await query
  throwOnError(error)
  return (data ?? []).map(rowToOrder)
}

export function subscribeOrdersBySession(
  sessionId: string,
  callback: (orders: Order[]) => void,
  onError?: (error: Error) => void,
  since?: string,
): () => void {
  async function fetchSorted(): Promise<Order[]> {
    const orders = await getOrdersBySession(sessionId, since)
    return orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  return subscribeTable('orders', fetchSorted, callback, {
    filter: `session_id=eq.${sessionId}`,
    onError,
  })
}
