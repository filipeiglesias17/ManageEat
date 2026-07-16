// Livro Excel multi-folha das Análises do admin. É a versão "rica" da
// exportação: cada secção de estatísticas vira uma folha, com colunas de
// dinheiro NUMÉRICAS (para o admin somar no Excel) e uma Capa com os metadados
// e os avisos legais.
//
// Decisões importantes:
// - A FORMA DOS DADOS está separada da renderização ExcelJS. `buildWorkbookData`
//   é uma função PURA (sem ExcelJS) que produz `SheetData[]` a partir dos
//   builders de `stats.ts`. É isto que os testes verificam. `buildSalesWorkbook`
//   só pega nesses dados, pinta-os com ExcelJS e descarrega o ficheiro.
// - A filtragem espelha EXATAMENTE a do `report-pdf.ts`, para os números do
//   Excel reconciliarem com o PDF e com o ecrã (mesmo filtro = mesmos totais).
// - Invariante de dinheiro: NÃO recalculamos totais à mão — reutilizamos os
//   builders de `stats.ts`, que já encerram a regra de negócio.
// - O ExcelJS é pesado, por isso é importado dinamicamente dentro da função —
//   não entra no bundle inicial (só é descarregado quando o admin exporta).

import type { Order } from '../@types/order'
import type { Payment } from '../@types/payment'
import type { Shift } from '../@types/shift'
import type { MenuItem } from '../@types/menu-item'
import type { Category } from '../@types/category'
import type { AppProfile } from '../@types/user'
import type { RestaurantSettings } from '../@types/settings'
import { PAYMENT_METHOD_LABEL } from '../@types/payment'
import {
  filterByRange,
  filterPaymentsByRange,
  ordersWithoutVoidedOnlyPayments,
  summarize,
  vatBreakdown,
  dailySeries,
  categoryStats,
  itemStats,
  menuMatrix,
  QUADRANT_META,
  paymentStats,
  totalCovers,
  tableStats,
  previousRange,
  pctDelta,
  isVoidedPayment,
} from './stats'
import {
  buildExportMeta,
  metaRows,
  LEGAL_NO_FISCAL,
  LEGAL_CONFIDENTIAL_RGPD,
} from './export-meta'
import { buildUidNameMap, shiftDurationHours, staffAuditStats } from './staff-audit'
import { downloadBlob } from './export-download'
import { BRAND_ARGB, BRAND_TINT_ARGB } from './brand'

// Cada chave identifica uma folha opcional. A Capa NÃO está aqui porque entra
// sempre, independentemente do que o admin escolher.
export type ExportSection =
  | 'resumo'
  | 'vendas-dia'
  | 'categorias'
  | 'itens'
  | 'pagamentos'
  | 'iva'
  | 'turnos'
  | 'rodizio'
  | 'auditoria'

export type WorkbookParams = {
  settings: RestaurantSettings
  profile: AppProfile | null
  orders: Order[]
  payments: Payment[]
  shifts: Shift[]
  menuItems: MenuItem[]
  categories: Category[]
  profiles: AppProfile[]
  from: string
  to: string
  purpose: string
  sections: ExportSection[] // quais folhas incluir (a Capa é SEMPRE incluída)
}

// Forma intermédia de uma folha, independente do ExcelJS. Os testes verificam
// esta estrutura; o `buildSalesWorkbook` é que a desenha no Excel.
//
// - `columns`: cada coluna tem um `header` legível, uma `key` (para casar com os
//   valores das `rows`), uma `width` opcional e a flag `money` (formata como
//   número de euros com `numFmt`, em vez de texto).
// - `rows`: array de objetos { key → valor }. Valores de dinheiro são NÚMEROS
//   crus (ex: 12.5), não strings "12,50 €", para o Excel poder somá-los.
// - `totals`: linha final opcional, a negrito (ex: total de IVA).
export type SheetData = {
  name: string
  columns: Array<{ header: string; key: string; width?: number; money?: boolean }>
  rows: Array<Record<string, string | number>>
  totals?: Record<string, string | number>
}

// Texto usado quando não há valor para mostrar (igual ao resto da app).
const MISSING = '—'

// Cor da marca (azul "Eat" do logótipo) no cabeçalho das tabelas, e a tinta
// clara da marca nas linhas alternadas. Fonte única em brand.ts.
const HEADER_FILL_ARGB = BRAND_ARGB
const STRIPE_FILL_ARGB = BRAND_TINT_ARGB
// Cinza-zinc ténue para as linhas/bordas das células.
const BORDER_ARGB = 'FFE4E4E7'

// Formato de número para colunas de dinheiro: "1 234,50 €". É um número cru com
// formatação, por isso o admin pode somar/filtrar no Excel.
const MONEY_FORMAT = '#,##0.00 "€"'

// ── Helpers locais (formatação e fallbacks) ──

// Converte um ISO de data/hora (ex: createdAt) para data/hora local PT-PT. Se
// vier vazio ou inválido, devolve "—" em vez de "Invalid Date".
function formatDateTimePt(iso: string | undefined): string {
  if (!iso) return MISSING
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return MISSING
  return date.toLocaleString('pt-PT')
}

// Resolve um uid de staff para nome legível, com fallback "—".
function staffName(uidNames: Map<string, string>, uid: string | undefined): string {
  if (!uid) return MISSING
  return uidNames.get(uid) ?? MISSING
}

// Variação percentual formatada para o Excel. Devolve "—" quando não há base de
// comparação (período anterior sem dados) — é o `pctDelta` a devolver null.
function formatDelta(current: number, previous: number): string {
  const delta = pctDelta(current, previous)
  if (delta === null) return MISSING
  const sign = delta >= 0 ? '+' : ''
  return `${sign}${delta.toFixed(1)}%`
}

// ── Folha: Capa (sempre incluída) ──
//
// Linhas label/valor dos metadados + os dois avisos legais. Usa colunas
// genéricas "campo"/"valor" porque é uma folha descritiva, não uma tabela de
// dados.
function buildCoverSheet(params: WorkbookParams): SheetData {
  const meta = buildExportMeta(
    params.profile,
    params.settings,
    params.from,
    params.to,
    params.purpose,
  )

  const rows: Array<Record<string, string | number>> = []
  metaRows(meta).forEach(([label, value]) => {
    rows.push({ campo: label, valor: value })
  })

  // Linha em branco a separar os metadados dos avisos legais.
  rows.push({ campo: '', valor: '' })
  rows.push({ campo: 'Aviso', valor: LEGAL_NO_FISCAL })
  rows.push({ campo: 'Confidencialidade', valor: LEGAL_CONFIDENTIAL_RGPD })

  return {
    name: 'Capa',
    columns: [
      { header: 'Campo', key: 'campo', width: 22 },
      { header: 'Valor', key: 'valor', width: 80 },
    ],
    rows,
  }
}

// ── Folha: Resumo (KPIs + variação vs período anterior) ──
function buildResumoSheet(params: WorkbookParams, filtered: Order[], periodPayments: Payment[]): SheetData {
  const summary = summarize(filtered, periodPayments)
  const covers = totalCovers(filtered)

  // Período anterior com a mesma duração, para a coluna de variação. Pode ser
  // null (ex: sem datas) — nesse caso não há comparação e mostramos "—".
  const prev = previousRange(params.from, params.to)
  let previousSummary: ReturnType<typeof summarize> | null = null
  if (prev) {
    const prevPayments = filterPaymentsByRange(params.payments, prev.from, prev.to)
    const prevFiltered = ordersWithoutVoidedOnlyPayments(
      filterByRange(params.orders, prev.from, prev.to),
      prevPayments,
    )
    previousSummary = summarize(prevFiltered, prevPayments)
  }

  // Pequeno helper para preencher a coluna de variação só quando há período
  // anterior; caso contrário "—".
  function deltaFor(currentValue: number, previousValue: number | undefined): string {
    if (previousSummary === null || previousValue === undefined) return MISSING
    return formatDelta(currentValue, previousValue)
  }

  const rows: Array<Record<string, string | number>> = [
    {
      indicador: 'Receita total',
      valor: summary.revenue,
      variacao: deltaFor(summary.revenue, previousSummary?.revenue),
    },
    {
      indicador: 'Nº de pedidos',
      valor: summary.orders,
      variacao: deltaFor(summary.orders, previousSummary?.orders),
    },
    {
      indicador: 'Ticket médio',
      valor: summary.avgTicket,
      variacao: deltaFor(summary.avgTicket, previousSummary?.avgTicket),
    },
    {
      indicador: 'Itens vendidos',
      valor: summary.items,
      variacao: deltaFor(summary.items, previousSummary?.items),
    },
    {
      indicador: 'Descontos concedidos',
      valor: summary.discount,
      variacao: deltaFor(summary.discount, previousSummary?.discount),
    },
    {
      indicador: 'Pessoas servidas (rodízio)',
      valor: covers,
      variacao: MISSING,
    },
  ]

  return {
    name: 'Resumo',
    columns: [
      { header: 'Indicador', key: 'indicador', width: 28 },
      { header: 'Valor', key: 'valor', width: 16, money: false },
      { header: 'vs período anterior (%)', key: 'variacao', width: 22 },
    ],
    rows,
  }
}

// ── Folha: Vendas por dia ──
function buildVendasDiaSheet(params: WorkbookParams, filtered: Order[]): SheetData {
  const series = dailySeries(filtered, params.from, params.to)
  const rows = series.map((point) => ({
    dia: point.day,
    receita: point.revenue,
    pedidos: point.orders,
    itens: point.items,
  }))

  return {
    name: 'Vendas por dia',
    columns: [
      { header: 'Dia', key: 'dia', width: 14 },
      { header: 'Receita', key: 'receita', width: 16, money: true },
      { header: 'Pedidos', key: 'pedidos', width: 12 },
      { header: 'Itens', key: 'itens', width: 12 },
    ],
    rows,
  }
}

// ── Folha: Categorias ──
function buildCategoriasSheet(params: WorkbookParams, filtered: Order[]): SheetData {
  const cats = categoryStats(filtered, params.menuItems, params.categories)
  const rows = cats.map((cat) => ({
    categoria: cat.name,
    qtd: cat.qty,
    receita: cat.revenue,
  }))

  return {
    name: 'Categorias',
    columns: [
      { header: 'Categoria', key: 'categoria', width: 28 },
      { header: 'Qtd', key: 'qtd', width: 12 },
      { header: 'Receita', key: 'receita', width: 16, money: true },
    ],
    rows,
  }
}

// ── Folha: Itens (com quadrante da matriz de menu) ──
function buildItensSheet(filtered: Order[]): SheetData {
  const items = itemStats(filtered)
  const matrix = menuMatrix(items)

  // Mapa id → quadrante, para anexar a etiqueta do quadrante a cada item sem
  // voltar a percorrer a matriz por cada linha.
  const quadrantById = new Map<string, string>()
  matrix.points.forEach((point) => {
    quadrantById.set(point.id, QUADRANT_META[point.quadrant].label)
  })

  const rows = items.map((item) => ({
    item: item.name,
    qtd: item.qty,
    receita: item.revenue,
    quadrante: quadrantById.get(item.id) ?? MISSING,
  }))

  return {
    name: 'Itens',
    columns: [
      { header: 'Item', key: 'item', width: 30 },
      { header: 'Qtd', key: 'qtd', width: 12 },
      { header: 'Receita', key: 'receita', width: 16, money: true },
      { header: 'Quadrante', key: 'quadrante', width: 16 },
    ],
    rows,
  }
}

// ── Folha: Pagamentos (por meio, com % do total e linha de total) ──
function buildPaymentsSheet(periodPayments: Payment[]): SheetData {
  const pays = paymentStats(periodPayments)
  const totalAmount = pays.reduce((sum, p) => sum + p.amount, 0)
  const totalCount = pays.reduce((sum, p) => sum + p.count, 0)

  const rows = pays.map((pay) => {
    let share = 0
    if (totalAmount > 0) {
      share = (pay.amount / totalAmount) * 100
    }
    return {
      metodo: PAYMENT_METHOD_LABEL[pay.method],
      numero: pay.count,
      valor: pay.amount,
      percentagem: `${share.toFixed(1)}%`,
    }
  })

  return {
    name: 'Pagamentos',
    columns: [
      { header: 'Método', key: 'metodo', width: 18 },
      { header: 'Nº', key: 'numero', width: 10 },
      { header: 'Valor', key: 'valor', width: 16, money: true },
      { header: '% do total', key: 'percentagem', width: 12 },
    ],
    rows,
    totals: {
      metodo: 'Total recebido',
      numero: totalCount,
      valor: totalAmount,
      percentagem: '100,0%',
    },
  }
}

// ── Folha: IVA (base, IVA, total + linha de totais + aviso legal) ──
function buildIvaSheet(filtered: Order[], periodPayments: Payment[], defaultVatRate: number): SheetData {
  const vat = vatBreakdown(filtered, periodPayments, defaultVatRate)

  // Tipamos `rows` à mão (em vez de deixar o map inferir números) porque as
  // linhas de aviso adicionadas no fim têm strings vazias nas colunas de dinheiro.
  const rows: Array<Record<string, string | number>> = vat.map((line) => ({
    taxa: `${line.rate}%`,
    base: line.base,
    iva: line.vat,
    total: line.gross,
  }))

  const totals = vat.reduce(
    (acc, line) => ({
      base: acc.base + line.base,
      iva: acc.iva + line.vat,
      total: acc.total + line.gross,
    }),
    { base: 0, iva: 0, total: 0 },
  )

  // O aviso "sem validade fiscal" entra como linha extra no fim, depois dos
  // totais, para deixar claro que o IVA aqui é informativo.
  rows.push({ taxa: '', base: '', iva: '', total: '' })
  rows.push({ taxa: LEGAL_NO_FISCAL, base: '', iva: '', total: '' })

  return {
    name: 'IVA',
    columns: [
      { header: 'Taxa', key: 'taxa', width: 60 },
      { header: 'Base tributável', key: 'base', width: 16, money: true },
      { header: 'IVA', key: 'iva', width: 16, money: true },
      { header: 'Total', key: 'total', width: 16, money: true },
    ],
    rows,
    totals: {
      taxa: 'Total',
      base: totals.base,
      iva: totals.iva,
      total: totals.total,
    },
  }
}

// ── Folha: Turnos (receita por turno a partir dos pagamentos do período) ──
function buildShiftsSheet(params: WorkbookParams, periodPayments: Payment[], uidNames: Map<string, string>): SheetData {
  // Só pagamentos ativos contam para a receita de cada turno — os anulados não
  // devem inflar a caixa de quem estava ao serviço.
  const activePeriodPayments = periodPayments.filter((payment) => !isVoidedPayment(payment))

  const rows = params.shifts.map((shift) => {
    const shiftPayments = activePeriodPayments.filter((payment) => payment.shiftId === shift.id)
    const revenue = shiftPayments.reduce((sum, payment) => sum + payment.amount, 0)
    // Horas do ponto: só os turnos fechados têm duração conhecida.
    const hours = shiftDurationHours(shift)
    return {
      abertura: formatDateTimePt(shift.openedAt),
      fecho: formatDateTimePt(shift.closedAt),
      horas: hours == null ? MISSING : Math.round(hours * 100) / 100,
      abertoPor: staffName(uidNames, shift.openedBy),
      fechadoPor: staffName(uidNames, shift.closedBy),
      pagamentos: shiftPayments.length,
      receita: revenue,
    }
  })

  return {
    name: 'Turnos',
    columns: [
      { header: 'Entrada', key: 'abertura', width: 20 },
      { header: 'Saída', key: 'fecho', width: 20 },
      { header: 'Horas', key: 'horas', width: 10 },
      { header: 'Aberto por', key: 'abertoPor', width: 18 },
      { header: 'Fechado por', key: 'fechadoPor', width: 18 },
      { header: 'Nº pagamentos', key: 'pagamentos', width: 14 },
      { header: 'Receita', key: 'receita', width: 16, money: true },
    ],
    rows,
  }
}

// ── Folha: Rodízio (pessoas, receita/pessoa, top mesas) ──
function buildRodizioSheet(filtered: Order[], periodPayments: Payment[]): SheetData {
  const covers = totalCovers(filtered)
  const summary = summarize(filtered, periodPayments)
  const totalRevenue = summary.revenue

  // Receita por pessoa: "—" quando não há pessoas servidas (evita divisão por 0).
  let revenuePerCover: string | number = MISSING
  if (covers > 0) {
    revenuePerCover = totalRevenue / covers
  }

  const tables = tableStats(filtered)

  const rows: Array<Record<string, string | number>> = [
    { etiqueta: 'Pessoas servidas (rodízio)', mesa: '', pessoas: covers, receita: '' },
    { etiqueta: 'Receita por pessoa', mesa: '', pessoas: '', receita: revenuePerCover },
    { etiqueta: '', mesa: '', pessoas: '', receita: '' },
    { etiqueta: 'Top mesas', mesa: '', pessoas: '', receita: '' },
  ]
  tables.forEach((table) => {
    rows.push({
      etiqueta: '',
      mesa: `Mesa ${table.tableNumber}`,
      pessoas: table.covers,
      receita: table.revenue,
    })
  })

  return {
    name: 'Rodízio',
    columns: [
      { header: 'Indicador', key: 'etiqueta', width: 28 },
      { header: 'Mesa', key: 'mesa', width: 14 },
      { header: 'Pessoas', key: 'pessoas', width: 12 },
      { header: 'Receita', key: 'receita', width: 16, money: true },
    ],
    rows,
  }
}

// ── Folha: Auditoria de staff (cabeçalho com aviso RGPD) ──
function buildAuditoriaSheet(params: WorkbookParams, uidNames: Map<string, string>): SheetData {
  // A auditoria conta cancelamentos, por isso usa os pedidos do período COM os
  // cancelados incluídos (filterByRange, sem remover via pagamentos).
  const auditOrders = filterByRange(params.orders, params.from, params.to)
  const periodPayments = filterPaymentsByRange(params.payments, params.from, params.to)
  const auditRows = staffAuditStats(auditOrders, periodPayments, params.shifts, uidNames)

  const rows: Array<Record<string, string | number>> = []
  // O aviso RGPD vai como primeira linha da folha (cabeçalho contextual),
  // porque esta folha contém dados pessoais de trabalhadores.
  rows.push({
    staff: LEGAL_CONFIDENTIAL_RGPD,
    cancelamentos: '',
    pagamentos: '',
    valor: '',
    anulacoes: '',
    turnosAbertos: '',
    turnosFechados: '',
    horas: '',
  })
  rows.push({
    staff: '',
    cancelamentos: '',
    pagamentos: '',
    valor: '',
    anulacoes: '',
    turnosAbertos: '',
    turnosFechados: '',
    horas: '',
  })
  auditRows.forEach((row) => {
    rows.push({
      staff: row.name,
      cancelamentos: row.cancellations,
      pagamentos: row.paymentsRegistered,
      valor: row.amountRegistered,
      anulacoes: row.paymentsVoided,
      turnosAbertos: row.shiftsOpened,
      turnosFechados: row.shiftsClosed,
      horas: Math.round(row.hoursWorked * 100) / 100,
    })
  })

  return {
    name: 'Auditoria',
    columns: [
      { header: 'Staff', key: 'staff', width: 60 },
      { header: 'Cancelamentos', key: 'cancelamentos', width: 14 },
      { header: 'Pagamentos', key: 'pagamentos', width: 12 },
      { header: 'Valor registado', key: 'valor', width: 16, money: true },
      { header: 'Anulações', key: 'anulacoes', width: 12 },
      { header: 'Turnos abertos', key: 'turnosAbertos', width: 14 },
      { header: 'Turnos fechados', key: 'turnosFechados', width: 14 },
      { header: 'Horas', key: 'horas', width: 10 },
    ],
    rows,
  }
}

// Constrói TODAS as folhas pedidas em `sections`, sempre com a Capa primeiro.
// É uma função pura: sem ExcelJS, sem download — só transforma os dados em
// `SheetData[]`. É isto que os testes do QA verificam.
export function buildWorkbookData(params: WorkbookParams): SheetData[] {
  // Filtragem ÚNICA, espelhada do report-pdf.ts para reconciliar com o ecrã.
  const periodPayments = filterPaymentsByRange(params.payments, params.from, params.to)
  const filtered = ordersWithoutVoidedOnlyPayments(
    filterByRange(params.orders, params.from, params.to),
    periodPayments,
  )
  const defaultVatRate = params.settings.defaultVatRate ?? 0
  const uidNames = buildUidNameMap(params.profiles)

  // A Capa entra sempre, à frente das folhas escolhidas.
  const sheets: SheetData[] = [buildCoverSheet(params)]

  // `includes` em cada secção: respeita a ordem definida acima (não a ordem em
  // que o admin as marcou), para o livro sair sempre consistente.
  if (params.sections.includes('resumo')) {
    sheets.push(buildResumoSheet(params, filtered, periodPayments))
  }
  if (params.sections.includes('vendas-dia')) {
    sheets.push(buildVendasDiaSheet(params, filtered))
  }
  if (params.sections.includes('categorias')) {
    sheets.push(buildCategoriasSheet(params, filtered))
  }
  if (params.sections.includes('itens')) {
    sheets.push(buildItensSheet(filtered))
  }
  if (params.sections.includes('pagamentos')) {
    sheets.push(buildPaymentsSheet(periodPayments))
  }
  if (params.sections.includes('iva')) {
    sheets.push(buildIvaSheet(filtered, periodPayments, defaultVatRate))
  }
  if (params.sections.includes('turnos')) {
    sheets.push(buildShiftsSheet(params, periodPayments, uidNames))
  }
  if (params.sections.includes('rodizio')) {
    sheets.push(buildRodizioSheet(filtered, periodPayments))
  }
  if (params.sections.includes('auditoria')) {
    sheets.push(buildAuditoriaSheet(params, uidNames))
  }

  return sheets
}

// Renderiza uma `SheetData` numa worksheet do ExcelJS. O objetivo é um livro que
// sai sempre bem, com poucos ou muitos dados:
// - larguras ajustadas ao conteúdo (nomes longos não ficam cortados) com teto,
//   e wrapText para o texto longo (avisos legais) quebrar em vez de desaparecer;
// - cabeçalho azul da marca, congelado, com texto branco;
// - linhas de dados alternadas (tinta clara da marca) e bordas ténues;
// - linha de total a negrito com régua superior;
// - filtro automático nas folhas de dados (sem total), para o contabilista
//   ordenar/filtrar colunas.
function renderSheet(
  // O tipo de Worksheet vem do módulo dinâmico; recebemos a worksheet já criada.
  worksheet: import('exceljs').Worksheet,
  sheet: SheetData,
): void {
  // A Capa é descritiva (campo/valor) — recebe um tratamento mais leve (sem
  // bandas nem bordas em toda a grelha).
  const isCover = sheet.name === 'Capa'
  const columnCount = sheet.columns.length

  // Largura por coluna ajustada ao conteúdo: máximo entre o cabeçalho, os
  // valores e o total, com um mínimo (a largura de design) e um teto de 70.
  const WIDTH_CAP = 70
  worksheet.columns = sheet.columns.map((column) => {
    let maxLen = String(column.header).length
    sheet.rows.forEach((row) => {
      const value = row[column.key]
      if (value != null && value !== '') maxLen = Math.max(maxLen, String(value).length)
    })
    if (sheet.totals) {
      const totalValue = sheet.totals[column.key]
      if (totalValue != null) maxLen = Math.max(maxLen, String(totalValue).length)
    }
    const base = column.width ?? 12
    // Colunas de dinheiro somam alguns caracteres (o "1 234,50 €" formatado é
    // mais largo do que o número cru).
    const padding = column.money ? 4 : 2
    const width = Math.min(WIDTH_CAP, Math.max(base, maxLen + padding))
    return { header: column.header, key: column.key, width }
  })

  // Congela a 1ª linha (cabeçalho) para ficar visível ao fazer scroll.
  worksheet.views = [{ state: 'frozen', ySplit: 1 }]

  // ── Cabeçalho: fundo azul da marca, texto branco a negrito ──
  const headerRow = worksheet.getRow(1)
  headerRow.height = 20
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL_ARGB } }
    cell.alignment = { vertical: 'middle', horizontal: 'left' }
    cell.border = { bottom: { style: 'thin', color: { argb: HEADER_FILL_ARGB } } }
  })

  // ── Linhas de dados ──
  sheet.rows.forEach((row) => {
    worksheet.addRow(row)
  })

  // ── Linha de total (opcional) ──
  let totalRowNumber = -1
  if (sheet.totals) {
    const totalRow = worksheet.addRow(sheet.totals)
    totalRowNumber = totalRow.number
  }

  // Formato de dinheiro nas colunas marcadas com `money`.
  sheet.columns.forEach((column) => {
    if (!column.money) return
    worksheet.getColumn(column.key).numFmt = MONEY_FORMAT
  })

  // ── Estilo linha-a-linha (bandas, bordas, alinhamento, total) ──
  const thinBorder = { style: 'hair' as const, color: { argb: BORDER_ARGB } }
  const lastRow = worksheet.rowCount
  for (let r = 2; r <= lastRow; r++) {
    const row = worksheet.getRow(r)
    const isTotals = r === totalRowNumber
    // Iteramos por índice de coluna (não eachCell) para pintar/emoldurar também
    // as células vazias (ex: linhas de separação, colunas de dinheiro em branco).
    for (let c = 1; c <= columnCount; c++) {
      const cell = row.getCell(c)
      cell.alignment = { vertical: 'middle', wrapText: true }
      if (!isCover) {
        cell.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder }
      }
      if (isTotals) {
        cell.font = { bold: true }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F3F7' } }
        cell.border = {
          top: { style: 'thin', color: { argb: HEADER_FILL_ARGB } },
          bottom: thinBorder,
          left: thinBorder,
          right: thinBorder,
        }
      } else if (!isCover && (r - 2) % 2 === 1) {
        // Banda nas linhas de dados ímpares (tinta clara da marca).
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STRIPE_FILL_ARGB } }
      }
    }
    // Na Capa, a coluna dos campos (esquerda) fica a negrito para se ler como
    // uma ficha de metadados.
    if (isCover) {
      row.getCell(1).font = { bold: true, color: { argb: 'FF3F3F46' } }
    }
  }

  // ── Filtro automático (só folhas de dados sem linha de total) ──
  // Com uma linha de total, o filtro esconderia o total ao filtrar — por isso
  // só o pomos onde não há total.
  if (!isCover && !sheet.totals && columnCount > 0) {
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columnCount },
    }
  }
}

// Constrói o livro Excel completo e descarrega-o no browser. Junta a parte pura
// (`buildWorkbookData`) à renderização ExcelJS e ao download.

// Normaliza o módulo CJS do exceljs: alguns runtimes embrulham-no num `.default`.
type ExcelJsApi = typeof import('exceljs')
function resolveExcelJs(mod: ExcelJsApi): ExcelJsApi {
  const wrapped = (mod as unknown as { default?: ExcelJsApi }).default
  if (wrapped && typeof wrapped.Workbook === 'function') return wrapped
  return mod
}

// Constrói o livro Excel e devolve o buffer (sem descarregar). Exportado para
// permitir pré-visualizar/testar o ficheiro fora do browser.
export async function buildSalesWorkbookBuffer(params: WorkbookParams): Promise<ArrayBuffer> {
  // Import dinâmico: mantém o ExcelJS fora do bundle inicial. O exceljs (4.x) é
  // CommonJS; conforme o interop do bundler/runtime, o `Workbook` pode vir na
  // raiz do namespace (Vite/esbuild) ou embrulhado em `.default` (Node ESM).
  // `resolveExcelJs` aceita as duas formas para o export nunca rebentar.
  const ExcelJS = resolveExcelJs(await import('exceljs'))

  const sheets = buildWorkbookData(params)

  const workbook = new ExcelJS.Workbook()
  workbook.creator = params.settings.name || 'manage-eat'
  workbook.created = new Date()

  sheets.forEach((sheet) => {
    const worksheet = workbook.addWorksheet(sheet.name)
    renderSheet(worksheet, sheet)
  })

  return workbook.xlsx.writeBuffer()
}

export async function buildSalesWorkbook(params: WorkbookParams): Promise<void> {
  const buffer = await buildSalesWorkbookBuffer(params)
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  await downloadBlob(blob, `analises-${params.from || 'inicio'}-${params.to || 'fim'}.xlsx`)
}
