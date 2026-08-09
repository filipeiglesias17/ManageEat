// Namespace 'kitchen' do dicionário EN  o tipo espelha o PT: uma chave a
// faltar aqui é erro de compilação (paridade garantida pelo gate).

import type { kitchen as pt } from '../pt/kitchen'

export const kitchen: typeof pt = {
  //  Cabeçalho do ecrã
  title: 'Kitchen',
  showAllButton: 'All',
  liveIndicator: 'Live',

  //  Avisos
  connectionLostAlert: 'Connection to the server was lost — the list may not be updating. Reconnecting…',
  dismissAlertLabel: 'Dismiss alert',

  //  Erros de ação (a parte técnica vem de err.message, tal e qual)
  advanceOrderError: (table: number, message: string) =>
    `Could not advance the order for Table ${table}: ${message}`,
  goBackOrderError: (table: number, message: string) =>
    `Could not move back the order for Table ${table}: ${message}`,
  cancelOrderError: (table: number, message: string) =>
    `Could not cancel the order for Table ${table}: ${message}`,
  cancelReasonPrompt: (table: number) =>
    `Reason for cancelling the order for Table ${table}:`,
  cancelReasonRequired: 'Enter a reason to cancel the order.',

  //  Estados vazios
  allEmptyTitle: 'No orders right now',
  allEmptyDescription: 'Orders from tables appear here in real time.',
  kanbanEmptyTitle: 'Kitchen is all caught up',
  kanbanEmptyDescription: 'No active orders. New orders appear here in real time.',

  //  Linha/cartão de pedido
  tableLabel: (n: number) => `Table ${n}`,
  // Origem do pedido: chave = valor guardado na BD (não se traduz o valor,
  // só a apresentação).
  sourceLabel: {
    cliente: 'Customer',
    empregado: 'Staff',
  },
  // Duas variantes porque a vista "Todos" mostra inline (minúscula) e o
  // cartão do kanban mostra em badge (maiúscula).
  removedIngredientsInline: (names: string) => `without: ${names}`,
  removedIngredientsBadge: (names: string) => `Without: ${names}`,
  cancelOrderTitle: 'Cancel order',
  cancelOrderLabel: (table: number) => `Cancel order for table ${table}`,

  //  Estados do pedido (badge da vista "Todos")
  statusLabel: {
    pending: 'Pending',
    preparing: 'Preparing',
    ready: 'Ready',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
  },
  // Títulos das colunas do kanban (só os estados com coluna própria).
  columnLabel: {
    pending: 'Pending',
    preparing: 'Preparing',
    ready: 'Ready',
  },
  // Botão de avançar, por estado ATUAL do pedido.
  nextLabel: {
    pending: 'Start',
    preparing: 'Ready',
    ready: 'Deliver',
  },
  // Botão de recuar um passo, por estado ATUAL do pedido.
  prevLabel: {
    preparing: 'Back to Pending',
    ready: 'Back to Preparing',
    delivered: 'Back to Ready',
  },

  //  Tempo decorrido no cartão
  elapsedNow: 'Now',
  elapsedMinutes: (mins: number) => `${mins} min ago`,
}
