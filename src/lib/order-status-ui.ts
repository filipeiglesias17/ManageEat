// Apresentação dos estados de um pedido (labels e cores) num único sítio.
//
// As labels/cores de estado eram iguais e estavam copiadas na cozinha e no
// admin — se um dia mudasse uma cor, havia que a mudar em dois ficheiros. Aqui
// há uma só fonte de verdade. A *validade* de uma transição continua em
// `canTransition` (@types/order); este módulo só trata do visual.
//
// As labels vêm do dicionário i18n (common.orderStatus/orderStatusNext/
// orderStatusPrev/kanbanColumns) via dict(). Este módulo não é um componente
// React, por isso os campos de texto são GETTERS (`get pending() {...}`) em
// vez de valores fixos: assim, cada leitura (ex.: `statusLabel[order.status]`)
// busca sempre o idioma ATUAL, e não fica preso ao idioma do arranque da app.

import type { OrderStatus } from '../@types/order'
import { dict } from './i18n'

// Etiqueta legível de cada estado (badges no admin e na cozinha).
export const statusLabel: Record<OrderStatus, string> = {
  get pending() { return dict().common.orderStatus.pending },
  get preparing() { return dict().common.orderStatus.preparing },
  get ready() { return dict().common.orderStatus.ready },
  get delivered() { return dict().common.orderStatus.delivered },
  get cancelled() { return dict().common.orderStatus.cancelled },
}

// Cores do badge de estado (fundo suave + texto). Usam os tokens de estado do
// index.css (--info/--warning/--success/--destructive), que já trocam de valor
// com o tema — por isso não é preciso dark: aqui. Nota: "pendente" é sky (info),
// família diferente do azul da marca (blue) — não se confundem.
export const statusColor: Record<OrderStatus, string> = {
  pending:   'bg-info/15 text-info',
  preparing: 'bg-warning/15 text-warning',
  ready:     'bg-success/15 text-success',
  delivered: 'bg-muted text-muted-foreground',
  cancelled: 'bg-destructive/15 text-destructive',
}

// ── Fluxo da cozinha (avançar / recuar um passo) ───────────────────

// Estado seguinte ao carregar em "avançar". 'ready' → 'delivered' fecha o fluxo.
export const nextStatus: Partial<Record<OrderStatus, OrderStatus>> = {
  pending: 'preparing',
  preparing: 'ready',
  ready: 'delivered',
}

export const nextLabel: Partial<Record<OrderStatus, string>> = {
  get pending() { return dict().common.orderStatusNext.pending },
  get preparing() { return dict().common.orderStatusNext.preparing },
  get ready() { return dict().common.orderStatusNext.ready },
}

// Fill sólido (sem gradiente nem glow): cor lisa por estado, legível à distância
// no tablet da cozinha. Tokens de estado com o -foreground respetivo (contraste
// garantido nos 2 temas); o hover só esbate um pouco.
export const nextColor: Partial<Record<OrderStatus, string>> = {
  pending: 'bg-warning hover:bg-warning/90 text-warning-foreground',
  preparing: 'bg-success hover:bg-success/90 text-success-foreground',
  ready: 'bg-secondary hover:bg-secondary/80 text-secondary-foreground',
}

// Reverter um passo. 'pending' não tem anterior (é a raiz do fluxo).
export const prevStatus: Partial<Record<OrderStatus, OrderStatus>> = {
  preparing: 'pending',
  ready: 'preparing',
  delivered: 'ready',
}

export const prevLabel: Partial<Record<OrderStatus, string>> = {
  get preparing() { return dict().common.orderStatusPrev.preparing },
  get ready() { return dict().common.orderStatusPrev.ready },
  get delivered() { return dict().common.orderStatusPrev.delivered },
}

// Colunas do quadro Kanban da cozinha (só os estados ativos).
export const kanbanColumns: { status: OrderStatus; label: string; headerColor: string }[] = [
  {
    status: 'pending',
    get label() { return dict().common.kanbanColumns.pending },
    headerColor: 'border-info text-info',
  },
  {
    status: 'preparing',
    get label() { return dict().common.kanbanColumns.preparing },
    headerColor: 'border-warning text-warning',
  },
  {
    status: 'ready',
    get label() { return dict().common.kanbanColumns.ready },
    headerColor: 'border-success text-success',
  },
]
