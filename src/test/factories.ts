// Fábricas para os testes. Dão um objeto válido por defeito e deixam-te trocar
// só os campos que interessam ao caso (`makeOrder({ status: 'cancelled' })`).
// Assim cada teste fica curto e só destaca o que está a ser verificado.

import type { MenuItem } from '../@types/menu-item'
import type { CartItem } from '../@types/cart'
import type { Order, OrderItem } from '../@types/order'
import type { Payment } from '../@types/payment'

// Contador para dar ids únicos sem termos de os escrever em cada teste.
let seq = 0
function nextId(prefix: string): string {
  seq += 1
  return `${prefix}-${seq}`
}

export function makeMenuItem(overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    id: nextId('item'),
    name: 'Item',
    description: '',
    price: 10,
    categoryId: 'cat-1',
    available: true,
    discount: null,
    ...overrides,
  }
}

export function makeCartItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    uid: nextId('uid'),
    menuItem: makeMenuItem(),
    quantity: 1,
    notes: '',
    removedIngredients: [],
    ...overrides,
  }
}

export function makeOrderItem(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    menuItemId: nextId('mi'),
    menuItemName: 'Item',
    quantity: 1,
    price: 10,
    ...overrides,
  }
}

export function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: nextId('order'),
    requestId: nextId('req'),
    tableNumber: 1,
    source: 'cliente',
    items: [makeOrderItem()],
    status: 'pending',
    // Meio-dia local: o dia civil é estável em qualquer fuso (não salta a meia-noite).
    createdAt: '2026-06-19T12:00:00',
    ...overrides,
  }
}

export function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: nextId('payment'),
    tableNumber: 1,
    sessionId: nextId('session'),
    amount: 10,
    method: 'dinheiro',
    createdAt: '2026-06-19T12:00:00',
    createdBy: nextId('user'),
    ...overrides,
  }
}
