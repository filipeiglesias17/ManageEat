// Notificações operacionais para o empregado. São ALERTAS TRANSITÓRIOS (um
// cartão que aparece e desaparece) — a fonte de verdade persistente continua a
// ser o painel de chamadas e o mapa de mesas. Aqui só descrevemos "algo
// aconteceu agora e vale a pena ires ver".
export type StaffNotificationKind =
  | 'waiter_call' // cliente carregou em "Chamar empregado"
  | 'bill_request' // cliente carregou em "Pedir a conta"
  | 'order_ready' // a cozinha marcou um pedido como pronto para servir
  | 'order_late' // um pedido está há demasiado tempo por preparar

export type StaffNotification = {
  // Estável por origem (`kind:sourceId`) para não duplicar o mesmo alerta e
  // para o poder dispensar quando o evento é resolvido.
  id: string
  kind: StaffNotificationKind
  tableNumber: number
  // A sessão da mesa — usada para saltar para a mesa quando se toca no cartão.
  sessionId?: string
  // Linha de ação já pronta a ler (ex.: "Pedido pronto p/ servir").
  message: string
  // Momento em que o alerta foi levantado (ISO).
  createdAt: string
}
