import { describe, it, expect } from 'vitest'
import {
  buildDailyCsv,
  buildItemsCsv,
  buildCategoriesCsv,
  buildPaymentsCsv,
  buildVatCsv,
  buildStaffAuditCsv,
} from './stats'
import type { DayPoint, ItemStat, CatStat, PaymentStat, VatLine } from './stats'
import type { StaffAuditRow } from './staff-audit'

//  Helpers de leitura
//
// Os builders devolvem uma string CSV (linhas separadas por \n). Estes helpers
// leem o header e as linhas de dados sem repetir o split em cada teste.

function lines(csv: string): string[] {
  return csv.split('\n')
}

function dataLines(csv: string): string[] {
  // Linhas que não são comentário (# ...). Inclui o header.
  return lines(csv).filter((line) => !line.startsWith('#'))
}

function headerOf(csv: string): string {
  return dataLines(csv)[0]
}

function commentLines(csv: string): string[] {
  return lines(csv).filter((line) => line.startsWith('#'))
}

describe('buildDailyCsv', () => {
  const series: DayPoint[] = [
    { day: '2026-06-19', label: '19 jun', revenue: 12.5, orders: 3, items: 7 },
  ]

  it('tem o header PT correto e uma linha por dia', () => {
    const csv = buildDailyCsv(series)
    expect(headerOf(csv)).toBe('Dia,Receita,Pedidos,Itens')
    // 1 header + 1 dia.
    expect(dataLines(csv)).toHaveLength(2)
  })

  it('continua a funcionar com comentários prefixados com "# "', () => {
    const csv = buildDailyCsv(series, ['Período: Todo o histórico'])
    expect(commentLines(csv)).toEqual(['# Período: Todo o histórico'])
    // O header CSV vem a seguir aos comentários.
    expect(headerOf(csv)).toBe('Dia,Receita,Pedidos,Itens')
  })
})

describe('buildItemsCsv', () => {
  const items: ItemStat[] = [
    { id: 'a', name: 'Café', qty: 2, revenue: 5 },
    { id: 'b', name: 'Bolo', qty: 1, revenue: 3 },
  ]

  it('tem o header PT correto e uma linha por item', () => {
    const csv = buildItemsCsv(items)
    expect(headerOf(csv)).toBe('Item,Qtd,Receita')
    // 1 header + 2 itens.
    expect(dataLines(csv)).toHaveLength(3)
  })

  it('prefixa os comentários com "# "', () => {
    const csv = buildItemsCsv(items, ['Finalidade: Contabilidade'])
    expect(commentLines(csv)).toEqual(['# Finalidade: Contabilidade'])
  })
})

describe('buildCategoriesCsv', () => {
  const cats: CatStat[] = [
    { name: 'Bebidas', qty: 4, revenue: 20, color: '#fff' },
  ]

  it('tem o header PT correto e uma linha por categoria', () => {
    const csv = buildCategoriesCsv(cats)
    expect(headerOf(csv)).toBe('Categoria,Qtd,Receita')
    expect(dataLines(csv)).toHaveLength(2)
  })
})

describe('buildPaymentsCsv', () => {
  const pays: PaymentStat[] = [
    { method: 'dinheiro', count: 2, amount: 30 },
    { method: 'cartao', count: 1, amount: 15 },
  ]

  it('tem o header PT correto e uma linha por meio de pagamento', () => {
    const csv = buildPaymentsCsv(pays)
    expect(headerOf(csv)).toBe('Método,Nº,Valor')
    expect(dataLines(csv)).toHaveLength(3)
  })

  it('usa as etiquetas PT dos métodos', () => {
    const csv = buildPaymentsCsv(pays)
    const lines = dataLines(csv)
    expect(lines[1]).toContain('Dinheiro')
    expect(lines[2]).toContain('Cartão')
  })
})

describe('buildVatCsv', () => {
  const vat: VatLine[] = [
    { rate: 23, base: 10, vat: 2.3, gross: 12.3 },
  ]

  it('tem o header PT correto e uma linha por taxa', () => {
    const csv = buildVatCsv(vat)
    expect(headerOf(csv)).toBe('Taxa,Base,IVA,Total')
    expect(dataLines(csv)).toHaveLength(2)
  })
})

describe('buildStaffAuditCsv', () => {
  const rows: StaffAuditRow[] = [
    {
      uid: 'u1',
      name: 'Ana',
      cancellations: 1,
      paymentsRegistered: 3,
      amountRegistered: 50,
      paymentsVoided: 0,
      shiftsOpened: 1,
      shiftsClosed: 1,
      hoursWorked: 8.5,
    },
  ]

  it('tem o header PT correto e uma linha por staff', () => {
    const csv = buildStaffAuditCsv(rows)
    expect(headerOf(csv)).toBe('Staff,Cancelamentos,Pagamentos,Valor,Anulações,Turnos abertos,Turnos fechados,Horas')
    expect(dataLines(csv)).toHaveLength(2)
  })

  it('prefixa os comentários com "# " (incluindo aviso RGPD)', () => {
    const csv = buildStaffAuditCsv(rows, ['Período: Todo o histórico', 'Aviso RGPD'])
    expect(commentLines(csv)).toEqual(['# Período: Todo o histórico', '# Aviso RGPD'])
  })
})
