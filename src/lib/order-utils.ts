// Defesa contra pedidos com campos forjados.
//
// A RLS não deve confiar nos totais vindos do browser. O fix completo é
// recalcular preços num ponto controlado pelo backend (trigger/RPC em Postgres).
// Enquanto isso, estes helpers garantem que a cozinha, o admin e as estatísticas
// nunca mostram NaN, totais negativos ou "undefined" — mesmo que cheguem dados
// maus.

import type { Order, OrderItem } from '../@types/order'

// Teto defensivo para a quantidade. Um restaurante real nunca pede tanto numa
// linha; serve só para neutralizar valores absurdos (ex: 1e9) que rebentavam a
// escala dos gráficos.
const MAX_QUANTITY = 9999

export function safeQuantity(quantity: number): number {
  if (!Number.isFinite(quantity) || quantity < 0) return 0
  return Math.min(Math.floor(quantity), MAX_QUANTITY)
}

export function safeUnitPrice(price: number): number {
  if (!Number.isFinite(price) || price < 0) return 0
  return price
}

export function safeItemName(name: string): string {
  return name && name.trim() ? name : 'Item desconhecido'
}

// Total de uma linha (preço unitário × quantidade), já com valores sãos.
export function lineTotal(item: OrderItem): number {
  return safeUnitPrice(item.price) * safeQuantity(item.quantity)
}

// Subtotal do pedido antes do desconto global. Centralizado para não repetir o
// reduce em três sítios (admin, stats) e para aplicar a mesma defesa.
export function orderSubtotal(order: Order): number {
  return order.items.reduce((sum, item) => sum + lineTotal(item), 0)
}
