// SAF-T (PT)  exportação EXPERIMENTAL.
//
// AVISO: este ficheiro NÃO é um SAF-T válido para entrega à AT. Falta-lhe
// tudo o que exige software de faturação certificado: assinatura/Hash da cadeia
// de documentos, ATCUD, numeração de série comunicada no Portal das Finanças e
// validação contra o XSD oficial. Serve apenas de base de estudo / ponto de
// partida  gera um XML bem-formado com a estrutura principal (Header,
// MasterFiles, SourceDocuments) a partir dos dados do protótipo.
//
// Sem dependências: construímos o XML com template strings e escaping próprio.

import type { Order } from '../@types/order'
import type { MenuItem } from '../@types/menu-item'
import type { Payment } from '../@types/payment'
import type { RestaurantSettings } from '../@types/settings'
import { billableOrders, orderItemsRevenue } from './account'
import { lineTotal, orderSubtotal, safeQuantity } from './order-utils'
import { filterByRange, filterPaymentsByRange, orderDay, ordersWithoutVoidedOnlyPayments, paymentDay, paymentEntryRevenue } from './stats'
import { downloadText } from './export-download'
import type { ExportMeta } from './export-meta'

type SaftParams = {
  settings: RestaurantSettings
  orders: Order[]
  payments?: Payment[]
  menuItems: MenuItem[]
  from: string
  to: string
  // Opcional: se vier, juntamos um comentário XML "Exportado por X em Y" para
  // responsabilização. Não afeta a estrutura SAF-T.
  meta?: ExportMeta
}

// Escapa os 5 caracteres especiais de XML.
function xml(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

const money = (n: number) => n.toFixed(2)

// Arredonda a cêntimos. O SAF-T exige que a soma das linhas bata certo com os
// totais do documento, por isso arredonda-se CADA linha e só depois se soma
// nunca somar a precisão total e arredondar no fim (dava diferenças de 1 cêntimo).
const round2 = (n: number) => Math.round(n * 100) / 100

// Classe de IVA da AT a partir da taxa: isento, reduzida, intermédia, normal.
// Aproximação pelas taxas do continente (6/13/23%)  suficiente para o estudo.
// Exportada para os testes verificarem as fronteiras (ver saft.test.ts).
export function saftTaxCode(rate: number): string {
  if (rate <= 0) return 'ISE'
  if (rate <= 6) return 'RED'
  if (rate <= 13) return 'INT'
  return 'NOR'
}

// AAAA-MM-DD da data ISO de um pedido (a AT espera datas, não timestamps).
function invoiceDate(order: Order): string {
  return orderDay(order)
}

type SaftLine = {
  lineNumber: number
  productCode: string
  description: string
  quantity: number
  unitPriceNet: number   // preço unitário SEM IVA
  creditNet: number      // valor da linha SEM IVA (base tributável)
  rate: number           // taxa de IVA (%)
  taxPointDate: string
}

// Renderiza uma <Line> do SAF-T. Centralizado para a entrada de rodízio e os
// itens partilharem exatamente a mesma estrutura e o mesmo arredondamento.
function renderLine(line: SaftLine): string {
  return `
          <Line>
            <LineNumber>${line.lineNumber}</LineNumber>
            <ProductCode>${xml(line.productCode)}</ProductCode>
            <ProductDescription>${xml(line.description)}</ProductDescription>
            <Quantity>${line.quantity}</Quantity>
            <UnitOfMeasure>UN</UnitOfMeasure>
            <UnitPrice>${money(line.unitPriceNet)}</UnitPrice>
            <TaxPointDate>${line.taxPointDate}</TaxPointDate>
            <Description>${xml(line.description)}</Description>
            <CreditAmount>${money(line.creditNet)}</CreditAmount>
            <Tax>
              <TaxType>IVA</TaxType>
              <TaxCountryRegion>PT</TaxCountryRegion>
              <TaxCode>${saftTaxCode(line.rate)}</TaxCode>
              <TaxPercentage>${money(line.rate)}</TaxPercentage>
            </Tax>
          </Line>`
}

type SaftInvoice = {
  invoiceNo: string
  source: string         // origem do documento (canal do pedido ou 'rodizio')
  date: string           // AAAA-MM-DD
  systemEntryDate: string
  linesXml: string
  docNet: number         // total sem IVA
  docTax: number         // IVA do documento
}

// Renderiza uma <Invoice> completa. Partilhada pelas faturas de pedido e pelas
// faturas da entrada de rodízio (derivadas do pagamento) para terem a mesma
// estrutura e o GrossTotal reconciliar sempre com NetTotal + TaxPayable.
function renderInvoice(invoice: SaftInvoice): string {
  const docGross = round2(invoice.docNet + invoice.docTax)
  return `
      <Invoice>
        <InvoiceNo>${xml(invoice.invoiceNo)}</InvoiceNo>
        <DocumentStatus>
          <InvoiceStatus>N</InvoiceStatus>
          <InvoiceStatusDate>${invoice.date}T00:00:00</InvoiceStatusDate>
          <SourceID>${xml(invoice.source)}</SourceID>
          <SourceBilling>P</SourceBilling>
        </DocumentStatus>
        <Hash>0</Hash>
        <HashControl>0</HashControl>
        <InvoiceDate>${invoice.date}</InvoiceDate>
        <InvoiceType>FT</InvoiceType>
        <SpecialRegimes>
          <SelfBillingIndicator>0</SelfBillingIndicator>
          <CashVATSchemeIndicator>0</CashVATSchemeIndicator>
          <ThirdPartiesBillingIndicator>0</ThirdPartiesBillingIndicator>
        </SpecialRegimes>
        <SourceID>${xml(invoice.source)}</SourceID>
        <SystemEntryDate>${invoice.systemEntryDate}</SystemEntryDate>
        <CustomerID>Consumidor final</CustomerID>${invoice.linesXml}
        <DocumentTotals>
          <TaxPayable>${money(invoice.docTax)}</TaxPayable>
          <NetTotal>${money(invoice.docNet)}</NetTotal>
          <GrossTotal>${money(docGross)}</GrossTotal>
        </DocumentTotals>
      </Invoice>`
}

export function buildSaftXml(params: SaftParams): string {
  const { settings, orders, payments = [], menuItems, from, to, meta } = params
  const defaultVatRate = settings.defaultVatRate ?? 0

  const periodPayments = filterPaymentsByRange(payments, from, to)
  const reportOrders = ordersWithoutVoidedOnlyPayments(filterByRange(orders, from, to), periodPayments)
  const billable = billableOrders(reportOrders)

  // Entrada de rodízio: a fonte fiscal são as contas pagas (payments), não os
  // pedidos  assim a entrada cobrada aparece mesmo quando todos os pedidos da
  // conta foram cancelados (auditoria gap-0-0).
  const entryPayments = periodPayments.filter((payment) => paymentEntryRevenue(payment) > 0)

  // Período fiscal: usa o intervalo escolhido; se "Tudo", deriva das datas dos
  // documentos (pedidos + entradas de rodízio). Fallback para hoje sem dados.
  const days = [...billable.map(invoiceDate), ...entryPayments.map(paymentDay)].sort()
  const startDate = from || days[0] || orderDay({ createdAt: new Date().toISOString() } as Order)
  const endDate = to || days[days.length - 1] || startDate
  const fiscalYear = startDate.slice(0, 4)

  //  MasterFiles: Produtos (a partir do menu)
  const hasRodizioEntry = entryPayments.length > 0
  let productsXml = menuItems.map((item) => `
      <Product>
        <ProductType>P</ProductType>
        <ProductCode>${xml(item.id)}</ProductCode>
        <ProductDescription>${xml(item.name)}</ProductDescription>
        <ProductNumberCode>${xml(item.id)}</ProductNumberCode>
      </Product>`).join('')

  if (hasRodizioEntry) {
    productsXml += `
      <Product>
        <ProductType>P</ProductType>
        <ProductCode>RODIZIO_ENTRY</ProductCode>
        <ProductDescription>Entrada Rodízio</ProductDescription>
        <ProductNumberCode>RODIZIO_ENTRY</ProductNumberCode>
      </Product>`
  }

  //  MasterFiles: Tabela de impostos (taxas distintas usadas)
  const rates = new Set<number>([defaultVatRate])
  menuItems.forEach((item) => { if (item.vatRate != null) rates.add(item.vatRate) })
  billable.forEach((o) => o.items.forEach((i) => { if (i.vatRate != null) rates.add(i.vatRate) }))
  const taxTableXml = [...rates].sort((a, b) => a - b).map((rate) => `
      <TaxTableEntry>
        <TaxType>IVA</TaxType>
        <TaxCountryRegion>PT</TaxCountryRegion>
        <TaxCode>${saftTaxCode(rate)}</TaxCode>
        <Description>IVA ${rate}%</Description>
        <TaxPercentage>${money(rate)}</TaxPercentage>
      </TaxTableEntry>`).join('')

  //  SourceDocuments: uma fatura por pedido
  let totalNet = 0

  const invoicesXml = billable.map((order, index) => {
    const taxPointDate = invoiceDate(order)
    let lineNumber = 0
    let docNet = 0
    let docTax = 0
    const renderedLines: string[] = []

    // Acrescenta uma linha já arredondada a cêntimos e soma-a aos totais do
    // documento. Como base + IVA == bruto por linha (e tudo a 2 casas), a soma
    // das linhas reconcilia sempre com o DocumentTotals.
    function pushLine(productCode: string, description: string, quantity: number, gross: number, rate: number) {
      lineNumber += 1
      const base = round2(gross / (1 + rate / 100))
      const tax = round2(gross - base)
      docNet += base
      docTax += tax
      const dividableQty = Math.max(1, quantity)
      renderedLines.push(renderLine({
        lineNumber,
        productCode,
        description,
        quantity,
        unitPriceNet: round2(base / dividableQty),
        creditNet: base,
        rate,
        taxPointDate,
      }))
    }

    //  Itens: o desconto global do pedido é distribuído pelas linhas
    // Cada linha fica com o bruto realmente cobrado (líquido do desconto),
    // proporcional ao seu peso  a mesma regra do vatBreakdown dos relatórios,
    // para o SAF-T reconciliar com a conta e com o PDF. O resíduo de
    // arredondamento vai para a maior linha, garantindo Σ linhas == receita.
    const subtotal = orderSubtotal(order)
    const itemsRevenue = orderItemsRevenue(order)
    const itemGrosses = order.items.map((item) => {
      if (subtotal <= 0) return 0
      return round2((lineTotal(item) / subtotal) * itemsRevenue)
    })
    const allocated = itemGrosses.reduce((sum, gross) => sum + gross, 0)
    const residual = round2(round2(itemsRevenue) - allocated)
    if (residual !== 0 && itemGrosses.length > 0) {
      const largest = itemGrosses.reduce((best, gross, i) => (gross > itemGrosses[best] ? i : best), 0)
      itemGrosses[largest] = round2(itemGrosses[largest] + residual)
    }
    order.items.forEach((item, i) => {
      const rate = item.vatRate ?? defaultVatRate
      pushLine(item.menuItemId, item.menuItemName, safeQuantity(item.quantity), itemGrosses[i], rate)
    })

    const combinedLinesXml = renderedLines.join('')
    totalNet += docNet

    return renderInvoice({
      invoiceNo: `ME ${fiscalYear}/${index + 1}`,
      source: order.source,
      date: taxPointDate,
      systemEntryDate: order.createdAt,
      linesXml: combinedLinesXml,
      docNet,
      docTax,
    })
  }).join('')

  //  Faturas da entrada de rodízio (uma por conta paga)
  // A entrada vai toda à taxa por defeito e não sofre desconto. A numeração
  // continua a seguir às faturas dos pedidos.
  const entryInvoicesXml = entryPayments.map((payment, index) => {
    const date = paymentDay(payment)
    const qty = safeQuantity(payment.accountHeadcount ?? 0)
    const gross = round2(paymentEntryRevenue(payment))
    const base = round2(gross / (1 + defaultVatRate / 100))
    const tax = round2(gross - base)
    totalNet += base
    const dividableQty = Math.max(1, qty)
    const lineXml = renderLine({
      lineNumber: 1,
      productCode: 'RODIZIO_ENTRY',
      description: 'Entrada Rodízio',
      quantity: qty,
      unitPriceNet: round2(base / dividableQty),
      creditNet: base,
      rate: defaultVatRate,
      taxPointDate: date,
    })
    return renderInvoice({
      invoiceNo: `ME ${fiscalYear}/${billable.length + index + 1}`,
      source: 'rodizio',
      date,
      systemEntryDate: payment.createdAt,
      linesXml: lineXml,
      docNet: base,
      docTax: tax,
    })
  }).join('')

  const totalInvoices = billable.length + entryPayments.length

  const nowIso = new Date().toISOString().slice(0, 10)

  // Comentário opcional de responsabilização (quem exportou e quando). Só entra
  // se vier `meta`; escapamos o texto porque vai dentro de um comentário XML.
  let exportedByComment = ''
  if (meta) {
    exportedByComment = `
<!-- Exportado por ${xml(meta.exportedByUsername)} (${xml(meta.exportedByRole)}) em ${xml(meta.exportedAt)}. -->`
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- SAF-T (PT) EXPERIMENTAL gerado pelo Manage Eat. NÃO é um ficheiro válido
     para entrega à AT: sem Hash/assinatura, sem ATCUD, sem série comunicada. -->
<!-- CONFIDENCIAL (RGPD): uso interno da gestão do restaurante. Contém dados de
     vendas — não partilhar nem reter além do necessário para a finalidade. -->${exportedByComment}
<AuditFile xmlns="urn:OECD:StandardAuditFile-Tax:PT_1.04_01">
  <Header>
    <AuditFileVersion>1.04_01</AuditFileVersion>
    <CompanyID>${xml(settings.nif || 'sem-nif')}</CompanyID>
    <TaxRegistrationNumber>${xml(settings.nif || '999999990')}</TaxRegistrationNumber>
    <TaxAccountingBasis>F</TaxAccountingBasis>
    <CompanyName>${xml(settings.name || 'Restaurante')}</CompanyName>
    <CompanyAddress>
      <AddressDetail>${xml(settings.address || 'Desconhecida')}</AddressDetail>
      <City>Desconhecida</City>
      <PostalCode>0000-000</PostalCode>
      <Country>PT</Country>
    </CompanyAddress>
    <FiscalYear>${xml(fiscalYear)}</FiscalYear>
    <StartDate>${xml(startDate)}</StartDate>
    <EndDate>${xml(endDate)}</EndDate>
    <CurrencyCode>EUR</CurrencyCode>
    <DateCreated>${nowIso}</DateCreated>
    <TaxEntity>Global</TaxEntity>
    <ProductCompanyTaxID>${xml(settings.nif || '999999990')}</ProductCompanyTaxID>
    <SoftwareCertificateNumber>0</SoftwareCertificateNumber>
    <ProductID>ManageEat/ManageEat</ProductID>
    <ProductVersion>0.0.0</ProductVersion>
  </Header>
  <MasterFiles>${productsXml}
    <TaxTable>${taxTableXml}
    </TaxTable>
  </MasterFiles>
  <SourceDocuments>
    <SalesInvoices>
      <NumberOfEntries>${totalInvoices}</NumberOfEntries>
      <TotalDebit>0.00</TotalDebit>
      <TotalCredit>${money(totalNet)}</TotalCredit>${invoicesXml}${entryInvoicesXml}
    </SalesInvoices>
  </SourceDocuments>
</AuditFile>
`
}

// Gera e descarrega o ficheiro .xml. Reutiliza downloadText (BOM UTF-8 para o
// XML abrir com acentos correctos). Mantém o prefixo `saft-experimental-` para
// deixar claro que NÃO é um SAF-T válido para a AT.
export async function downloadSaftXml(params: SaftParams): Promise<void> {
  const xmlStr = buildSaftXml(params)
  await downloadText(
    xmlStr,
    `saft-experimental-${params.from || 'inicio'}-${params.to || 'fim'}.xml`,
    'application/xml;charset=utf-8;',
    true,
  )
}
