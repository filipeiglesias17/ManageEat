// Camada de acesso a dados modularizada (retrocompatibilidade total)
export * from './db/base'
export * from './db/menu'
export * from './db/orders'
export * from './db/sessions'
export * from './db/users'
export * from './db/shifts'
export * from './db/payments'
export * from './db/service-calls'
export * from './db/settings'
export * from './db/releases'
export * from './db/system'

export type QrSession = {
  id: string
  tableNumber: number
  createdAt: string
  expiresAt?: string
  open?: boolean
  openedAt?: string
  accessCodeHash?: string
  hasAccessCode?: boolean
  codeFailedAttempts?: number
  codeLockedUntil?: string
  mode?: 'normal' | 'rodizio'
  entryPrice?: number
  headcount?: number
}
