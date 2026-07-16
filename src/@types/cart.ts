import type { MenuItem } from './menu-item'
import type { DiscountType } from './order'

export type ItemDiscount = { type: DiscountType; value: number }

export type CartItem = {
  // uid é só para distinguir linhas em runtime — permite ter duas linhas do
  // mesmo MenuItem com personalizações diferentes (ex: um com cebola, outro sem).
  // Não vai à base de dados.
  uid: string
  menuItem: MenuItem
  quantity: number
  notes: string
  removedIngredients: string[]
  itemDiscount?: ItemDiscount
}
