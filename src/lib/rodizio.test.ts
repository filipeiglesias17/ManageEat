import { describe, it, expect } from 'vitest'
import { isIncludedInRodizio, entryTotal } from './rodizio'
import { makeMenuItem } from '../test/factories'

describe('isIncludedInRodizio', () => {
  it('inclui (grátis) um item marcado para rodízio quando o modo é rodízio', () => {
    const item = makeMenuItem({ rodizioAvailable: true })
    expect(isIncludedInRodizio(item, 'rodizio')).toBe(true)
  })

  it('não inclui um item sem a marca, mesmo em rodízio', () => {
    const item = makeMenuItem({ rodizioAvailable: false })
    expect(isIncludedInRodizio(item, 'rodizio')).toBe(false)
  })

  it('nunca inclui fora do modo rodízio', () => {
    const item = makeMenuItem({ rodizioAvailable: true })
    expect(isIncludedInRodizio(item, 'normal')).toBe(false)
  })
})

describe('entryTotal', () => {
  it('é preço × pessoas', () => {
    expect(entryTotal(12, 3)).toBe(36)
  })

  it('é 0 sem preço ou sem pessoas', () => {
    expect(entryTotal(0, 3)).toBe(0)
    expect(entryTotal(12, 0)).toBe(0)
  })

  it('é 0 para valores inválidos', () => {
    expect(entryTotal(NaN, 3)).toBe(0)
  })

  // Casos-limite: o trigger payments_validate_insert recalcula este total
  // server-side, por isso a fórmula da UI tem de tratar todos os valores maus
  // exatamente da mesma forma (cair em 0, nunca negativo nem NaN).
  it('é 0 quando o preço de entrada é negativo', () => {
    expect(entryTotal(-15, 2)).toBe(0)
  })

  it('é 0 quando o número de pessoas é negativo', () => {
    expect(entryTotal(15, -2)).toBe(0)
  })

  it('é 0 quando o número de pessoas não é finito (NaN)', () => {
    expect(entryTotal(15, NaN)).toBe(0)
  })

  it('é 0 quando algum valor é Infinity', () => {
    expect(entryTotal(Infinity, 2)).toBe(0)
    expect(entryTotal(15, Infinity)).toBe(0)
  })
})
