import { describe, it, expect } from 'vitest'
import { detectStaffNotifications, LATE_THRESHOLD_MIN, type DetectInput } from './notifications-detect'
import type { Order, OrderStatus } from '../@types/order'
import type { ServiceCall, ServiceCallType } from '../@types/service-call'
import type { QrSession } from './db'

const NOW = new Date('2026-07-01T12:00:00.000Z')

function session(id: string, tableNumber: number, open = true): QrSession {
  return { id, tableNumber, createdAt: '2026-07-01T10:00:00.000Z', open }
}

function call(id: string, type: ServiceCallType, tableNumber: number): ServiceCall {
  return { id, tableNumber, sessionId: `s${tableNumber}`, type, status: 'open', createdAt: NOW.toISOString() }
}

function order(id: string, status: OrderStatus, tableNumber: number, minsAgo = 0): Order {
  return {
    id,
    requestId: id,
    tableNumber,
    source: 'cliente',
    sessionId: `s${tableNumber}`,
    items: [],
    status,
    createdAt: new Date(NOW.getTime() - minsAgo * 60_000).toISOString(),
  }
}

function emptyInput(over: Partial<DetectInput>): DetectInput {
  return {
    orders: [],
    calls: [],
    sessions: [],
    now: NOW,
    prevOpenCallIds: new Set(),
    prevReadyOrderIds: new Set(),
    prevLateOrderIds: new Set(),
    isInitial: false,
    ...over,
  }
}

describe('detectStaffNotifications', () => {
  it('não alerta no primeiro cálculo (login) — só preenche os conjuntos', () => {
    const result = detectStaffNotifications(
      emptyInput({
        isInitial: true,
        sessions: [session('s4', 4)],
        calls: [call('c1', 'waiter', 4)],
        orders: [order('o1', 'ready', 4)],
      }),
    )
    expect(result.notifications).toHaveLength(0)
    expect(result.openCallIds.has('c1')).toBe(true)
    expect(result.readyOrderIds.has('o1')).toBe(true)
  })

  it('alerta uma nova chamada de empregado e uma de conta, separadas por tipo', () => {
    const result = detectStaffNotifications(
      emptyInput({
        sessions: [session('s4', 4), session('s7', 7)],
        calls: [call('c1', 'waiter', 4), call('c2', 'bill', 7)],
      }),
    )
    expect(result.notifications.map((n) => n.kind)).toEqual(['waiter_call', 'bill_request'])
    expect(result.notifications[0]).toMatchObject({ tableNumber: 4, message: 'Chama o empregado' })
    expect(result.notifications[1]).toMatchObject({ tableNumber: 7, message: 'Pede a conta' })
  })

  it('não re-alerta uma chamada que já tínhamos visto', () => {
    const result = detectStaffNotifications(
      emptyInput({
        sessions: [session('s4', 4)],
        calls: [call('c1', 'waiter', 4)],
        prevOpenCallIds: new Set(['c1']),
      }),
    )
    expect(result.notifications).toHaveLength(0)
  })

  it('alerta um pedido que passou a "ready" numa sessão aberta', () => {
    const result = detectStaffNotifications(
      emptyInput({
        sessions: [session('s2', 2)],
        orders: [order('o1', 'ready', 2)],
      }),
    )
    expect(result.notifications).toHaveLength(1)
    expect(result.notifications[0]).toMatchObject({ kind: 'order_ready', tableNumber: 2 })
  })

  it('não alerta um pedido "ready" de uma sessão já fechada', () => {
    const result = detectStaffNotifications(
      emptyInput({
        sessions: [session('s2', 2, false)],
        orders: [order('o1', 'ready', 2)],
      }),
    )
    expect(result.notifications).toHaveLength(0)
  })

  it('alerta um pedido atrasado ao cruzar o limiar, e só uma vez', () => {
    const first = detectStaffNotifications(
      emptyInput({
        sessions: [session('s5', 5)],
        orders: [order('o9', 'preparing', 5, LATE_THRESHOLD_MIN + 2)],
      }),
    )
    expect(first.notifications).toHaveLength(1)
    expect(first.notifications[0]).toMatchObject({ kind: 'order_late', tableNumber: 5 })
    expect(first.notifications[0].message).toContain('min')

    // Segundo passo com o mesmo pedido já conhecido → sem novo alerta.
    const second = detectStaffNotifications(
      emptyInput({
        sessions: [session('s5', 5)],
        orders: [order('o9', 'preparing', 5, LATE_THRESHOLD_MIN + 3)],
        prevLateOrderIds: first.lateOrderIds,
      }),
    )
    expect(second.notifications).toHaveLength(0)
  })

  it('não considera atrasado um pedido ainda dentro do tempo', () => {
    const result = detectStaffNotifications(
      emptyInput({
        sessions: [session('s5', 5)],
        orders: [order('o9', 'pending', 5, LATE_THRESHOLD_MIN - 1)],
      }),
    )
    expect(result.notifications).toHaveLength(0)
    expect(result.lateOrderIds.size).toBe(0)
  })
})
