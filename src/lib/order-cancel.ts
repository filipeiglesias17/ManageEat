import type { OrderStatus } from '../@types/order'

// Estados que o empregado ainda pode cancelar. 'delivered' já saiu para a mesa,
// por isso não se cancela (a BD aplica a mesma regra no trigger).
export const CANCELLABLE_STATUSES: OrderStatus[] = ['pending', 'preparing', 'ready']

// Motivos rápidos para cancelar sem ter de escrever tudo (o campo continua
// editável para qualquer outro caso).
export const CANCEL_REASON_PRESETS = ['Cliente desistiu', 'Item em falta', 'Engano no pedido', 'Pedido duplicado']
