// Namespace 'kitchen' do dicionário PT: ecrã da cozinha (kanban + vista "Todos")
// e o cartão de pedido. Interpolações = funções.
//
// statusLabel/nextLabel/prevLabel/columnLabel espelham os estados de
// `order-status-ui.ts` — esse ficheiro é partilhado com o admin e continua a
// ser a fonte das CORES e do fluxo (nextStatus/prevStatus); as labels visíveis
// da cozinha vivem aqui para poderem trocar de idioma.

import type { OrderStatus } from '../../../@types/order'

export const kitchen = {
  // ── Cabeçalho do ecrã ──
  title: 'Cozinha',
  showAllButton: 'Todos',
  liveIndicator: 'Em direto',

  // ── Avisos ──
  connectionLostAlert: 'Ligação ao servidor perdida — a lista pode não estar a atualizar. A tentar reconectar…',
  dismissAlertLabel: 'Fechar aviso',

  // ── Erros de ação (a parte técnica vem de err.message, tal e qual) ──
  advanceOrderError: (table: number, message: string) =>
    `Não foi possível avançar o pedido da Mesa ${table}: ${message}`,
  goBackOrderError: (table: number, message: string) =>
    `Não foi possível recuar o pedido da Mesa ${table}: ${message}`,
  cancelOrderError: (table: number, message: string) =>
    `Não foi possível cancelar o pedido da Mesa ${table}: ${message}`,
  cancelReasonPrompt: (table: number) =>
    `Motivo para cancelar o pedido da Mesa ${table}:`,
  cancelReasonRequired: 'Indica um motivo para cancelar o pedido.',

  // ── Estados vazios ──
  allEmptyTitle: 'Sem pedidos por agora',
  allEmptyDescription: 'Os pedidos das mesas aparecem aqui em tempo real.',
  kanbanEmptyTitle: 'Cozinha em dia',
  kanbanEmptyDescription: 'Sem pedidos ativos. Os novos pedidos aparecem aqui em tempo real.',

  // ── Linha/cartão de pedido ──
  tableLabel: (n: number) => `Mesa ${n}`,
  // Origem do pedido: chave = valor guardado na BD (não se traduz o valor,
  // só a apresentação).
  sourceLabel: {
    cliente: 'Cliente',
    empregado: 'Empregado',
  },
  // Duas variantes porque a vista "Todos" mostra inline (minúscula) e o
  // cartão do kanban mostra em badge (maiúscula).
  removedIngredientsInline: (names: string) => `sem: ${names}`,
  removedIngredientsBadge: (names: string) => `Sem: ${names}`,
  cancelOrderTitle: 'Cancelar pedido',
  cancelOrderLabel: (table: number) => `Cancelar pedido da mesa ${table}`,

  // ── Estados do pedido (badge da vista "Todos") ──
  // Tipado com Record<OrderStatus, ...> / Partial<...> para o TS deixar indexar
  // por `order.status` diretamente (sem isto, indexar por um union mais largo
  // do que as chaves do objeto é erro de compilação).
  statusLabel: {
    pending: 'Pendente',
    preparing: 'Em Preparação',
    ready: 'Pronto',
    delivered: 'Entregue',
    cancelled: 'Cancelado',
  } as Record<OrderStatus, string>,
  // Títulos das colunas do kanban (só os estados com coluna própria).
  columnLabel: {
    pending: 'Pendentes',
    preparing: 'Em Preparação',
    ready: 'Prontos',
  } as Partial<Record<OrderStatus, string>>,
  // Botão de avançar, por estado ATUAL do pedido.
  nextLabel: {
    pending: 'Iniciar',
    preparing: 'Pronto',
    ready: 'Entregar',
  } as Partial<Record<OrderStatus, string>>,
  // Botão de recuar um passo, por estado ATUAL do pedido.
  prevLabel: {
    preparing: 'Voltar a Pendente',
    ready: 'Voltar a Preparação',
    delivered: 'Voltar a Pronto',
  } as Partial<Record<OrderStatus, string>>,

  // ── Tempo decorrido no cartão ──
  elapsedNow: 'Agora',
  elapsedMinutes: (mins: number) => `Há ${mins} min`,
}
