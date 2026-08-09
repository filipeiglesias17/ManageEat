// Um pedido de atenção feito pelo cliente na mesa: "chamar empregado" ou
// "pedir a conta". Vive na tabela `service_calls`; a BD guarda o ciclo de vida
// para não perdermos histórico operacional.
export type ServiceCallType = 'waiter' | 'bill'
export type ServiceCallStatus = 'open' | 'acknowledged' | 'resolved'

export type ServiceCall = {
  id: string
  tableNumber: number
  // Obrigatório em chamadas novas: identifica a sessão operacional aberta da
  // mesa. A RLS valida a mesa contra esta sessão.
  sessionId?: string
  type: ServiceCallType
  createdAt: string
  status: ServiceCallStatus
  acknowledgedAt?: string
  acknowledgedBy?: string
  resolvedAt?: string
  resolvedBy?: string
}
