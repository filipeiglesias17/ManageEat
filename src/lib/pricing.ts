// Cálculo de preços de um item — lógica pura, sem React nem acesso a dados.
//
// Vivia em `hooks/use-cart.ts`, mas preço não é estado de UI: ao morar aqui é
// mais fácil de encontrar, de reutilizar (menu, carrinho, pedido) e de testar
// isolado. O `use-cart.ts` re-exporta estes helpers, por isso os imports antigos
// (`from '../hooks/use-cart'`) continuam a funcionar.

import type { MenuItem } from '../@types/menu-item'
import type { CartItem } from '../@types/cart'
import type { OrderItem } from '../@types/order'
import type { RestaurantMode } from '../@types/settings'
import { isIncludedInRodizio } from './rodizio'

// Preço de um item do menu já com o desconto definido pelo admin aplicado.
export function effectivePrice(item: MenuItem): number {
  return item.discount ? item.price * (1 - item.discount / 100) : item.price
}

// Preço final de uma linha do carrinho: parte de effectivePrice e aplica
// por cima o desconto ad-hoc do empregado (em percentagem ou em euros).
export function effectiveItemPrice(cartItem: CartItem): number {
  const base = effectivePrice(cartItem.menuItem)
  const d = cartItem.itemDiscount
  if (!d || d.value <= 0) return base
  // Percentagens acima de 100 são tratadas como 100 (preço = 0).
  if (d.type === 'percent') return base * (1 - Math.min(d.value, 100) / 100)
  // Em euros: o preço nunca fica negativo.
  return Math.max(0, base - d.value)
}

// Preço de uma linha tendo em conta o modo do restaurante. No rodízio, um item
// incluído custa 0 (já está pago na entrada); o resto mantém o preço da linha.
export function lineTotalForMode(cartItem: CartItem, mode: RestaurantMode): number {
  if (isIncludedInRodizio(cartItem.menuItem, mode)) return 0
  return effectiveItemPrice(cartItem)
}

type CartItemToOrderItemOptions = {
  includeItemDiscount?: boolean
}

function normalizedItemDiscount(cartItem: CartItem): CartItem['itemDiscount'] {
  const discount = cartItem.itemDiscount
  if (!discount || discount.value <= 0) return undefined

  if (discount.type === 'percent') {
    return { type: 'percent', value: Math.min(discount.value, 100) }
  }

  return { type: 'euros', value: Math.min(discount.value, effectivePrice(cartItem.menuItem)) }
}

// Converte um carrinho inteiro (já validado) em linhas de pedido. É a mesma
// conversão usada pelo cliente, pela sessão QR e pelo empregado — por isso vive
// aqui em vez de cada página repetir o `.map`.
export function buildOrderItems(
  cart: CartItem[],
  mode: RestaurantMode,
  options: CartItemToOrderItemOptions = {},
): OrderItem[] {
  return cart.map((cartItem) => cartItemToOrderItem(cartItem, mode, options))
}

export function cartItemToOrderItem(
  cartItem: CartItem,
  mode: RestaurantMode,
  options: CartItemToOrderItemOptions = {},
): OrderItem {
  const includeItemDiscount = options.includeItemDiscount === true
  const includedInRodizio = isIncludedInRodizio(cartItem.menuItem, mode)
  const itemDiscount = includeItemDiscount && !includedInRodizio
    ? normalizedItemDiscount(cartItem)
    : undefined
  let price: number
  if (includedInRodizio) {
    // No rodízio, item incluído grava preço 0 porque já está pago na entrada.
    price = 0
  } else if (includeItemDiscount) {
    price = effectiveItemPrice(cartItem)
  } else {
    price = effectivePrice(cartItem.menuItem)
  }

  return {
    menuItemId: cartItem.menuItem.id,
    menuItemName: cartItem.menuItem.name,
    quantity: cartItem.quantity,
    price,
    notes: cartItem.notes,
    removedIngredients: cartItem.removedIngredients,
    ...(itemDiscount && {
      itemDiscountType: itemDiscount.type,
      itemDiscountValue: itemDiscount.value,
    }),
    // Snapshot da taxa de IVA do item (só quando definida). Itens sem taxa
    // própria ficam sem o campo e o relatório assume a taxa por defeito do
    // restaurante — assim não temos de passar as settings até aqui.
    ...(cartItem.menuItem.vatRate != null && { vatRate: cartItem.menuItem.vatRate }),
  }
}
