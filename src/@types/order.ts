export type OrderStatus = 'pending' | 'preparing' | 'ready' | 'delivered' | 'cancelled'

export type OrderItem = {
  menuItemId: string
  menuItemName: string
  quantity: number
  price: number
  notes?: string
  removedIngredients?: string[]
  itemDiscountType?: DiscountType
  itemDiscountValue?: number
  // Snapshot da taxa de IVA (%) no momento do pedido — tal como o price, fica
  // congelado para os relatórios serem recalculáveis mesmo que o menu mude
  // depois. Ausente em pedidos antigos: o relatório assume a taxa por defeito.
  vatRate?: number
}

export type DiscountType = 'percent' | 'euros'

export type Order = {
  id: string
  // requestId é também o ID da linha no Postgres — garante idempotência:
  // o mesmo pedido enviado 2x não cria 2 linhas. Ver createOrder em db.ts.
  requestId: string
  tableNumber: number
  source: 'cliente' | 'empregado'
  // Obrigatório em pedidos novos: identifica a sessão operacional aberta da
  // mesa. A RLS valida a mesa contra esta sessão.
  sessionId?: string
  items: OrderItem[]
  status: OrderStatus
  createdAt: string
  discountType?: DiscountType
  discountValue?: number
  entryPrice?: number
  headcount?: number
  mode?: 'normal' | 'rodizio'
  cancelledAt?: string
  cancelledBy?: string
  cancelReason?: string
}

// Fluxo de estados de um pedido. Só se pode avançar ou recuar UM passo — é
// exatamente o que a cozinha permite (botões "avançar" e "voltar atrás").
// Bloqueia saltos arbitrários (ex: pending → delivered), tanto no cliente como
// na trigger de RLS, que replica esta lógica.
const ORDER_FLOW: OrderStatus[] = ['pending', 'preparing', 'ready', 'delivered']

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  const i = ORDER_FLOW.indexOf(from)
  const j = ORDER_FLOW.indexOf(to)
  if (i === -1 || j === -1) return false
  return Math.abs(i - j) === 1
}
