import { describe, expect, it } from 'vitest'
import type { QrSession } from './db'
import {
  clearEmployeeOrderCartDraft,
  clearEmployeeOrderDiscountDraft,
  employeeOrderCartStorageKey,
  employeeOrderDiscountStorageKey,
  employeeOrderDraftCountsBySessionId,
  employeeOrderDraftKey,
  readEmployeeOrderDiscountDraft,
  writeEmployeeOrderDiscountDraft,
} from './employee-order-drafts'

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

// uid de quem está a trabalhar no aparelho; os rascunhos são por utilizador.
const UID_1 = 'user-1'
const UID_2 = 'user-2'

function makeSession(overrides: Partial<QrSession> = {}): QrSession {
  return {
    id: 'mesa-1',
    tableNumber: 1,
    createdAt: '2026-06-23T10:00:00.000Z',
    open: true,
    openedAt: '2026-06-23T10:05:00.000Z',
    ...overrides,
  }
}

describe('employeeOrderDraftKey', () => {
  it('usa o utilizador + sessão aberta como chave do rascunho', () => {
    const session = makeSession()

    expect(employeeOrderDraftKey(session, UID_1)).toBe('employee_user-1_mesa-1_2026-06-23T10:05:00.000Z')
    expect(employeeOrderCartStorageKey(session, UID_1)).toBe('manageEat_cart_employee_user-1_mesa-1_2026-06-23T10:05:00.000Z')
  })

  it('muda quando um QR permanente reabre com outro openedAt', () => {
    const firstOpen = makeSession({ openedAt: '2026-06-23T10:05:00.000Z' })
    const secondOpen = makeSession({ openedAt: '2026-06-23T12:00:00.000Z' })

    expect(employeeOrderDraftKey(firstOpen, UID_1)).not.toBe(employeeOrderDraftKey(secondOpen, UID_1))
  })

  it('não cria chave para sessão fechada sem openedAt', () => {
    expect(employeeOrderDraftKey(makeSession({ open: false, openedAt: undefined }), UID_1)).toBeNull()
  })

  it('não cria chave sem utilizador (sem login não há rascunho)', () => {
    expect(employeeOrderDraftKey(makeSession(), null)).toBeNull()
    expect(employeeOrderDraftKey(makeSession(), undefined)).toBeNull()
  })
})

describe('rascunhos por utilizador', () => {
  it('a conta 2 não vê o rascunho da conta 1 no mesmo aparelho', () => {
    const storage = new MemoryStorage()
    const session = makeSession()

    storage.setItem(employeeOrderCartStorageKey(session, UID_1)!, JSON.stringify([{ quantity: 2 }]))

    expect(employeeOrderDraftCountsBySessionId([session], UID_2, storage)).toEqual({})
  })

  it('a conta 1 reencontra o rascunho dela depois de a conta 2 usar o aparelho', () => {
    const storage = new MemoryStorage()
    const session = makeSession()

    storage.setItem(employeeOrderCartStorageKey(session, UID_1)!, JSON.stringify([{ quantity: 2 }]))
    // A conta 2 trabalha na mesma mesa e até limpa o rascunho DELA — o da
    // conta 1 não pode ser tocado.
    storage.setItem(employeeOrderCartStorageKey(session, UID_2)!, JSON.stringify([{ quantity: 9 }]))
    clearEmployeeOrderCartDraft(storage, session, UID_2)

    expect(employeeOrderDraftCountsBySessionId([session], UID_1, storage)).toEqual({ 'mesa-1': 2 })
  })
})

describe('employeeOrderDraftCountsBySessionId', () => {
  it('conta os itens guardados por mesa sem misturar rascunhos', () => {
    const storage = new MemoryStorage()
    const table1 = makeSession({ id: 'mesa-1', tableNumber: 1 })
    const table2 = makeSession({ id: 'mesa-2', tableNumber: 2 })

    storage.setItem(employeeOrderCartStorageKey(table1, UID_1)!, JSON.stringify([{ quantity: 2 }, { quantity: 1 }]))
    storage.setItem(employeeOrderCartStorageKey(table2, UID_1)!, JSON.stringify([{ quantity: 4 }]))

    expect(employeeOrderDraftCountsBySessionId([table1, table2], UID_1, storage)).toEqual({
      'mesa-1': 3,
      'mesa-2': 4,
    })
  })

  it('ignora carrinhos antigos quando a mesma sessão tem outro openedAt', () => {
    const storage = new MemoryStorage()
    const oldSession = makeSession({ openedAt: '2026-06-23T10:05:00.000Z' })
    const currentSession = makeSession({ openedAt: '2026-06-23T12:00:00.000Z' })

    storage.setItem(employeeOrderCartStorageKey(oldSession, UID_1)!, JSON.stringify([{ quantity: 2 }]))

    expect(employeeOrderDraftCountsBySessionId([currentSession], UID_1, storage)).toEqual({})
  })

  it('limpa explicitamente o rascunho do carrinho enviado', () => {
    const storage = new MemoryStorage()
    const session = makeSession()
    const storageKey = employeeOrderCartStorageKey(session, UID_1)!

    storage.setItem(storageKey, JSON.stringify([{ quantity: 2 }]))
    clearEmployeeOrderCartDraft(storage, session, UID_1)

    expect(storage.getItem(storageKey)).toBeNull()
    expect(employeeOrderDraftCountsBySessionId([session], UID_1, storage)).toEqual({})
  })
})

describe('employee order discount drafts', () => {
  it('guarda e lê o desconto global por rascunho', () => {
    const storage = new MemoryStorage()
    const draftKey = employeeOrderDraftKey(makeSession(), UID_1)!

    writeEmployeeOrderDiscountDraft(storage, draftKey, { discountType: 'euros', discountValue: '3.50' })

    expect(readEmployeeOrderDiscountDraft(storage, draftKey)).toEqual({
      discountType: 'euros',
      discountValue: '3.50',
    })
  })

  it('limpa o desconto default em vez de o transportar para outra mesa', () => {
    const storage = new MemoryStorage()
    const draftKey = employeeOrderDraftKey(makeSession(), UID_1)!

    writeEmployeeOrderDiscountDraft(storage, draftKey, { discountType: 'euros', discountValue: '5' })
    clearEmployeeOrderDiscountDraft(storage, draftKey)

    expect(storage.getItem(employeeOrderDiscountStorageKey(draftKey))).toBeNull()
    expect(readEmployeeOrderDiscountDraft(storage, draftKey)).toEqual({
      discountType: 'percent',
      discountValue: '',
    })
  })
})
