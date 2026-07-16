// Testa só os helpers PUROS de preço/validação do use-cart (não o hook React).
import { describe, it, expect } from 'vitest'
import {
  effectivePrice,
  effectiveItemPrice,
  lineTotalForMode,
  cartItemToOrderItem,
  buildOrderItems,
  validateCartAgainstMenu,
} from './use-cart'
import { makeMenuItem, makeCartItem } from '../test/factories'

describe('effectivePrice', () => {
  it('devolve o preço sem desconto do menu', () => {
    expect(effectivePrice(makeMenuItem({ price: 10, discount: null }))).toBe(10)
  })

  it('aplica o desconto (%) definido no menu', () => {
    expect(effectivePrice(makeMenuItem({ price: 10, discount: 20 }))).toBe(8)
  })
})

describe('effectiveItemPrice', () => {
  it('sem desconto de linha, é igual ao preço do menu', () => {
    const cartItem = makeCartItem({ menuItem: makeMenuItem({ price: 10 }) })
    expect(effectiveItemPrice(cartItem)).toBe(10)
  })

  it('aplica desconto de linha em percentagem', () => {
    const cartItem = makeCartItem({
      menuItem: makeMenuItem({ price: 10 }),
      itemDiscount: { type: 'percent', value: 50 },
    })
    expect(effectiveItemPrice(cartItem)).toBe(5)
  })

  it('trata percentagens acima de 100 como 100 (preço 0)', () => {
    const cartItem = makeCartItem({
      menuItem: makeMenuItem({ price: 10 }),
      itemDiscount: { type: 'percent', value: 150 },
    })
    expect(effectiveItemPrice(cartItem)).toBe(0)
  })

  it('em euros nunca fica negativo', () => {
    const cartItem = makeCartItem({
      menuItem: makeMenuItem({ price: 10 }),
      itemDiscount: { type: 'euros', value: 25 },
    })
    expect(effectiveItemPrice(cartItem)).toBe(0)
  })
})

describe('lineTotalForMode', () => {
  it('um item incluído no rodízio custa 0', () => {
    const cartItem = makeCartItem({ menuItem: makeMenuItem({ price: 10, rodizioAvailable: true }) })
    expect(lineTotalForMode(cartItem, 'rodizio')).toBe(0)
  })

  it('um item não incluído mantém o preço de linha', () => {
    const cartItem = makeCartItem({ menuItem: makeMenuItem({ price: 10 }) })
    expect(lineTotalForMode(cartItem, 'rodizio')).toBe(10)
  })
})

describe('cartItemToOrderItem', () => {
  it('grava preço 0 para um item incluído no rodízio', () => {
    const cartItem = makeCartItem({ menuItem: makeMenuItem({ price: 10, rodizioAvailable: true }) })
    expect(cartItemToOrderItem(cartItem, 'rodizio').price).toBe(0)
  })

  it('ignora desconto de linha antigo num item incluído no rodízio', () => {
    const cartItem = makeCartItem({
      menuItem: makeMenuItem({ price: 10, rodizioAvailable: true }),
      itemDiscount: { type: 'percent', value: 50 },
    })

    const orderItem = cartItemToOrderItem(cartItem, 'rodizio', { includeItemDiscount: true })

    expect(orderItem.price).toBe(0)
    expect(orderItem.itemDiscountType).toBeUndefined()
    expect(orderItem.itemDiscountValue).toBeUndefined()
  })

  it('por defeito usa só o preço do menu (ignora desconto de linha do empregado)', () => {
    const cartItem = makeCartItem({
      menuItem: makeMenuItem({ price: 10 }),
      itemDiscount: { type: 'percent', value: 50 },
    })
    const orderItem = cartItemToOrderItem(cartItem, 'normal')
    expect(orderItem.price).toBe(10)
    expect(orderItem.itemDiscountValue).toBeUndefined()
  })

  it('com includeItemDiscount aplica o desconto de linha e grava-o no pedido', () => {
    const cartItem = makeCartItem({
      menuItem: makeMenuItem({ price: 10 }),
      itemDiscount: { type: 'percent', value: 50 },
    })
    const orderItem = cartItemToOrderItem(cartItem, 'normal', { includeItemDiscount: true })
    expect(orderItem.price).toBe(5)
    expect(orderItem.itemDiscountType).toBe('percent')
    expect(orderItem.itemDiscountValue).toBe(50)
  })

  it('limita o desconto de linha em euros ao preço unitário no snapshot', () => {
    const cartItem = makeCartItem({
      menuItem: makeMenuItem({ price: 10 }),
      itemDiscount: { type: 'euros', value: 25 },
    })

    const orderItem = cartItemToOrderItem(cartItem, 'normal', { includeItemDiscount: true })

    expect(orderItem.price).toBe(0)
    expect(orderItem.itemDiscountType).toBe('euros')
    expect(orderItem.itemDiscountValue).toBe(10)
  })

  it('limita o desconto de linha em percentagem a 100 no snapshot', () => {
    const cartItem = makeCartItem({
      menuItem: makeMenuItem({ price: 10 }),
      itemDiscount: { type: 'percent', value: 150 },
    })

    const orderItem = cartItemToOrderItem(cartItem, 'normal', { includeItemDiscount: true })

    expect(orderItem.price).toBe(0)
    expect(orderItem.itemDiscountType).toBe('percent')
    expect(orderItem.itemDiscountValue).toBe(100)
  })

  it('copia o snapshot do IVA do item quando definido', () => {
    const cartItem = makeCartItem({ menuItem: makeMenuItem({ price: 10, vatRate: 23 }) })
    expect(cartItemToOrderItem(cartItem, 'normal').vatRate).toBe(23)
  })
})

describe('buildOrderItems', () => {
  it('converte cada linha do carrinho numa linha de pedido', () => {
    const cart = [
      makeCartItem({ menuItem: makeMenuItem({ name: 'A', price: 10 }) }),
      makeCartItem({ menuItem: makeMenuItem({ name: 'B', price: 5 }) }),
    ]
    const items = buildOrderItems(cart, 'normal')
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ menuItemName: 'A', price: 10 })
    expect(items[1]).toMatchObject({ menuItemName: 'B', price: 5 })
  })

  it('passa as opções (ex: incluir desconto de linha) a cada item', () => {
    const cart = [makeCartItem({
      menuItem: makeMenuItem({ price: 10 }),
      itemDiscount: { type: 'percent', value: 50 },
    })]
    expect(buildOrderItems(cart, 'normal', { includeItemDiscount: true })[0].price).toBe(5)
  })
})

describe('validateCartAgainstMenu', () => {
  it('aceita o carrinho quando nada mudou e adota a versão mais recente do menu', () => {
    const item = makeMenuItem({ price: 10 })
    const cart = [makeCartItem({ menuItem: item })]
    const result = validateCartAgainstMenu(cart, [item], 'normal')
    expect(result.ok).toBe(true)
    expect(result.cart).toHaveLength(1)
  })

  it('remove do carrinho um item que já não existe no menu', () => {
    const cart = [makeCartItem({ menuItem: makeMenuItem() })]
    const result = validateCartAgainstMenu(cart, [], 'normal')
    expect(result.ok).toBe(false)
    expect(result.cart).toHaveLength(0)
    expect(result.message).toContain('já não existe')
  })

  it('sinaliza (mas mantém) um item que mudou de preço', () => {
    const original = makeMenuItem({ id: 'x', price: 10 })
    const updated = makeMenuItem({ id: 'x', price: 12 })
    const result = validateCartAgainstMenu([makeCartItem({ menuItem: original })], [updated], 'normal')
    expect(result.ok).toBe(false)
    expect(result.cart).toHaveLength(1)
    expect(result.message).toContain('preço')
  })

  it('exclui um item que ficou indisponível', () => {
    const original = makeMenuItem({ id: 'y', available: true })
    const updated = makeMenuItem({ id: 'y', available: false })
    const result = validateCartAgainstMenu([makeCartItem({ menuItem: original })], [updated], 'normal')
    expect(result.ok).toBe(false)
    expect(result.cart).toHaveLength(0)
    expect(result.message).toContain('indisponível')
  })
})
