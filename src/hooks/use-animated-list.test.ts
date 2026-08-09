import { describe, it, expect } from 'vitest'
import { mergeAnimatedEntries, type AnimatedEntry } from './use-animated-list'

// Testa a função PURA do hook (a parte com lógica). Os timers do hook em si são
// só agendamento por cima disto.

type Row = { id: string; name: string }

const keyOf = (row: Row) => row.id

function entriesOf(rows: Row[]): AnimatedEntry<Row>[] {
  return rows.map((row) => ({ item: row, key: row.id, leaving: false }))
}

describe('mergeAnimatedEntries', () => {
  it('mantém um item removido na posição antiga, marcado como leaving', () => {
    const previous = entriesOf([
      { id: 'a', name: 'Sushi' },
      { id: 'b', name: 'Ramen' },
      { id: 'c', name: 'Gyoza' },
    ])
    // O 'b' desapareceu da lista nova (ex.: pedido entregue).
    const { entries, newlyLeaving } = mergeAnimatedEntries(
      previous,
      [{ id: 'a', name: 'Sushi' }, { id: 'c', name: 'Gyoza' }],
      keyOf,
    )

    expect(entries.map((e) => e.key)).toEqual(['a', 'b', 'c'])
    expect(entries[1].leaving).toBe(true)
    expect(newlyLeaving).toEqual(['b'])
  })

  it('um item que reaparece durante a saída volta a leaving=false', () => {
    const previous: AnimatedEntry<Row>[] = [
      { item: { id: 'a', name: 'Sushi' }, key: 'a', leaving: false },
      { item: { id: 'b', name: 'Ramen' }, key: 'b', leaving: true },
    ]
    // Flap do realtime: o 'b' voltou à lista antes de a saída terminar.
    const { entries, newlyLeaving, reappeared } = mergeAnimatedEntries(
      previous,
      [{ id: 'a', name: 'Sushi' }, { id: 'b', name: 'Ramen' }],
      keyOf,
    )

    expect(entries.map((e) => e.key)).toEqual(['a', 'b'])
    expect(entries.every((e) => !e.leaving)).toBe(true)
    expect(reappeared).toEqual(['b'])
    expect(newlyLeaving).toEqual([])
  })

  it('itens novos entram pela ordem da lista nova, sem leaving', () => {
    const previous = entriesOf([{ id: 'a', name: 'Sushi' }])
    const { entries } = mergeAnimatedEntries(
      previous,
      [{ id: 'z', name: 'Temaki' }, { id: 'a', name: 'Sushi' }],
      keyOf,
    )

    expect(entries.map((e) => e.key)).toEqual(['z', 'a'])
    expect(entries.every((e) => !e.leaving)).toBe(true)
  })

  it('um item já em saída não é re-anunciado em newlyLeaving', () => {
    const previous: AnimatedEntry<Row>[] = [
      { item: { id: 'a', name: 'Sushi' }, key: 'a', leaving: false },
      { item: { id: 'b', name: 'Ramen' }, key: 'b', leaving: true },
    ]
    const { entries, newlyLeaving } = mergeAnimatedEntries(previous, [{ id: 'a', name: 'Sushi' }], keyOf)

    expect(entries.map((e) => e.key)).toEqual(['a', 'b'])
    expect(entries[1].leaving).toBe(true)
    // 'b' já estava em saída — só os acabados de remover entram em newlyLeaving.
    expect(newlyLeaving).toEqual([])
  })

  it('a atualização de dados de um item presente passa para a entrada nova', () => {
    const previous = entriesOf([{ id: 'a', name: 'Sushi' }])
    const { entries } = mergeAnimatedEntries(previous, [{ id: 'a', name: 'Sushi Premium' }], keyOf)

    expect(entries[0].item.name).toBe('Sushi Premium')
  })
})
