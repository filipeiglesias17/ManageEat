import { describe, it, expect } from 'vitest'
import { buildSaftXml, saftTaxCode } from './saft'
import { orderItemsRevenue } from './account'
import { paymentEntryRevenue } from './stats'
import type { RestaurantSettings } from '../@types/settings'
import { makeOrder, makeOrderItem, makePayment } from '../test/factories'

// ── Helpers de fixture/extração ────────────────────────────────────
//
// O SAF-T é uma string XML, por isso os testes extraem os valores com regex
// simples em vez de um parser. Cada helper é deliberadamente pequeno para o
// teste ler como uma asserção sobre o documento gerado.

function makeSettings(overrides: Partial<RestaurantSettings> = {}): RestaurantSettings {
  return { mode: 'normal', entryPrice: 0, name: 'Tasca', nif: '500000000', defaultVatRate: 23, ...overrides }
}

// O XML é gerado sempre com período "Tudo" (from/to vazios) — mantém os testes
// focados na matemática das faturas, não na filtragem. Os pagamentos são a fonte
// fiscal da entrada de rodízio (passa-os quando o caso a envolve).
function buildXml(
  orders: Parameters<typeof buildSaftXml>[0]['orders'],
  settings = makeSettings(),
  payments: Parameters<typeof buildSaftXml>[0]['payments'] = [],
) {
  return buildSaftXml({ settings, orders, payments, menuItems: [], from: '', to: '' })
}

// Soma o GrossTotal de TODAS as faturas do documento (pedidos + entradas).
function sumGrossTotals(xml: string): number {
  return invoiceBlocks(xml).reduce((sum, invoice) => sum + tagNumber(invoice, 'GrossTotal'), 0)
}

function invoiceBlocks(xml: string): string[] {
  return [...xml.matchAll(/<Invoice>([\s\S]*?)<\/Invoice>/g)].map((m) => m[1])
}

function lineBlocks(invoice: string): string[] {
  return [...invoice.matchAll(/<Line>([\s\S]*?)<\/Line>/g)].map((m) => m[1])
}

function tagText(block: string, name: string): string {
  const match = block.match(new RegExp(`<${name}>([^<]*)</${name}>`))
  return match ? match[1] : ''
}

function tagNumber(block: string, name: string): number {
  return Number(tagText(block, name))
}

function sumCreditAmounts(invoice: string): number {
  return lineBlocks(invoice).reduce((sum, line) => sum + tagNumber(line, 'CreditAmount'), 0)
}

describe('saftTaxCode', () => {
  it('mapeia as taxas do continente para as classes da AT', () => {
    expect(saftTaxCode(0)).toBe('ISE')
    expect(saftTaxCode(-5)).toBe('ISE')
    expect(saftTaxCode(6)).toBe('RED')
    expect(saftTaxCode(5)).toBe('RED')
    expect(saftTaxCode(13)).toBe('INT')
    expect(saftTaxCode(7)).toBe('INT')
    expect(saftTaxCode(23)).toBe('NOR')
    expect(saftTaxCode(14)).toBe('NOR')
  })
})

describe('buildSaftXml — estrutura e seleção', () => {
  it('gera uma fatura por pedido faturável e exclui os cancelados', () => {
    const orders = [makeOrder(), makeOrder({ status: 'cancelled' })]
    const xml = buildXml(orders)
    expect(invoiceBlocks(xml)).toHaveLength(1)
    expect(tagNumber(xml, 'NumberOfEntries')).toBe(1)
  })

  it('não reaproveita pagamento ativo de outra conta no mesmo QR permanente', () => {
    const oldAccount = makeOrder({
      sessionId: 'qr-permanente',
      createdAt: '2026-06-19T12:10:00',
      items: [makeOrderItem({ menuItemName: 'Conta antiga', price: 10 })],
    })
    const newAccount = makeOrder({
      sessionId: 'qr-permanente',
      createdAt: '2026-06-19T14:10:00',
      items: [makeOrderItem({ menuItemName: 'Conta nova', price: 10 })],
    })
    const payments = [
      makePayment({
        sessionId: 'qr-permanente',
        createdAt: '2026-06-19T12:30:00',
        voidedAt: '2026-06-19T12:40:00',
        voidedBy: 'admin',
        voidReason: 'Erro',
        accountOpenedAt: '2026-06-19T12:00:00',
        accountClosedAt: '2026-06-19T12:20:00',
      }),
      makePayment({
        sessionId: 'qr-permanente',
        createdAt: '2026-06-19T14:30:00',
        accountOpenedAt: '2026-06-19T14:00:00',
        accountClosedAt: '2026-06-19T14:20:00',
      }),
    ]

    const xml = buildSaftXml({
      settings: makeSettings(),
      orders: [oldAccount, newAccount],
      payments,
      menuItems: [],
      from: '',
      to: '',
    })

    expect(invoiceBlocks(xml)).toHaveLength(1)
    expect(xml).toContain('Conta nova')
    expect(xml).not.toContain('Conta antiga')
  })
})

describe('buildSaftXml — reconciliação de arredondamento', () => {
  // 7 linhas a 0,10 € com IVA 23%: cada base arredonda para 0,08, mas a soma
  // das bases arredondadas (0,56) não bate com a base do documento (0,57). É o
  // caso clássico de "arredondar por linha vs no total" que a AT rejeita.
  it('a soma dos CreditAmount das linhas é igual ao NetTotal do documento', () => {
    const items = Array.from({ length: 7 }, () => makeOrderItem({ price: 0.1, quantity: 1 }))
    const xml = buildXml([makeOrder({ items })])
    const invoice = invoiceBlocks(xml)[0]
    expect(sumCreditAmounts(invoice)).toBeCloseTo(tagNumber(invoice, 'NetTotal'), 2)
  })

  it('GrossTotal é igual a NetTotal + TaxPayable', () => {
    const items = Array.from({ length: 7 }, () => makeOrderItem({ price: 0.1, quantity: 1 }))
    const xml = buildXml([makeOrder({ items })])
    const invoice = invoiceBlocks(xml)[0]
    expect(tagNumber(invoice, 'GrossTotal')).toBeCloseTo(
      tagNumber(invoice, 'NetTotal') + tagNumber(invoice, 'TaxPayable'),
      2,
    )
  })
})

describe('buildSaftXml — reconciliação com a conta', () => {
  it('o GrossTotal de um pedido sem desconto é a receita dos itens', () => {
    const order = makeOrder({
      items: [makeOrderItem({ price: 12.5, quantity: 2 }), makeOrderItem({ price: 8, quantity: 1 })],
    })
    const xml = buildXml([order])
    const invoice = invoiceBlocks(xml)[0]
    expect(tagNumber(invoice, 'GrossTotal')).toBeCloseTo(orderItemsRevenue(order), 2)
  })

  it('inclui a entrada de rodízio (do pagamento) na receita total do documento', () => {
    const order = makeOrder({ items: [makeOrderItem({ price: 10, quantity: 1 })] })
    const payment = makePayment({ accountMode: 'rodizio', accountEntryPrice: 15, accountHeadcount: 2 })
    const xml = buildXml([order], makeSettings(), [payment])
    // Receita total = itens do pedido + entrada cobrada na conta paga.
    expect(sumGrossTotals(xml)).toBeCloseTo(
      orderItemsRevenue(order) + paymentEntryRevenue(payment),
      2,
    )
  })
})

describe('buildSaftXml — desconto global do pedido', () => {
  it('desconta uma percentagem do GrossTotal', () => {
    const order = makeOrder({
      items: [makeOrderItem({ price: 50, quantity: 2 })], // subtotal 100
      discountType: 'percent',
      discountValue: 10,
    })
    const xml = buildXml([order])
    const invoice = invoiceBlocks(xml)[0]
    // Conta real = 90 €; o SAF-T tem de refletir o que foi cobrado, não os 100.
    expect(tagNumber(invoice, 'GrossTotal')).toBeCloseTo(90, 2)
  })

  it('desconta um valor em euros do GrossTotal', () => {
    const order = makeOrder({
      items: [makeOrderItem({ price: 40, quantity: 1 })], // subtotal 40
      discountType: 'euros',
      discountValue: 10,
    })
    const xml = buildXml([order])
    const invoice = invoiceBlocks(xml)[0]
    expect(tagNumber(invoice, 'GrossTotal')).toBeCloseTo(30, 2)
  })
})

describe('buildSaftXml — rodízio (entrada a partir do pagamento)', () => {
  it('cria a linha RODIZIO_ENTRY com Quantity igual ao headcount do pagamento', () => {
    const payment = makePayment({ accountMode: 'rodizio', accountEntryPrice: 20, accountHeadcount: 3 })
    const xml = buildXml([makeOrder()], makeSettings(), [payment])
    const entryInvoice = invoiceBlocks(xml).find((invoice) =>
      lineBlocks(invoice).some((line) => tagText(line, 'ProductCode') === 'RODIZIO_ENTRY'),
    )
    expect(entryInvoice).toBeDefined()
    const entryLine = lineBlocks(entryInvoice!).find((line) => tagText(line, 'ProductCode') === 'RODIZIO_ENTRY')
    expect(tagNumber(entryLine!, 'Quantity')).toBe(3)
  })

  it('a entrada aparece mesmo com TODOS os pedidos da conta cancelados (auditoria gap-0-0)', () => {
    const cancelled = makeOrder({ status: 'cancelled', items: [makeOrderItem({ price: 10, quantity: 1 })] })
    const payment = makePayment({ accountMode: 'rodizio', accountEntryPrice: 22, accountHeadcount: 2 })
    const xml = buildXml([cancelled], makeSettings(), [payment])
    // Sem o fix, sem pedido portador a entrada cobrada (44 €) desaparecia do SAF-T.
    const entryLine = invoiceBlocks(xml)
      .flatMap(lineBlocks)
      .find((line) => tagText(line, 'ProductCode') === 'RODIZIO_ENTRY')
    expect(entryLine).toBeDefined()
    expect(sumGrossTotals(xml)).toBeCloseTo(44, 2)
  })
})

describe('buildSaftXml — escaping XML', () => {
  it('escapa os caracteres especiais no nome do item', () => {
    const order = makeOrder({
      items: [makeOrderItem({ menuItemName: 'Café & Pão <b>', price: 10, quantity: 1 })],
    })
    const xml = buildXml([order])
    expect(xml).toContain('Café &amp; Pão &lt;b&gt;')
    expect(xml).not.toContain('<b>')
  })
})
