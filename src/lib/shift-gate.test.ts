import { describe, expect, it } from 'vitest'
import { canOperate, isShiftRequired } from './shift-gate'

// Regra D1 (espelho de operational_shift_ok() na BD): empregado e gerente só
// operam em turno; admin, cozinha e cliente nunca são bloqueados pela UI.
describe('isShiftRequired', () => {
  it('empregado e gerente precisam de turno', () => {
    expect(isShiftRequired('empregado')).toBe(true)
    expect(isShiftRequired('gerente')).toBe(true)
  })

  it('admin e cozinha estão isentos', () => {
    expect(isShiftRequired('admin')).toBe(false)
    expect(isShiftRequired('cozinha')).toBe(false)
  })

  it('cliente e anónimo (sem role) nunca são bloqueados', () => {
    expect(isShiftRequired('cliente')).toBe(false)
    expect(isShiftRequired(null)).toBe(false)
    expect(isShiftRequired(undefined)).toBe(false)
  })
})

describe('canOperate', () => {
  it('empregado/gerente operam só com turno aberto', () => {
    expect(canOperate('empregado', false)).toBe(false)
    expect(canOperate('empregado', true)).toBe(true)
    expect(canOperate('gerente', false)).toBe(false)
    expect(canOperate('gerente', true)).toBe(true)
  })

  it('isentos operam com ou sem turno', () => {
    expect(canOperate('admin', false)).toBe(true)
    expect(canOperate('cozinha', false)).toBe(true)
    expect(canOperate('cliente', false)).toBe(true)
    expect(canOperate(undefined, false)).toBe(true)
  })
})
