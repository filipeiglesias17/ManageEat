import type { Order } from '../@types/order'
import type { ServiceCall } from '../@types/service-call'
import type { QrSession } from './db'
import type { StaffNotification } from '../@types/notification'

// Um pedido é "atrasado" a partir dos 10 min por preparar  o mesmo limiar que
// o mapa de mesas já usa para pintar a mesa a vermelho (table-map.tsx).
export const LATE_THRESHOLD_MIN = 10

export type DetectInput = {
  orders: Order[]
  calls: ServiceCall[]
  sessions: QrSession[]
  now: Date
  // Conjuntos do passo anterior  o que já vimos, para só alertar o que é novo.
  prevOpenCallIds: Set<string>
  prevReadyOrderIds: Set<string>
  prevLateOrderIds: Set<string>
  // No primeiro cálculo (login), preenchemos os conjuntos mas NÃO alertamos
  // senão o empregado levava com um alerta por cada chamada/pedido que já lá
  // estava. Só eventos que surjam DEPOIS disparam.
  isInitial: boolean
}

export type DetectResult = {
  notifications: StaffNotification[]
  openCallIds: Set<string>
  readyOrderIds: Set<string>
  lateOrderIds: Set<string>
}

function minutesSince(iso: string, now: Date): number {
  const created = Date.parse(iso)
  if (!Number.isFinite(created)) return 0
  return Math.max(0, Math.floor((now.getTime() - created) / 60_000))
}

// Função PURA (sem React)  dado o estado anterior e o atual, devolve os alertas
// novos e os conjuntos atualizados para o próximo passo. Fácil de testar.
export function detectStaffNotifications(input: DetectInput): DetectResult {
  const { orders, calls, sessions, now, isInitial } = input

  const openSessionIds = new Set(sessions.filter((s) => s.open === true).map((s) => s.id))

  //  Chamadas de mesa abertas (chamar empregado / pedir a conta)
  const openCalls = calls.filter((call) => call.status === 'open')
  const openCallIds = new Set(openCalls.map((call) => call.id))

  //  Pedidos prontos para servir, numa sessão ainda aberta
  const readyOrders = orders.filter(
    (order) => order.status === 'ready' && order.sessionId != null && openSessionIds.has(order.sessionId),
  )
  const readyOrderIds = new Set(readyOrders.map((order) => order.id))

  //  Pedidos atrasados (>10 min ainda por preparar), numa sessão aberta
  const lateOrders = orders.filter((order) => {
    if (order.status !== 'pending' && order.status !== 'preparing') return false
    if (order.sessionId == null || !openSessionIds.has(order.sessionId)) return false
    return minutesSince(order.createdAt, now) >= LATE_THRESHOLD_MIN
  })
  const lateOrderIds = new Set(lateOrders.map((order) => order.id))

  const notifications: StaffNotification[] = []
  const raisedAt = now.toISOString()

  if (!isInitial) {
    for (const call of openCalls) {
      if (input.prevOpenCallIds.has(call.id)) continue
      const isBill = call.type === 'bill'
      notifications.push({
        id: `${isBill ? 'bill' : 'waiter'}:${call.id}`,
        kind: isBill ? 'bill_request' : 'waiter_call',
        tableNumber: call.tableNumber,
        sessionId: call.sessionId,
        message: isBill ? 'Pede a conta' : 'Chama o empregado',
        createdAt: raisedAt,
      })
    }

    for (const order of readyOrders) {
      if (input.prevReadyOrderIds.has(order.id)) continue
      notifications.push({
        id: `ready:${order.id}`,
        kind: 'order_ready',
        tableNumber: order.tableNumber,
        sessionId: order.sessionId,
        message: 'Pedido pronto p/ servir',
        createdAt: raisedAt,
      })
    }

    for (const order of lateOrders) {
      if (input.prevLateOrderIds.has(order.id)) continue
      const mins = minutesSince(order.createdAt, now)
      notifications.push({
        id: `late:${order.id}`,
        kind: 'order_late',
        tableNumber: order.tableNumber,
        sessionId: order.sessionId,
        message: `Pedido atrasado (${mins} min)`,
        createdAt: raisedAt,
      })
    }
  }

  return { notifications, openCallIds, readyOrderIds, lateOrderIds }
}
