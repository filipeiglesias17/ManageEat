export interface Shift {
  id: string
  openedAt: string
  closedAt?: string
  openedBy: string // uid
  closedBy?: string // uid
  status: 'open' | 'closed'
  // true = fecho automático por turno esquecido (saída não picada); a hora de
  // saída foi calculada pela BD (entrada + limite das definições).
  autoClosed?: boolean
}
