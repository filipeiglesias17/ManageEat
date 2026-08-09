import { describe, it, expect } from 'vitest'
import { safeQuantity, safeUnitPrice, safeItemName, lineTotal, orderSubtotal } from './order-utils'
import { makeOrder, makeOrderItem } from '../test/factories'

describe('safeQuantity', () => {
  it('mantém uma quantidade normal, mas trunca decimais', () => {
    expect(safeQuantity(3)).toBe(3)
    expect(safeQuantity(5.7)).toBe(5)
  })

  it('neutraliza valores inválidos (NaN, negativos, infinito) para 0', () => {
    expect(safeQuantity(NaN)).toBe(0)
    expect(safeQuantity(-2)).toBe(0)
    expect(safeQuantity(Infinity)).toBe(0)
  })

  it('limita valores absurdos ao teto defensivo (9999)', () => {
    expect(safeQuantity(1e9)).toBe(9999)
  })
})

describe('safeUnitPrice', () => {
  it('mantém um preço válido', () => {
    expect(safeUnitPrice(12.5)).toBe(12.5)
    expect(safeUnitPrice(0)).toBe(0)
  })

  it('neutraliza preços inválidos ou negativos para 0', () => {
    expect(safeUnitPrice(-1)).toBe(0)
    expect(safeUnitPrice(NaN)).toBe(0)
  })
})

describe('safeItemName', () => {
  it('mantém um nome real', () => {
    expect(safeItemName('Bife')).toBe('Bife')
  })

  it('usa um nome de recurso quando vem vazio ou só espaços', () => {
    expect(safeItemName('')).toBe('Item desconhecido')
    expect(safeItemName('   ')).toBe('Item desconhecido')
  })
})

describe('lineTotal', () => {
  it('multiplica preço unitário pela quantidade', () => {
    expect(lineTotal(makeOrderItem({ price: 10, quantity: 3 }))).toBe(30)
  })

  it('usa as defesas: preço negativo conta como 0', () => {
    expect(lineTotal(makeOrderItem({ price: -5, quantity: 2 }))).toBe(0)
  })
})

describe('orderSubtotal', () => {
  it('soma todas as linhas do pedido', () => {
    const order = makeOrder({
      items: [
        makeOrderItem({ price: 10, quantity: 2 }),
        makeOrderItem({ price: 5, quantity: 1 }),
      ],
    })
    expect(orderSubtotal(order)).toBe(25)
  })
})
