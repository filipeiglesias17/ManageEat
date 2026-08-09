// Registo de um pagamento, criado quando o empregado fecha a conta de uma mesa.
// Vive na tabela `payments` no Postgres. Serve os relatórios de vendas
// (repartição por meio de pagamento) — não é um recibo fiscal.

export type PaymentMethod = 'dinheiro' | 'cartao' | 'outro'
export type PaymentVoidAction = 'void_only' | 'reopen_session' | 'reopen_and_close'

export const PAYMENT_METHODS: PaymentMethod[] = ['dinheiro', 'cartao', 'outro']

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  dinheiro: 'Dinheiro',
  cartao: 'Cartão',
  outro: 'Outro',
}

export type Payment = {
  id: string
  tableNumber: number
  // Sessão QR que foi fechada (quando aplicável). Útil para cruzar com os pedidos.
  sessionId?: string
  // Turno aberto no momento do pagamento (para somar por turno).
  shiftId?: string
  // Total cobrado, em euros. A UI calcula-o dos pedidos+sessão no fecho, mas a BD
  // revalida-o server-side: o trigger payments_validate_insert recalcula o total a
  // partir de snapshots de confiança (entrada de rodízio + receita dos pedidos da
  // sessão) e rejeita o pagamento se o amount divergir mais de 1 cêntimo.
  amount: number
  method: PaymentMethod
  createdAt: string
  // uid do empregado/admin que fechou a conta.
  createdBy: string
  // Anulação auditável do registo interno de fecho de conta. Não é estorno
  // financeiro real; corrige apenas a caixa/relatórios da app.
  voidedAt?: string
  voidedBy?: string
  voidReason?: string
  // Snapshot da conta fechada. Permite reabrir de forma segura se o registo for
  // anulado logo a seguir, sem misturar visitas antigas do mesmo QR permanente.
  accountOpenedAt?: string
  accountClosedAt?: string
  accountMode?: 'normal' | 'rodizio'
  accountEntryPrice?: number
  accountHeadcount?: number
}
