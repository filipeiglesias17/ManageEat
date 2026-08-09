import { describe, it, expect } from 'vitest'
import { toggleConfirmingId, clearConfirmingId } from './confirm-state'

describe('toggleConfirmingId', () => {
  it('entra em confirmação quando nada estava a confirmar', () => {
    expect(toggleConfirmingId(null, 'linha-1')).toBe('linha-1')
  })

  it('cancela ao clicar de novo na mesma linha', () => {
    expect(toggleConfirmingId('linha-1', 'linha-1')).toBeNull()
  })

  it('troca para a nova linha em vez de acumular confirmações', () => {
    // Cenário do bug a evitar: clicar em "apagar" na linha 2 enquanto a
    // linha 1 estava a confirmar não pode deixar as duas em confirmação.
    expect(toggleConfirmingId('linha-1', 'linha-2')).toBe('linha-2')
  })
})

describe('clearConfirmingId', () => {
  it('limpa quando o id corresponde ao que estava a confirmar', () => {
    expect(clearConfirmingId('linha-1', 'linha-1')).toBeNull()
  })

  it('não mexe no estado se entretanto outra linha passou a confirmar', () => {
    // Evita que uma resposta tardia da linha 1 apague a confirmação da linha 2.
    expect(clearConfirmingId('linha-2', 'linha-1')).toBe('linha-2')
  })

  it('não faz nada se já não havia ninguém a confirmar', () => {
    expect(clearConfirmingId(null, 'linha-1')).toBeNull()
  })
})
