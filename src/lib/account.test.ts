import { describe, it, expect } from 'vitest'
import {
  isCancelledOrder,
  billableOrders,
  orderDiscountAmount,
  orderItemsRevenue,
  accountEntryTotal,
  currentAccountOrders,
  unfinishedAccountOrders,
  accountTotals,
  tableHistory,
} from './account'
import { makeOrder, makeOrderItem } from '../test/factories'

describe('billableOrders', () => {
  it('exclui os pedidos cancelados', () => {
    const ok = makeOrder()
    const cancelled = makeOrder({ status: 'cancelled' })
    expect(isCancelledOrder(cancelled)).toBe(true)
    expect(billableOrders([ok, cancelled])).toEqual([ok])
  })
})

describe('orderDiscountAmount', () => {
  it('é 0 quando não há desconto', () => {
    expect(orderDiscountAmount(makeOrder())).toBe(0)
  })

  it('aplica desconto em percentagem sobre o subtotal', () => {
    const order = makeOrder({
      items: [makeOrderItem({ price: 50, quantity: 2 })], // subtotal 100
      discountType: 'percent',
      discountValue: 10,
    })
    expect(orderDiscountAmount(order)).toBe(10)
  })

  it('aplica desconto em euros, mas nunca acima do subtotal', () => {
    const order = makeOrder({
      items: [makeOrderItem({ price: 10, quantity: 1 })], // subtotal 10
      discountType: 'euros',
      discountValue: 200,
    })
    expect(orderDiscountAmount(order)).toBe(10)
  })

  it('é 0 num pedido cancelado', () => {
    const order = makeOrder({ status: 'cancelled', discountType: 'percent', discountValue: 50 })
    expect(orderDiscountAmount(order)).toBe(0)
  })

  // Casos-limite do CLAMP a [0, subtotal]. A mesma fórmula vive agora no trigger
  // payments_validate_insert, por isso a UI não pode deixar passar um desconto
  // negativo (somaria à conta) nem acima de 100% (conta negativa).
  it('faz clamp a 0 quando a percentagem é negativa', () => {
    const order = makeOrder({
      items: [makeOrderItem({ price: 50, quantity: 1 })], // subtotal 50
      discountType: 'percent',
      discountValue: -10,
    })
    expect(orderDiscountAmount(order)).toBe(0)
  })

  it('faz clamp a 0 quando o valor em euros é negativo', () => {
    const order = makeOrder({
      items: [makeOrderItem({ price: 50, quantity: 1 })], // subtotal 50
      discountType: 'euros',
      discountValue: -20,
    })
    expect(orderDiscountAmount(order)).toBe(0)
  })

  it('faz clamp ao subtotal quando a percentagem passa de 100%', () => {
    const order = makeOrder({
      items: [makeOrderItem({ price: 50, quantity: 1 })], // subtotal 50
      discountType: 'percent',
      discountValue: 150,
    })
    expect(orderDiscountAmount(order)).toBe(50)
  })
})

describe('orderItemsRevenue', () => {
  it('é o subtotal menos o desconto global', () => {
    const order = makeOrder({
      items: [makeOrderItem({ price: 20, quantity: 1 })],
      discountType: 'euros',
      discountValue: 5,
    })
    expect(orderItemsRevenue(order)).toBe(15)
  })

  it('é 0 num pedido cancelado', () => {
    expect(orderItemsRevenue(makeOrder({ status: 'cancelled' }))).toBe(0)
  })

  // Mesmo com um desconto válido, um pedido cancelado vale 0 (não dá receita
  // negativa nem positiva). Cobre o cruzamento cancelado + desconto.
  it('é 0 num pedido cancelado, mesmo com itens e desconto', () => {
    const order = makeOrder({
      status: 'cancelled',
      items: [makeOrderItem({ price: 100, quantity: 1 })],
      discountType: 'euros',
      discountValue: 10,
    })
    expect(orderItemsRevenue(order)).toBe(0)
  })
})

describe('accountEntryTotal', () => {
  it('é 0 fora do modo rodízio', () => {
    expect(accountEntryTotal({ mode: 'normal', entryPrice: 15, headcount: 2 })).toBe(0)
  })

  it('é preço de entrada × pessoas no rodízio', () => {
    expect(accountEntryTotal({ mode: 'rodizio', entryPrice: 15, headcount: 2 })).toBe(30)
  })

  // Default seguro: sem mode definido cai no comportamento normal (entrada 0).
  it('é 0 quando o mode está ausente', () => {
    expect(accountEntryTotal({ entryPrice: 15, headcount: 2 })).toBe(0)
  })
})

describe('currentAccountOrders', () => {
  it('num QR permanente, ignora pedidos de visitas antigas com o mesmo sessionId', () => {
    const session = {
      id: 'mesa-1',
      tableNumber: 1,
      openedAt: '2026-06-20T12:00:00.000Z',
    }
    const oldOrder = makeOrder({
      sessionId: 'mesa-1',
      tableNumber: 1,
      createdAt: '2026-06-20T11:00:00.000Z',
    })
    const currentQrOrder = makeOrder({
      sessionId: 'mesa-1',
      tableNumber: 1,
      createdAt: '2026-06-20T12:05:00.000Z',
    })
    const currentStaffOrder = makeOrder({
      tableNumber: 1,
      createdAt: '2026-06-20T12:10:00.000Z',
    })

    expect(currentAccountOrders(session, [oldOrder, currentQrOrder, currentStaffOrder]))
      .toEqual([currentQrOrder, currentStaffOrder])
  })

  it('não mistura pedidos de outra mesa nem de outra sessão explícita', () => {
    const session = {
      id: 'mesa-1',
      tableNumber: 1,
      openedAt: '2026-06-20T12:00:00.000Z',
    }
    const otherTable = makeOrder({
      tableNumber: 2,
      createdAt: '2026-06-20T12:05:00.000Z',
    })
    const otherSession = makeOrder({
      sessionId: 'outra-sessao',
      tableNumber: 1,
      createdAt: '2026-06-20T12:05:00.000Z',
    })

    expect(currentAccountOrders(session, [otherTable, otherSession])).toEqual([])
  })

  // Foco no corte por tempo: o pedido feito exatamente no openedAt entra (>=),
  // e o imediatamente anterior fica de fora.
  it('com openedAt, inclui pedidos em ou depois da abertura e exclui os anteriores', () => {
    const session = {
      id: 'mesa-1',
      tableNumber: 1,
      openedAt: '2026-06-20T12:00:00.000Z',
    }
    const before = makeOrder({
      sessionId: 'mesa-1',
      tableNumber: 1,
      createdAt: '2026-06-20T11:59:59.000Z',
    })
    const exactlyAtOpen = makeOrder({
      sessionId: 'mesa-1',
      tableNumber: 1,
      createdAt: '2026-06-20T12:00:00.000Z',
    })
    const after = makeOrder({
      sessionId: 'mesa-1',
      tableNumber: 1,
      createdAt: '2026-06-20T12:00:01.000Z',
    })

    expect(currentAccountOrders(session, [before, exactlyAtOpen, after]))
      .toEqual([exactlyAtOpen, after])
  })

  // Só com tableNumber (sem id nem openedAt) filtra apenas pela mesa física.
  it('filtra só pelo tableNumber quando a sessão não tem id nem openedAt', () => {
    const session = { tableNumber: 1 }
    const sameTable = makeOrder({ tableNumber: 1 })
    const otherTable = makeOrder({ tableNumber: 2 })

    expect(currentAccountOrders(session, [sameTable, otherTable])).toEqual([sameTable])
  })
})

describe('unfinishedAccountOrders', () => {
  it('devolve só pedidos da conta atual que ainda não estão entregues/cancelados', () => {
    const session = { id: 'mesa-1', tableNumber: 1, openedAt: '2026-06-20T12:00:00.000Z' }
    const pending = makeOrder({ sessionId: 'mesa-1', tableNumber: 1, status: 'pending', createdAt: '2026-06-20T12:05:00.000Z' })
    const preparing = makeOrder({ sessionId: 'mesa-1', tableNumber: 1, status: 'preparing', createdAt: '2026-06-20T12:06:00.000Z' })
    const ready = makeOrder({ sessionId: 'mesa-1', tableNumber: 1, status: 'ready', createdAt: '2026-06-20T12:07:00.000Z' })
    const delivered = makeOrder({ sessionId: 'mesa-1', tableNumber: 1, status: 'delivered', createdAt: '2026-06-20T12:08:00.000Z' })
    const cancelled = makeOrder({ sessionId: 'mesa-1', tableNumber: 1, status: 'cancelled', createdAt: '2026-06-20T12:09:00.000Z' })
    const previous = makeOrder({ sessionId: 'mesa-1', tableNumber: 1, status: 'pending', createdAt: '2026-06-20T11:59:00.000Z' })

    expect(unfinishedAccountOrders(session, [pending, preparing, ready, delivered, cancelled, previous]))
      .toEqual([pending, preparing, ready])
  })
})

describe('tableHistory', () => {
  const session = { id: 'mesa-1', tableNumber: 1, openedAt: '2026-06-20T12:00:00.000Z' }

  it('separa a conta atual das contas anteriores no mesmo QR permanente', () => {
    const old = makeOrder({ sessionId: 'mesa-1', tableNumber: 1, createdAt: '2026-06-20T11:00:00.000Z' })
    const current = makeOrder({ sessionId: 'mesa-1', tableNumber: 1, createdAt: '2026-06-20T12:05:00.000Z' })

    const groups = tableHistory(session, [old, current])
    expect(groups.current).toEqual([current])
    expect(groups.previous).toEqual([old])
  })

  it('exclui outra mesa e ordena do mais recente para o mais antigo', () => {
    const other = makeOrder({ tableNumber: 2, createdAt: '2026-06-20T12:30:00.000Z' })
    const older = makeOrder({ tableNumber: 1, createdAt: '2026-06-20T10:00:00.000Z' })
    const newer = makeOrder({ tableNumber: 1, createdAt: '2026-06-20T11:30:00.000Z' })

    const groups = tableHistory(session, [older, other, newer])
    expect(groups.current).toEqual([])
    expect(groups.previous).toEqual([newer, older])
  })

  it('inclui pedidos cancelados (é vista de auditoria, não a conta)', () => {
    const cancelled = makeOrder({ sessionId: 'mesa-1', tableNumber: 1, status: 'cancelled', createdAt: '2026-06-20T12:05:00.000Z' })
    expect(tableHistory(session, [cancelled]).current).toEqual([cancelled])
  })
})

describe('accountTotals', () => {
  it('soma entrada do rodízio, extras submetidos e extras no carrinho', () => {
    const session = { mode: 'rodizio' as const, entryPrice: 15, headcount: 2 } // entrada 30
    const submitted = [makeOrder({ items: [makeOrderItem({ price: 4, quantity: 1 })] })] // extras 4
    const totals = accountTotals(session, submitted, 6) // carrinho 6

    expect(totals.entry).toBe(30)
    expect(totals.submittedExtras).toBe(4)
    expect(totals.cartExtras).toBe(6)
    expect(totals.extras).toBe(10)
    expect(totals.total).toBe(40)
  })

  it('ignora extras de carrinho inválidos (negativos)', () => {
    const totals = accountTotals({ mode: 'normal' }, [], -5)
    expect(totals.cartExtras).toBe(0)
    expect(totals.total).toBe(0)
  })

  // Rodízio: itens incluídos chegam ao pedido com price 0 (gravado assim por
  // isIncludedInRodizio no fluxo de criação). Só os itens com price > 0 (extras
  // não-rodízio, ex: bebidas) somam. Total = entrada + extras.
  it('em rodízio, itens incluídos a price 0 somam 0 e só os extras com preço contam', () => {
    const session = { mode: 'rodizio' as const, entryPrice: 20, headcount: 2 } // entrada 40
    const order = makeOrder({
      items: [
        makeOrderItem({ price: 0, quantity: 3 }), // incluído no rodízio → 0
        makeOrderItem({ price: 5, quantity: 1 }), // bebida (extra) → 5
      ],
    })
    const totals = accountTotals(session, [order], 0)

    expect(totals.entry).toBe(40)
    expect(totals.submittedExtras).toBe(5)
    expect(totals.cartExtras).toBe(0)
    expect(totals.extras).toBe(5)
    expect(totals.total).toBe(45)
  })

  // À la carte (mode normal): não há entrada; o total é só a receita dos pedidos.
  it('à la carte (mode normal), a entrada é 0 e o total é a receita dos pedidos', () => {
    const session = { mode: 'normal' as const }
    const submitted = [
      makeOrder({ items: [makeOrderItem({ price: 10, quantity: 2 })] }), // 20
      makeOrder({ items: [makeOrderItem({ price: 7, quantity: 1 })] }), // 7
    ]
    const totals = accountTotals(session, submitted, 0)

    expect(totals.entry).toBe(0)
    expect(totals.submittedExtras).toBe(27)
    expect(totals.total).toBe(27)
  })

  // Default seguro: sem mode definido comporta-se como à la carte (entrada 0).
  it('sem mode definido, comporta-se como à la carte (entrada 0)', () => {
    const submitted = [makeOrder({ items: [makeOrderItem({ price: 9, quantity: 1 })] })]
    const totals = accountTotals({}, submitted, 0)

    expect(totals.entry).toBe(0)
    expect(totals.total).toBe(9)
  })

  // Pedidos cancelados não entram na conta a pagar.
  it('não conta os pedidos cancelados nos extras submetidos', () => {
    const session = { mode: 'normal' as const }
    const ok = makeOrder({ items: [makeOrderItem({ price: 10, quantity: 1 })] }) // 10
    const cancelled = makeOrder({
      status: 'cancelled',
      items: [makeOrderItem({ price: 100, quantity: 1 })],
    })
    const totals = accountTotals(session, [ok, cancelled], 0)

    expect(totals.submittedExtras).toBe(10)
    expect(totals.total).toBe(10)
  })

  // cartExtras só conta quando finito e > 0: NaN e Infinity caem em 0.
  it('ignora cartExtras não finito (NaN)', () => {
    const totals = accountTotals({ mode: 'normal' }, [], NaN)
    expect(totals.cartExtras).toBe(0)
    expect(totals.total).toBe(0)
  })

  it('ignora cartExtras não finito (Infinity)', () => {
    const totals = accountTotals({ mode: 'normal' }, [], Infinity)
    expect(totals.cartExtras).toBe(0)
    expect(totals.total).toBe(0)
  })

  it('ignora cartExtras igual a 0 (não soma nada)', () => {
    const totals = accountTotals({ mode: 'normal' }, [], 0)
    expect(totals.cartExtras).toBe(0)
    expect(totals.total).toBe(0)
  })
})
