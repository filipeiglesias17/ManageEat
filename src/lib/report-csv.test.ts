import { describe, it, expect } from 'vitest'
import { buildCsvFiles } from './report-csv'
import type { CsvFile } from './report-csv'
import type { WorkbookParams, ExportSection } from './report-xlsx'
import { makeOrder, makeOrderItem } from '../test/factories'

// ── Helpers de fixture ─────────────────────────────────────────────
//
// buildCsvFiles reutiliza o mesmo WorkbookParams do XLSX. Montamos um mínimo e
// cada teste só troca o que precisa.

function makeParams(overrides: Partial<WorkbookParams> = {}): WorkbookParams {
  return {
    settings: { mode: 'normal', entryPrice: 0, name: 'Tasca', nif: '500000000', defaultVatRate: 23 },
    profile: null,
    orders: [makeOrder({ items: [makeOrderItem({ price: 10, quantity: 1 })] })],
    payments: [],
    shifts: [],
    menuItems: [],
    categories: [],
    profiles: [],
    from: '',
    to: '',
    purpose: 'Contabilidade',
    sections: [],
    ...overrides,
  }
}

function fileFor(files: CsvFile[], dataset: string): CsvFile | undefined {
  return files.find((file) => file.filename.includes(dataset))
}

// As linhas de comentário do CSV começam por "# ". Devolve só essas, na ordem.
function commentLines(text: string): string[] {
  return text.split('\n').filter((line) => line.startsWith('#'))
}

describe('buildCsvFiles — um ficheiro por secção com dataset', () => {
  it('gera um ficheiro CSV por cada secção que tem dataset', () => {
    const sections: ExportSection[] = ['itens', 'iva']
    const files = buildCsvFiles(makeParams({ sections }))
    expect(files).toHaveLength(2)
    expect(fileFor(files, 'itens')).toBeDefined()
    expect(fileFor(files, 'iva')).toBeDefined()
  })

  it('ignora as secções sem builder CSV (resumo, turnos, rodizio) — cai no fallback', () => {
    const sections: ExportSection[] = ['resumo', 'turnos', 'rodizio']
    const files = buildCsvFiles(makeParams({ sections }))
    // Nenhuma dessas tem dataset CSV próprio; nunca geram ficheiro próprio.
    expect(fileFor(files, 'resumo')).toBeUndefined()
    expect(fileFor(files, 'turnos')).toBeUndefined()
    expect(fileFor(files, 'rodizio')).toBeUndefined()
  })
})

describe('buildCsvFiles — comentários de cabeçalho', () => {
  it('cada ficheiro começa com linhas de comentário prefixadas com #', () => {
    const sections: ExportSection[] = ['itens']
    const files = buildCsvFiles(makeParams({ sections }))
    const itens = fileFor(files, 'itens')!

    // A primeira linha é um comentário e há substrings estáveis dos metadados.
    expect(itens.text.startsWith('#')).toBe(true)
    expect(itens.text).toContain('Período')
    expect(itens.text).toContain('Finalidade')
  })

  it('o CSV de auditoria inclui uma linha # adicional de confidencialidade', () => {
    const sections: ExportSection[] = ['itens', 'auditoria']
    const files = buildCsvFiles(makeParams({ sections }))
    const itens = fileFor(files, 'itens')!
    const auditoria = fileFor(files, 'auditoria')!

    // A auditoria tem mais uma linha de comentário (o aviso RGPD) que os itens.
    expect(commentLines(auditoria.text).length).toBe(commentLines(itens.text).length + 1)
    // Não fixamos o texto legal exato (pode ser afinado); verificamos só prefixo
    // # e uma substring estável do aviso RGPD.
    expect(auditoria.text).toContain('RGPD')
  })
})

describe('buildCsvFiles — fallback', () => {
  it('sem qualquer dataset CSV pedido, devolve pelo menos o ficheiro de vendas-dia', () => {
    const files = buildCsvFiles(makeParams({ sections: [] }))
    expect(files.length).toBeGreaterThanOrEqual(1)
    expect(fileFor(files, 'vendas-dia')).toBeDefined()
  })
})
