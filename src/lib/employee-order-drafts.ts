import type { CartItem } from '../@types/cart'
import type { DiscountType } from '../@types/order'
import type { QrSession } from './db'

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type EmployeeOrderDiscountDraft = {
  discountType: DiscountType
  discountValue: string
}

const CART_STORAGE_PREFIX = 'manageEat_cart_'
const EMPLOYEE_CART_PREFIX = 'employee_'
const DISCOUNT_STORAGE_PREFIX = 'manageEat_employee_discount_'

// A chave inclui o uid de quem está a trabalhar: num aparelho partilhado, a
// conta 2 não vê (nem envia por engano) o rascunho da conta 1 — mas a conta 1
// reencontra o dela quando voltar a entrar. Sem uid não há rascunho.
export function employeeOrderDraftKey(
  session: Pick<QrSession, 'id' | 'openedAt'> | null | undefined,
  uid: string | null | undefined,
): string | null {
  if (!session?.id || !session.openedAt || !uid) return null
  return `${EMPLOYEE_CART_PREFIX}${uid}_${session.id}_${session.openedAt}`
}

export function employeeOrderCartStorageKey(
  session: Pick<QrSession, 'id' | 'openedAt'> | null | undefined,
  uid: string | null | undefined,
): string | null {
  const draftKey = employeeOrderDraftKey(session, uid)
  if (!draftKey) return null
  return `${CART_STORAGE_PREFIX}${draftKey}`
}

export function employeeOrderDiscountStorageKey(draftKey: string): string {
  return `${DISCOUNT_STORAGE_PREFIX}${draftKey}`
}

function safeCartCount(rawCart: string | null): number {
  if (!rawCart) return 0

  try {
    const parsed = JSON.parse(rawCart) as Partial<CartItem>[]
    if (!Array.isArray(parsed)) return 0

    return parsed.reduce((total, item) => {
      const quantity = Number(item.quantity)
      if (!Number.isFinite(quantity) || quantity <= 0) return total
      return total + Math.floor(quantity)
    }, 0)
  } catch {
    return 0
  }
}

export function employeeOrderDraftCount(session: QrSession, uid: string | null | undefined, storage: DraftStorage): number {
  const storageKey = employeeOrderCartStorageKey(session, uid)
  if (!storageKey) return 0
  return safeCartCount(storage.getItem(storageKey))
}

export function clearEmployeeOrderCartDraft(
  storage: DraftStorage,
  session: Pick<QrSession, 'id' | 'openedAt'> | null | undefined,
  uid: string | null | undefined,
): void {
  const storageKey = employeeOrderCartStorageKey(session, uid)
  if (!storageKey) return
  storage.removeItem(storageKey)
}

export function employeeOrderDraftCountsBySessionId(
  sessions: QrSession[],
  uid: string | null | undefined,
  storage: DraftStorage,
): Record<string, number> {
  return sessions.reduce<Record<string, number>>((counts, session) => {
    const count = employeeOrderDraftCount(session, uid, storage)
    if (count > 0) counts[session.id] = count
    return counts
  }, {})
}

export function readEmployeeOrderDiscountDraft(storage: DraftStorage, draftKey: string | null): EmployeeOrderDiscountDraft {
  if (!draftKey) return { discountType: 'percent', discountValue: '' }

  try {
    const raw = storage.getItem(employeeOrderDiscountStorageKey(draftKey))
    if (!raw) return { discountType: 'percent', discountValue: '' }

    const parsed = JSON.parse(raw) as Partial<EmployeeOrderDiscountDraft>
    const discountType = parsed.discountType === 'euros' ? 'euros' : 'percent'
    const discountValue = typeof parsed.discountValue === 'string' ? parsed.discountValue : ''
    return { discountType, discountValue }
  } catch {
    return { discountType: 'percent', discountValue: '' }
  }
}

export function writeEmployeeOrderDiscountDraft(
  storage: DraftStorage,
  draftKey: string | null,
  draft: EmployeeOrderDiscountDraft,
): void {
  if (!draftKey) return

  const storageKey = employeeOrderDiscountStorageKey(draftKey)
  if (draft.discountType === 'percent' && draft.discountValue === '') {
    storage.removeItem(storageKey)
    return
  }

  storage.setItem(storageKey, JSON.stringify(draft))
}

export function clearEmployeeOrderDiscountDraft(storage: DraftStorage, draftKey: string | null): void {
  if (!draftKey) return
  storage.removeItem(employeeOrderDiscountStorageKey(draftKey))
}
