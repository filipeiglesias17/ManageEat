import { describe, it, expect } from 'vitest'
import { buildWorkbookData } from './report-xlsx'
import type { WorkbookParams, ExportSection, SheetData } from './report-xlsx'
import {
  filterByRange,
  filterPaymentsByRange,
  ordersWithoutVoidedOnlyPayments,
  summarize,
} from './stats'
import { makeOrder, makeOrderItem, makePayment } from '../test/factories'

// ── Helpers de fixture ─────────────────────────────────────────────
//
// Estes testes verificam SÓ a função pura buildWorkbookData (não renderiza
// ExcelJS). Montamos um WorkbookParams mínimo e deixamos cada teste trocar só o
// que interessa (sections, orders, payments...).

function makeParams(overrides: Partial<WorkbookParams> = {}): WorkbookParams {
  return {
    settings: { mode: 'normal', entryPrice: 0, name: 'Tasca', nif: '500000000', defaultVatRate: 23 },
    profile: null,
    orders: [],
    payments: [],
    shifts: [],
    menuItems: [],
    categories: [],
    profiles: [],
    from: '',
    to: '',
    purpose: '',
    sections: [],
    ...overrides,
  }
}

function sheetNames(sheets: SheetData[]): string[] {
  return sheets.map((sheet) => sheet.name)
}

describe('buildWorkbookData — Capa', () => {
  it('inclui sempre a folha "Capa", mesmo sem secções', () => {
    const sheets = buildWorkbookData(makeParams({ sections: [] }))
    expect(sheetNames(sheets)).toEqual(['Capa'])
  })
})

describe('buildWorkbookData — seleção de folhas', () => {
  it('inclui só as secções pedidas (mais a Capa)', () => {
    const sections: ExportSection[] = ['itens', 'iva']
    const sheets = buildWorkbookData(makeParams({ sections }))
    expect(sheetNames(sheets)).toEqual(['Capa', 'Itens', 'IVA'])
  })

  it('respeita a ordem canónica, não a ordem em que foram marcadas', () => {
    // Pedimos iva antes de itens; a saída deve sair sempre itens → iva.
    const sections: ExportSection[] = ['iva', 'itens']
    const sheets = buildWorkbookData(makeParams({ sections }))
    expect(sheetNames(sheets)).toEqual(['Capa', 'Itens', 'IVA'])
  })
})

describe('buildWorkbookData — reconciliação do Resumo', () => {
  it('a receita do Resumo bate com summarize sobre o mesmo filtro', () => {
    const orders = [
      makeOrder({ items: [makeOrderItem({ price: 10, quantity: 2 })] }), // 20
      makeOrder({ items: [makeOrderItem({ price: 5, quantity: 1 })] }),  // 5
    ]
    const params = makeParams({ orders, sections: ['resumo'] })

    // Mesma filtragem que o builder faz internamente.
    const periodPayments = filterPaymentsByRange(params.payments, params.from, params.to)
    const filtered = ordersWithoutVoidedOnlyPayments(
      filterByRange(params.orders, params.from, params.to),
      periodPayments,
    )
    const expected = summarize(filtered, periodPayments)

    const sheets = buildWorkbookData(params)
    const resumo = sheets.find((sheet) => sheet.name === 'Resumo')
    const receitaRow = resumo?.rows.find((row) => row.indicador === 'Receita total')
    expect(receitaRow?.valor).toBeCloseTo(expected.revenue, 5)
  })

  it('um pedido de sessão só com pagamento anulado não conta para a receita', () => {
    const voidedOnly = makeOrder({
      sessionId: 'sess-void',
      items: [makeOrderItem({ price: 100, quantity: 1 })],
    })
    const payments = [
      makePayment({ sessionId: 'sess-void', voidedAt: '2026-06-19T13:00:00', voidedBy: 'admin', voidReason: 'Erro' }),
    ]
    const params = makeParams({ orders: [voidedOnly], payments, sections: ['resumo'] })

    const sheets = buildWorkbookData(params)
    const resumo = sheets.find((sheet) => sheet.name === 'Resumo')
    const receitaRow = resumo?.rows.find((row) => row.indicador === 'Receita total')
    expect(receitaRow?.valor).toBe(0)
  })
})

describe('buildWorkbookData — colunas de dinheiro', () => {
  it('marca as colunas de receita com money: true na folha Itens', () => {
    const orders = [makeOrder({ items: [makeOrderItem({ price: 10, quantity: 1 })] })]
    const sheets = buildWorkbookData(makeParams({ orders, sections: ['itens'] }))
    const itens = sheets.find((sheet) => sheet.name === 'Itens')
    const receitaCol = itens?.columns.find((col) => col.key === 'receita')
    expect(receitaCol?.money).toBe(true)
  })

  it('a folha IVA marca base, iva e total como colunas de dinheiro', () => {
    const orders = [makeOrder({ items: [makeOrderItem({ price: 10, quantity: 1 })] })]
    const sheets = buildWorkbookData(makeParams({ orders, sections: ['iva'] }))
    const iva = sheets.find((sheet) => sheet.name === 'IVA')
    const moneyKeys = iva?.columns.filter((col) => col.money).map((col) => col.key)
    expect(moneyKeys).toEqual(['base', 'iva', 'total'])
  })
})
