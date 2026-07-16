import { describe, it, expect } from 'vitest'
import {
  filterByRange,
  summarize,
  vatBreakdown,
  itemStats,
  totalRevenue,
  tableStats,
  totalCovers,
  paymentStats,
  filterPaymentsByRange,
  activePayments,
  ordersWithoutVoidedOnlyPayments,
} from './stats'
import { makeOrder, makeOrderItem, makePayment } from '../test/factories'

describe('filterByRange', () => {
  it('devolve todos os pedidos quando não há limites', () => {
    const orders = [makeOrder(), makeOrder()]
    expect(filterByRange(orders, '', '')).toHaveLength(2)
  })

  it('mantém só os pedidos dentro do intervalo de dias', () => {
    const dentro = makeOrder({ createdAt: '2026-06-10T12:00:00' })
    const fora = makeOrder({ createdAt: '2026-06-01T12:00:00' })
    const result = filterByRange([dentro, fora], '2026-06-05', '2026-06-15')
    expect(result).toEqual([dentro])
  })
})

describe('summarize', () => {
  it('agrega receita, nº de pedidos, itens, desconto e ticket médio (sem cancelados)', () => {
    const orders = [
      makeOrder({ items: [makeOrderItem({ price: 10, quantity: 2 })] }), // receita 20, 2 itens
      makeOrder({
        items: [makeOrderItem({ price: 5, quantity: 1 }), makeOrderItem({ price: 3, quantity: 1 })], // subtotal 8
        discountType: 'percent',
        discountValue: 10, // desconto 0.8 → receita 7.2
      }),
      makeOrder({ status: 'cancelled', items: [makeOrderItem({ price: 100, quantity: 1 })] }), // ignorado
    ]
    const summary = summarize(orders, [])

    expect(summary.orders).toBe(2)
    expect(summary.items).toBe(4)
    expect(summary.revenue).toBeCloseTo(27.2, 5)
    expect(summary.discount).toBeCloseTo(0.8, 5)
    expect(summary.avgTicket).toBeCloseTo(13.6, 5)
  })

  it('a entrada de rodízio na receita vem do PAGAMENTO, não do pedido', () => {
    const orders = [makeOrder({ items: [makeOrderItem({ price: 10, quantity: 1 })] })] // itens: 10
    const payments = [
      makePayment({ accountMode: 'rodizio', accountEntryPrice: 22, accountHeadcount: 2 }), // entrada: 44
    ]
    const summary = summarize(orders, payments)
    expect(summary.revenue).toBeCloseTo(54, 5) // 10 itens + 44 entrada
  })

  it('a entrada cobrada sobrevive quando TODOS os pedidos são cancelados (auditoria gap-0-0)', () => {
    // Cenário do bug: conta de rodízio paga, mas a cozinha cancelou tudo.
    const orders = [makeOrder({ status: 'cancelled', items: [makeOrderItem({ price: 10, quantity: 1 })] })]
    const payments = [
      makePayment({ accountMode: 'rodizio', accountEntryPrice: 22, accountHeadcount: 2 }),
    ]
    const summary = summarize(orders, payments)
    // Antes: 0 (entrada lida do pedido cancelado desaparecia). Agora: 44 do pagamento.
    expect(summary.revenue).toBeCloseTo(44, 5)
  })

  it('um pagamento anulado não conta para a entrada', () => {
    const payments = [
      makePayment({ accountMode: 'rodizio', accountEntryPrice: 22, accountHeadcount: 2, voidedAt: '2026-06-19T13:00:00' }),
    ]
    expect(summarize([], payments).revenue).toBe(0)
  })
})

describe('vatBreakdown', () => {
  it('soma a entrada de rodízio (do pagamento) à taxa por defeito', () => {
    const orders = [makeOrder({ items: [makeOrderItem({ price: 12.3, quantity: 1 })] })] // IVA 23%
    const payments = [makePayment({ accountMode: 'rodizio', accountEntryPrice: 24.6, accountHeadcount: 1 })]
    const lines = vatBreakdown(orders, payments, 23)
    const line23 = lines.find((l) => l.rate === 23)
    // 12.3 (itens) + 24.6 (entrada) = 36.9 brutos à taxa de 23%.
    expect(line23?.gross).toBeCloseTo(36.9, 5)
  })
})

describe('itemStats', () => {
  it('soma quantidade e receita por item e ordena por mais pedido', () => {
    const orders = [
      makeOrder({ items: [makeOrderItem({ menuItemId: 'a', menuItemName: 'A', price: 5, quantity: 1 })] }),
      makeOrder({ items: [makeOrderItem({ menuItemId: 'a', menuItemName: 'A', price: 5, quantity: 2 })] }),
      makeOrder({ items: [makeOrderItem({ menuItemId: 'b', menuItemName: 'B', price: 9, quantity: 1 })] }),
    ]
    const stats = itemStats(orders)

    expect(stats[0]).toMatchObject({ id: 'a', qty: 3, revenue: 15 })
    expect(stats[1]).toMatchObject({ id: 'b', qty: 1, revenue: 9 })
  })
})

describe('totalRevenue', () => {
  it('conta a entrada do rodízio uma única vez por sessão', () => {
    const shared = { sessionId: 's1', mode: 'rodizio' as const }
    const orders = [
      makeOrder({
        ...shared,
        entryPrice: 10,
        headcount: 2,
        items: [makeOrderItem({ price: 5, quantity: 1 })],
      }),
      makeOrder({
        ...shared,
        entryPrice: undefined,
        headcount: undefined,
        items: [makeOrderItem({ price: 5, quantity: 1 })],
      }),
    ]
    // extras: 5 + 5 = 10; entrada contada uma vez: 20 → total 30
    expect(totalRevenue(orders)).toBe(30)
  })

  it('conta entradas de contas diferentes no mesmo QR permanente', () => {
    const orders = [
      makeOrder({
        sessionId: 'qr-permanente',
        mode: 'rodizio',
        entryPrice: 20,
        headcount: 2,
        createdAt: '2026-06-19T12:00:00',
        items: [makeOrderItem({ price: 0, quantity: 1 })],
      }),
      makeOrder({
        sessionId: 'qr-permanente',
        mode: 'rodizio',
        entryPrice: 20,
        headcount: 3,
        createdAt: '2026-06-19T14:00:00',
        items: [makeOrderItem({ price: 0, quantity: 1 })],
      }),
    ]

    expect(totalRevenue(orders)).toBe(100)
    expect(totalCovers(orders)).toBe(5)
    expect(tableStats(orders)[0]).toMatchObject({ tableNumber: 1, covers: 5, revenue: 100 })
  })
})

describe('pagamentos anulados', () => {
  it('não entram na repartição por método nem no filtro de pagamentos ativos', () => {
    const active = makePayment({ amount: 20, method: 'cartao' })
    const voided = makePayment({ amount: 99, method: 'cartao', voidedAt: '2026-06-19T13:00:00', voidedBy: 'admin', voidReason: 'Erro' })

    expect(filterPaymentsByRange([active, voided], '', '')).toEqual([active, voided])
    expect(activePayments([active, voided])).toEqual([active])
    expect(paymentStats([active, voided]).find((p) => p.method === 'cartao'))
      .toMatchObject({ count: 1, amount: 20 })
  })

  it('remove pedidos de uma sessão que só tem pagamento anulado', () => {
    const voidedOnly = makeOrder({ sessionId: 'sess-void' })
    const refetched = makeOrder({ sessionId: 'sess-refeito' })
    const noPaymentYet = makeOrder({ sessionId: 'sess-open' })
    const payments = [
      makePayment({ sessionId: 'sess-void', voidedAt: '2026-06-19T13:00:00', voidedBy: 'admin', voidReason: 'Erro' }),
      makePayment({ sessionId: 'sess-refeito', voidedAt: '2026-06-19T13:00:00', voidedBy: 'admin', voidReason: 'Erro' }),
      makePayment({ sessionId: 'sess-refeito' }),
    ]

    expect(ordersWithoutVoidedOnlyPayments([voidedOnly, refetched, noPaymentYet], payments))
      .toEqual([refetched, noPaymentYet])
  })

  it('não mistura pagamentos de contas diferentes no mesmo QR permanente', () => {
    const oldAccount = makeOrder({
      id: 'old-order',
      sessionId: 'qr-permanente',
      createdAt: '2026-06-19T12:10:00',
    })
    const newAccount = makeOrder({
      id: 'new-order',
      sessionId: 'qr-permanente',
      createdAt: '2026-06-19T14:10:00',
    })
    const payments = [
      makePayment({
        sessionId: 'qr-permanente',
        createdAt: '2026-06-19T12:30:00',
        voidedAt: '2026-06-19T12:40:00',
        voidedBy: 'admin',
        voidReason: 'Erro',
        accountOpenedAt: '2026-06-19T12:00:00',
        accountClosedAt: '2026-06-19T12:20:00',
      }),
      makePayment({
        sessionId: 'qr-permanente',
        createdAt: '2026-06-19T14:30:00',
        accountOpenedAt: '2026-06-19T14:00:00',
        accountClosedAt: '2026-06-19T14:20:00',
      }),
    ]

    expect(ordersWithoutVoidedOnlyPayments([oldAccount, newAccount], payments))
      .toEqual([newAccount])
  })
})
