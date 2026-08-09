// Relatório de vendas em PDF, para o dono e para entregar ao contabilista.
//
// IMPORTANTE: este PDF é um documento de GESTÃO, não tem validade fiscal. Uma
// fatura/recibo legal em PT exige software certificado pela AT (ATCUD, QR Code,
// cadeia de hash). Por isso o relatório traz sempre esse aviso.
//
// O jsPDF é pesado, por isso é importado dinamicamente dentro da função  não
// entra no bundle inicial (só é descarregado quando o admin exporta).
//
// Layout: um cabeçalho de marca (papel timbrado "ManageEat" + azul "Eat"),
// cartões de KPI e tabelas coerentes (mesmo azul da marca no cabeçalho, linhas
// alternadas). Tudo desenhado com guardas de espaço para nunca cortar uma
// secção a meio nem escrever por cima do rodapé  o objetivo é sair sempre bem
// formatado, com poucos ou muitos dados.

import type { jsPDF as JsPdfDoc } from 'jspdf'
import type { UserOptions } from 'jspdf-autotable'
import type { Order } from '../@types/order'
import type { Payment } from '../@types/payment'
import type { MenuItem } from '../@types/menu-item'
import type { Category } from '../@types/category'
import type { RestaurantSettings } from '../@types/settings'
import type { Shift } from '../@types/shift'
import type { AppProfile } from '../@types/user'
import {
  filterByRange,
  filterPaymentsByRange,
  ordersWithoutVoidedOnlyPayments,
  summarize,
  vatBreakdown,
  dailySeries,
  categoryStats,
  paymentStats,
  cancellationStats,
  totalCovers,
  itemStats,
  menuMatrix,
  QUADRANT_META,
  tableStats,
  previousRange,
  pctDelta,
  isVoidedPayment,
} from './stats'
import { PAYMENT_METHOD_LABEL } from '../@types/payment'
import { formatEuro } from './helpers'
import { buildExportMeta, LEGAL_CONFIDENTIAL_RGPD } from './export-meta'
import { buildUidNameMap, shiftDurationHours } from './staff-audit'
import { downloadBlob } from './export-download'
import {
  BRAND_RGB,
  BRAND_TINT_RGB,
  INK_RGB,
  MUTED_RGB,
  HAIRLINE_RGB,
} from './brand'

type ReportParams = {
  settings: RestaurantSettings
  orders: Order[]
  payments: Payment[]
  menuItems: MenuItem[]
  categories: Category[]
  from: string
  to: string
  // Estes campos opcionais enriquecem o PDF sem quebrar chamadas antigas. A ausência
  // = comportamento antigo (sem metadados/turnos).
  profile?: AppProfile | null
  shifts?: Shift[]
  profiles?: AppProfile[]
  purpose?: string
}

// Reutiliza a formatação única de moeda (ex: "12,50 €"), ver formatEuro em helpers.ts.
const eur = formatEuro

//  Constantes de layout (mm, unidade por defeito do jsPDF em A4)
const MARGIN = 14
// Espaço reservado no fundo de cada página para o rodapé legal + nº de página.
// As tabelas nunca escrevem aqui (margin.bottom), logo nunca colidem com ele.
const FOOTER_RESERVE = 18

// YYYY-MM-DD → DD/MM/YYYY (para o cabeçalho).
function prettyDate(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

// Devolve o `finalY` da última tabela desenhada pelo autoTable (a lib guarda-o
// no doc). Centralizado aqui para não repetir o cast em cada chamada.
function lastTableY(doc: JsPdfDoc): number {
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
}

// Garante que há `need` mm livres antes do rodapé; se não houver, abre página
// nova e devolve o topo dela. Evita títulos de secção órfãos no fim da página.
function ensureSpace(doc: JsPdfDoc, y: number, need: number): number {
  const pageHeight = doc.internal.pageSize.getHeight()
  if (y + need > pageHeight - FOOTER_RESERVE) {
    doc.addPage()
    return 20
  }
  return y
}

// Marca da app: quadrado arredondado azul com um visto branco (eco do logótipo),
// desenhado em vetorial  sem depender de carregar nenhuma imagem (robustez).
function drawBrandMark(doc: JsPdfDoc, x: number, y: number, size: number): void {
  doc.setFillColor(BRAND_RGB[0], BRAND_RGB[1], BRAND_RGB[2])
  doc.roundedRect(x, y, size, size, size * 0.24, size * 0.24, 'F')
  doc.setDrawColor(255, 255, 255)
  doc.setLineWidth(size * 0.12)
  doc.setLineCap('round')
  doc.setLineJoin('round')
  // Visto: começa à esquerda, desce até ao vértice, sobe mais à direita.
  doc.lines(
    [
      [size * 0.16, size * 0.16],
      [size * 0.30, -size * 0.34],
    ],
    x + size * 0.26,
    y + size * 0.52,
  )
  doc.setLineWidth(0.2)
}

// Papel timbrado (só na 1ª página): marca + etiqueta do relatório, régua da
// marca, nome do restaurante em grande e um bloco de metadados à direita
// (NIF, morada, período, emissão, quem exportou, finalidade). Devolve o `y`
// onde o conteúdo pode começar.
function drawLetterhead(
  doc: JsPdfDoc,
  opts: {
    restaurantName: string
    nif?: string
    address?: string
    periodLabel: string
    issuedAt: string
    exportedBy: string
    purpose: string
  },
): number {
  const pageWidth = doc.internal.pageSize.getWidth()
  const rightX = pageWidth - MARGIN
  let y = 16

  //  Linha da marca
  drawBrandMark(doc, MARGIN, y - 5, 8)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(INK_RGB[0], INK_RGB[1], INK_RGB[2])
  doc.text('Manage', MARGIN + 11, y + 0.5)
  const manageWidth = doc.getTextWidth('Manage')
  doc.setTextColor(BRAND_RGB[0], BRAND_RGB[1], BRAND_RGB[2])
  doc.text('Eat', MARGIN + 11 + manageWidth + 0.6, y + 0.5)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(BRAND_RGB[0], BRAND_RGB[1], BRAND_RGB[2])
  doc.text('RELATÓRIO DE VENDAS', rightX, y - 1.5, { align: 'right', charSpace: 0.4 })

  y += 5
  doc.setDrawColor(BRAND_RGB[0], BRAND_RGB[1], BRAND_RGB[2])
  doc.setLineWidth(0.6)
  doc.line(MARGIN, y, rightX, y)
  y += 8

  //  Bloco de metadados à direita (invoice-style)
  const metaWidth = 78
  const metaX = rightX
  let metaY = y
  const metaLine = (label: string, value: string) => {
    const text = `${label}: ${value}`
    const lines = doc.splitTextToSize(text, metaWidth) as string[]
    lines.forEach((line) => {
      doc.text(line, metaX, metaY, { align: 'right' })
      metaY += 4
    })
  }
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(MUTED_RGB[0], MUTED_RGB[1], MUTED_RGB[2])
  if (opts.nif) metaLine('NIF', opts.nif)
  if (opts.address) metaLine('Morada', opts.address)
  metaLine('Período', opts.periodLabel)
  metaLine('Emitido', opts.issuedAt)
  metaLine('Exportado por', opts.exportedBy)
  metaLine('Finalidade', opts.purpose || '—')

  //  Nome do restaurante (H1), à esquerda, a par do bloco de metadados
  const nameMaxWidth = pageWidth - 2 * MARGIN - metaWidth - 8
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(INK_RGB[0], INK_RGB[1], INK_RGB[2])
  const nameLines = doc.splitTextToSize(opts.restaurantName, nameMaxWidth) as string[]
  let nameY = y + 3
  nameLines.forEach((line) => {
    doc.text(line, MARGIN, nameY)
    nameY += 7.5
  })
  // Período por baixo do nome (leitura rápida do intervalo).
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(MUTED_RGB[0], MUTED_RGB[1], MUTED_RGB[2])
  doc.text(opts.periodLabel, MARGIN, nameY + 1)

  // Fim do cabeçalho = o mais baixo dos dois blocos + folga; régua ténue a fechar.
  const headerBottom = Math.max(nameY + 3, metaY) + 3
  doc.setDrawColor(HAIRLINE_RGB[0], HAIRLINE_RGB[1], HAIRLINE_RGB[2])
  doc.setLineWidth(0.2)
  doc.line(MARGIN, headerBottom, rightX, headerBottom)
  doc.setTextColor(0, 0, 0)
  return headerBottom + 8
}

// Título de secção com uma pequena "aba" azul à esquerda. Reserva espaço antes
// (need) para o título não ficar sozinho no fim de uma página.
function sectionTitle(doc: JsPdfDoc, y: number, title: string, need = 26): number {
  const yy = ensureSpace(doc, y, need)
  doc.setFillColor(BRAND_RGB[0], BRAND_RGB[1], BRAND_RGB[2])
  doc.rect(MARGIN, yy - 3.4, 1.5, 4.4, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(INK_RGB[0], INK_RGB[1], INK_RGB[2])
  doc.text(title, MARGIN + 3.6, yy)
  return yy + 2
}

// Ajusta o tamanho de letra para o texto caber em `maxWidth` (usado nos valores
// grandes dos cartões de KPI  "12.205,57 €" não pode transbordar do cartão).
function fitFontSize(doc: JsPdfDoc, text: string, maxWidth: number, start: number, min: number): number {
  let size = start
  doc.setFontSize(size)
  while (size > min && doc.getTextWidth(text) > maxWidth) {
    size -= 0.5
    doc.setFontSize(size)
  }
  return size
}

type Kpi = { label: string; value: string; delta?: string }

// Fila de cartões de KPI (Receita, Nº pedidos, Ticket médio, ...). Cada cartão:
// caixa branca com borda ténue, etiqueta pequena, valor grande e variação
// (verde/vermelho) por baixo. Devolve o `y` abaixo da fila.
function drawKpiCards(doc: JsPdfDoc, y: number, cards: Kpi[]): number {
  const pageWidth = doc.internal.pageSize.getWidth()
  const contentWidth = pageWidth - 2 * MARGIN
  const gap = 3
  const n = cards.length
  const cardWidth = (contentWidth - gap * (n - 1)) / n
  const cardHeight = 22
  const top = ensureSpace(doc, y, cardHeight + 4)

  cards.forEach((card, i) => {
    const x = MARGIN + i * (cardWidth + gap)
    // Caixa
    doc.setFillColor(255, 255, 255)
    doc.setDrawColor(HAIRLINE_RGB[0], HAIRLINE_RGB[1], HAIRLINE_RGB[2])
    doc.setLineWidth(0.2)
    doc.roundedRect(x, top, cardWidth, cardHeight, 1.6, 1.6, 'FD')
    // Etiqueta
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.6)
    doc.setTextColor(MUTED_RGB[0], MUTED_RGB[1], MUTED_RGB[2])
    doc.text(card.label.toUpperCase(), x + 3, top + 5.5, { charSpace: 0.2 })
    // Valor (encolhe se for muito largo)
    const valueSize = fitFontSize(doc, card.value, cardWidth - 6, 12.5, 8)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(valueSize)
    doc.setTextColor(INK_RGB[0], INK_RGB[1], INK_RGB[2])
    doc.text(card.value, x + 3, top + 13)
    // Variação vs período anterior
    if (card.delta && card.delta !== '—') {
      const positive = card.delta.startsWith('+')
      const negative = card.delta.startsWith('-')
      if (positive) doc.setTextColor(21, 128, 61) // green-700
      else if (negative) doc.setTextColor(185, 28, 28) // red-700
      else doc.setTextColor(MUTED_RGB[0], MUTED_RGB[1], MUTED_RGB[2])
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.text(`${card.delta} vs ant.`, x + 3, top + 18.5)
    } else {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(MUTED_RGB[0], MUTED_RGB[1], MUTED_RGB[2])
      doc.text('—', x + 3, top + 18.5)
    }
  })
  doc.setTextColor(0, 0, 0)
  return top + cardHeight + 6
}

type TableConfig = {
  head: (string | number)[][]
  body: (string | number)[][]
  foot?: (string | number)[][]
  columnStyles?: UserOptions['columnStyles']
  fontSize?: number
}

// Tabela com o estilo único do relatório: cabeçalho azul da marca, texto branco,
// linhas alternadas com tinta clara da marca e rodapé (foot) em cinza. Reserva
// o fundo da página para o rodapé legal. Devolve o `finalY`.
function styledTable(
  doc: JsPdfDoc,
  autoTable: (doc: JsPdfDoc, options: UserOptions) => void,
  startY: number,
  cfg: TableConfig,
): number {
  const fontSize = cfg.fontSize ?? 8.6
  autoTable(doc, {
    startY,
    theme: 'striped',
    head: cfg.head,
    body: cfg.body,
    foot: cfg.foot,
    styles: {
      font: 'helvetica',
      fontSize,
      cellPadding: { top: 2, bottom: 2, left: 2.6, right: 2.6 },
      textColor: INK_RGB,
      lineColor: HAIRLINE_RGB,
      lineWidth: 0.1,
      overflow: 'linebreak',
      valign: 'middle',
    },
    headStyles: {
      fillColor: BRAND_RGB,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize,
      cellPadding: { top: 2.4, bottom: 2.4, left: 2.6, right: 2.6 },
      lineWidth: 0,
    },
    alternateRowStyles: { fillColor: BRAND_TINT_RGB },
    footStyles: {
      fillColor: [241, 243, 247],
      textColor: INK_RGB,
      fontStyle: 'bold',
      lineWidth: 0,
    },
    columnStyles: cfg.columnStyles,
    // O autoTable não propaga o `halign` das columnStyles ao cabeçalho nem ao
    // rodapé (só ao corpo)  alinhamos ambos à direita nas colunas numéricas,
    // para o cabeçalho e a linha de total ficarem a par dos valores.
    didParseCell: (data) => {
      if (data.section === 'body') return
      const columnAlign = cfg.columnStyles?.[data.column.index]?.halign
      if (columnAlign) data.cell.styles.halign = columnAlign
    },
    margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_RESERVE },
  })
  return lastTableY(doc)
}

// Mini-tabela de pares etiqueta/valor (Rodízio, Cancelamentos): sem cabeçalho,
// etiqueta cinza à esquerda e valor a negrito à direita. Ocupa meia página.
function labelValueTable(
  doc: JsPdfDoc,
  autoTable: (doc: JsPdfDoc, options: UserOptions) => void,
  startY: number,
  rows: (string | number)[][],
): number {
  const pageWidth = doc.internal.pageSize.getWidth()
  autoTable(doc, {
    startY,
    theme: 'plain',
    body: rows,
    styles: {
      font: 'helvetica',
      fontSize: 9,
      cellPadding: { top: 1.6, bottom: 1.6, left: 2.6, right: 2.6 },
      overflow: 'linebreak',
    },
    columnStyles: {
      0: { textColor: MUTED_RGB },
      1: { fontStyle: 'bold', halign: 'right', textColor: INK_RGB },
    },
    margin: { left: MARGIN, right: pageWidth / 2, bottom: FOOTER_RESERVE },
  })
  return lastTableY(doc)
}

// Constrói o documento jsPDF completo (sem descarregar). Exportado para permitir
// pré-visualizar/testar o PDF sem tocar no download do browser.
export async function buildSalesReportDoc(params: ReportParams): Promise<JsPdfDoc> {
  const { settings, orders, payments, menuItems, categories, from, to } = params
  const { profile = null, shifts = [], profiles = [], purpose = '' } = params

  // Import dinâmico: mantém o jsPDF fora do bundle inicial.
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const periodPayments = filterPaymentsByRange(payments, from, to)
  const filtered = ordersWithoutVoidedOnlyPayments(
    filterByRange(orders, from, to),
    periodPayments,
  )
  const defaultVatRate = settings.defaultVatRate ?? 0

  const summary = summarize(filtered, periodPayments)
  const vat = vatBreakdown(filtered, periodPayments, defaultVatRate)
  const series = dailySeries(filtered, from, to)
  const cats = categoryStats(filtered, menuItems, categories)
  const pays = paymentStats(periodPayments)
  const paysTotal = pays.reduce((s, p) => s + p.amount, 0)
  const covers = totalCovers(filtered)
  const cancel = cancellationStats(filtered)

  //  Top itens + matriz de menu (mesmos builders do ecrã)
  const topItems = itemStats(filtered).slice(0, 10)
  // O quadrante calcula-se sobre o menu TODO (mediana global), não só sobre o
  // top  senão a fronteira mudava com o slice. Indexamos por id para consultar.
  const matrix = menuMatrix(itemStats(filtered))
  const quadrantById = new Map(matrix.points.map((p) => [p.id, p.quadrant]))

  //  Receita por mesa (top mesas do rodízio)
  const tables = tableStats(filtered)
  const revenuePerCover = covers > 0 ? summary.revenue / covers : 0

  //  Período anterior (deltas vs ant.)
  // null quando não há datas (histórico completo)  aí não há base de comparação.
  const prev = previousRange(from, to)
  let prevSummary: ReturnType<typeof summarize> | null = null
  if (prev) {
    const prevPayments = filterPaymentsByRange(payments, prev.from, prev.to)
    const prevFiltered = ordersWithoutVoidedOnlyPayments(
      filterByRange(orders, prev.from, prev.to),
      prevPayments,
    )
    prevSummary = summarize(prevFiltered, prevPayments)
  }

  // Formata a variação % vs período anterior. "" quando não há base (null).
  function deltaLabel(current: number, previous: number | undefined): string {
    if (previous == null) return '—'
    const delta = pctDelta(current, previous)
    if (delta == null) return '—'
    const sign = delta >= 0 ? '+' : ''
    return `${sign}${delta.toFixed(1)}%`
  }

  //  Metadados de exportação (quem/quando/finalidade)
  const meta = buildExportMeta(profile, settings, from, to, purpose)
  const exportedByLabel = `${meta.exportedByUsername} (${meta.exportedByRole})`

  const doc = new jsPDF()

  //  Papel timbrado
  const periodLabel = from && to ? `${prettyDate(from)} a ${prettyDate(to)}` : 'Todo o histórico'
  let y = drawLetterhead(doc, {
    restaurantName: settings.name || 'Relatório de Vendas',
    nif: settings.nif || undefined,
    address: settings.address || undefined,
    periodLabel,
    issuedAt: new Date().toLocaleString('pt-PT'),
    exportedBy: exportedByLabel,
    purpose,
  })

  //  KPIs (cartões)
  y = sectionTitle(doc, y, 'Resumo', 34)
  y = drawKpiCards(doc, y + 2, [
    { label: 'Receita total', value: eur(summary.revenue), delta: deltaLabel(summary.revenue, prevSummary?.revenue) },
    { label: 'Nº de pedidos', value: String(summary.orders), delta: deltaLabel(summary.orders, prevSummary?.orders) },
    { label: 'Ticket médio', value: summary.orders > 0 ? eur(summary.avgTicket) : '—', delta: deltaLabel(summary.avgTicket, prevSummary?.avgTicket) },
    { label: 'Itens vendidos', value: String(summary.items), delta: deltaLabel(summary.items, prevSummary?.items) },
    { label: 'Pessoas (rodízio)', value: String(covers) },
  ])

  //  Resumo de IVA
  y = sectionTitle(doc, y, 'Resumo de IVA')
  const vatRows = vat.map((v) => [`${v.rate}%`, eur(v.base), eur(v.vat), eur(v.gross)])
  const vatTotals = vat.reduce(
    (acc, v) => ({ base: acc.base + v.base, vat: acc.vat + v.vat, gross: acc.gross + v.gross }),
    { base: 0, vat: 0, gross: 0 },
  )
  y = styledTable(doc, autoTable, y + 2, {
    head: [['Taxa', 'Base tributável', 'IVA', 'Total']],
    body: vatRows.length > 0 ? vatRows : [['—', eur(0), eur(0), eur(0)]],
    foot: [['Total', eur(vatTotals.base), eur(vatTotals.vat), eur(vatTotals.gross)]],
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
  }) + 8

  //  Vendas por dia
  if (series.length > 0) {
    y = sectionTitle(doc, y, 'Vendas por dia')
    y = styledTable(doc, autoTable, y + 2, {
      head: [['Dia', 'Receita', 'Pedidos', 'Itens']],
      body: series.map((p) => [p.day, eur(p.revenue), String(p.orders), String(p.items)]),
      fontSize: 8,
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    }) + 8
  }

  //  Vendas por categoria
  if (cats.length > 0) {
    y = sectionTitle(doc, y, 'Vendas por categoria')
    y = styledTable(doc, autoTable, y + 2, {
      head: [['Categoria', 'Qtd', 'Receita']],
      body: cats.map((c) => [c.name, String(c.qty), eur(c.revenue)]),
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
    }) + 8
  }

  //  Top itens (com o quadrante da matriz de menu)
  if (topItems.length > 0) {
    y = sectionTitle(doc, y, 'Top itens')
    y = styledTable(doc, autoTable, y + 2, {
      head: [['Item', 'Qtd', 'Receita', 'Quadrante']],
      body: topItems.map((item) => {
        const quadrant = quadrantById.get(item.id)
        const quadrantLabel = quadrant ? QUADRANT_META[quadrant].label : '—'
        return [item.name, String(item.qty), eur(item.revenue), quadrantLabel]
      }),
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
    }) + 8
  }

  //  Rodízio (só faz sentido se houve pessoas servidas)
  if (covers > 0) {
    y = sectionTitle(doc, y, 'Rodízio')
    y = labelValueTable(doc, autoTable, y + 2, [
      ['Pessoas servidas', String(covers)],
      ['Receita por pessoa', eur(revenuePerCover)],
    ]) + 4

    // Top mesas por receita (só as que tiveram pessoas/rodízio).
    const topTables = tables.filter((t) => t.covers > 0).slice(0, 8)
    if (topTables.length > 0) {
      y = styledTable(doc, autoTable, y, {
        head: [['Mesa', 'Pessoas', 'Receita']],
        body: topTables.map((t) => [String(t.tableNumber), String(t.covers), eur(t.revenue)]),
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      }) + 8
    }
  }

  //  Turnos (só se vierem turnos para o período)
  if (shifts.length > 0) {
    // Nome de quem abriu o turno (uid → username). Sem `profiles`, fica o uid.
    const uidNames = buildUidNameMap(profiles)
    // Receita por turno = soma dos pagamentos NÃO anulados com esse shiftId.
    const revenueByShift = new Map<string, number>()
    periodPayments.forEach((payment) => {
      if (!payment.shiftId) return
      if (isVoidedPayment(payment)) return
      revenueByShift.set(payment.shiftId, (revenueByShift.get(payment.shiftId) ?? 0) + payment.amount)
    })

    y = sectionTitle(doc, y, 'Turnos (ponto)')
    y = styledTable(doc, autoTable, y + 2, {
      head: [['Entrada', 'Saída', 'Horas', 'Quem', 'Receita']],
      body: shifts.map((shift) => {
        const openedAt = new Date(shift.openedAt).toLocaleString('pt-PT')
        const closedAt = shift.closedAt ? new Date(shift.closedAt).toLocaleString('pt-PT') : 'Em aberto'
        const openedByName = uidNames.get(shift.openedBy) ?? shift.openedBy
        const shiftRevenue = revenueByShift.get(shift.id) ?? 0
        // Duração do ponto: só conhecida depois de picar a saída.
        const hours = shiftDurationHours(shift)
        const hoursText = hours == null ? '—' : `${hours.toFixed(2)} h`
        return [openedAt, closedAt, hoursText, openedByName, eur(shiftRevenue)]
      }),
      fontSize: 8,
      columnStyles: { 2: { halign: 'right' }, 4: { halign: 'right' } },
    }) + 8
  }

  //  Meios de pagamento
  y = sectionTitle(doc, y, 'Meios de pagamento')
  y = styledTable(doc, autoTable, y + 2, {
    head: [['Método', 'Nº', 'Valor']],
    body: paysTotal > 0
      ? pays.map((p) => [PAYMENT_METHOD_LABEL[p.method], String(p.count), eur(p.amount)])
      : [['Sem pagamentos registados', '', '']],
    foot: paysTotal > 0 ? [['Total recebido', '', eur(paysTotal)]] : undefined,
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
  }) + 8

  //  Cancelamentos & descontos
  y = sectionTitle(doc, y, 'Cancelamentos & descontos')
  labelValueTable(doc, autoTable, y + 2, [
    ['Pedidos cancelados', `${cancel.cancelled} / ${cancel.total}`],
    ['Taxa de cancelamento', `${cancel.rate.toFixed(1)}%`],
    ['Valor perdido', eur(cancel.lostValue)],
    ['Descontos concedidos', eur(summary.discount)],
  ])

  //  Rodapé em todas as páginas: régua + avisos + nº de página
  // 1ª linha: sem validade fiscal. 2ª linha: confidencialidade RGPD (encurtada
  // de LEGAL_CONFIDENTIAL_RGPD para caber numa só linha).
  const pageCount = doc.getNumberOfPages()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const rgpdShort = LEGAL_CONFIDENTIAL_RGPD.split('.')[0] + '.'
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setDrawColor(HAIRLINE_RGB[0], HAIRLINE_RGB[1], HAIRLINE_RGB[2])
    doc.setLineWidth(0.2)
    doc.line(MARGIN, pageHeight - 14, pageWidth - MARGIN, pageHeight - 14)
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(7.5)
    doc.setTextColor(MUTED_RGB[0], MUTED_RGB[1], MUTED_RGB[2])
    doc.text(
      'Documento de gestão — sem validade fiscal. Não substitui fatura/recibo certificado pela AT.',
      MARGIN,
      pageHeight - 10,
    )
    doc.text(rgpdShort, MARGIN, pageHeight - 6.5)
    doc.text(`Página ${i}/${pageCount}`, pageWidth - MARGIN, pageHeight - 6.5, { align: 'right' })
    doc.setTextColor(0, 0, 0)
  }

  return doc
}

export async function buildSalesReportPdf(params: ReportParams): Promise<void> {
  const doc = await buildSalesReportDoc(params)
  const { from, to } = params
  const fileName = `relatorio-vendas-${from || 'inicio'}-${to || 'fim'}.pdf`
  // doc.save() usa o mesmo download web que não funciona no WebView nativo;
  // geramos o Blob e deixamos o downloadBlob escolher download (web) vs partilha (app).
  const pdfBlob = doc.output('blob')
  await downloadBlob(pdfBlob, fileName)
}
