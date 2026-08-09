// Exportação "dados em bruto por dataset" das Análises do admin em CSV. Ao
// contrário do XLSX (um único livro multi-folha), aqui cada secção pedida vira
// UM ficheiro CSV separado, para quem prefere abrir/importar cada conjunto de
// dados à parte (Excel, pandas, etc.).
//
// Decisões importantes:
// - É uma função PURA: monta { filename, text } por ficheiro e NÃO descarrega
//   nada. Quem chama (a UI) é que faz o download de cada ficheiro.
// - O contrato de entrada é IDÊNTICO ao do XLSX: reutilizamos os mesmos
//   `WorkbookParams` e `ExportSection` do report-xlsx.ts, para os dois formatos
//   nunca divergirem.
// - A FILTRAGEM espelha EXATAMENTE a do report-xlsx.ts / report-pdf.ts, para os
//   números do CSV reconciliarem com o Excel, o PDF e o ecrã (mesmo filtro =
//   mesmos totais).
// - Invariante de dinheiro: NÃO recalculamos totais à mão  reutilizamos os
//   builders CSV de stats.ts, que já encerram a regra de negócio.

import type { Order } from '../@types/order'
import type { WorkbookParams } from './report-xlsx'
import {
  filterByRange,
  filterPaymentsByRange,
  ordersWithoutVoidedOnlyPayments,
  dailySeries,
  itemStats,
  categoryStats,
  paymentStats,
  vatBreakdown,
  buildDailyCsv,
  buildItemsCsv,
  buildCategoriesCsv,
  buildPaymentsCsv,
  buildVatCsv,
  buildStaffAuditCsv,
} from './stats'
import {
  buildExportMeta,
  metaRows,
  LEGAL_NO_FISCAL,
  LEGAL_CONFIDENTIAL_RGPD,
} from './export-meta'
import { buildUidNameMap, staffAuditStats } from './staff-audit'

// Um ficheiro CSV pronto a descarregar: o nome do ficheiro e o seu conteúdo.
export type CsvFile = { filename: string; text: string }

// Monta o sufixo do nome do ficheiro com o período. Sem datas, usamos
// 'inicio'/'fim' para o nome continuar legível (ex: "...-inicio-fim.csv").
function periodSuffix(from: string, to: string): string {
  const start = from || 'inicio'
  const end = to || 'fim'
  return `${start}-${end}`
}

// Monta o nome final de cada ficheiro a partir do dataset e do período.
function csvFilename(dataset: string, from: string, to: string): string {
  return `analises-${dataset}-${periodSuffix(from, to)}.csv`
}

// Constrói um ficheiro CSV por cada secção pedida em `params.sections` QUE TENHA
// um dataset CSV próprio. As secções sem builder CSV ('resumo', 'turnos',
// 'rodizio') são ignoradas de propósito (ficam só no XLSX/PDF).
//
// É uma função pura: não descarrega nada  devolve { filename, text } por
// ficheiro para a UI tratar do download.
export function buildCsvFiles(params: WorkbookParams): CsvFile[] {
  const {
    settings,
    profile,
    orders,
    payments,
    shifts,
    menuItems,
    categories,
    profiles,
    from,
    to,
    purpose,
    sections,
  } = params

  //  Filtragem ÚNICA, espelhada do XLSX/PDF (reconciliação)
  const periodPayments = filterPaymentsByRange(payments, from, to)
  const filtered = ordersWithoutVoidedOnlyPayments(
    filterByRange(orders, from, to),
    periodPayments,
  )
  const defaultVatRate = settings.defaultVatRate ?? 0

  //  Comentários de cabeçalho (metadados + aviso legal)
  // Cada builder CSV prefixa estes comentários como linhas `# ...`, ignoradas
  // por Excel/pandas. Achatamos `metaRows` para "chave: valor".
  const meta = buildExportMeta(profile, settings, from, to, purpose)
  const baseComments = [
    ...metaRows(meta).map(([key, value]) => `${key}: ${value}`),
    LEGAL_NO_FISCAL,
  ]

  const files: CsvFile[] = []

  // `includes` em cada secção: respeita a ordem definida aqui (não a ordem em
  // que o admin as marcou), para a exportação sair sempre consistente.
  if (sections.includes('vendas-dia')) {
    const text = buildDailyCsv(dailySeries(filtered, from, to), baseComments)
    files.push({ filename: csvFilename('vendas-dia', from, to), text })
  }
  if (sections.includes('itens')) {
    const text = buildItemsCsv(itemStats(filtered), baseComments)
    files.push({ filename: csvFilename('itens', from, to), text })
  }
  if (sections.includes('categorias')) {
    const text = buildCategoriesCsv(
      categoryStats(filtered, menuItems, categories),
      baseComments,
    )
    files.push({ filename: csvFilename('categorias', from, to), text })
  }
  if (sections.includes('pagamentos')) {
    const text = buildPaymentsCsv(paymentStats(periodPayments), baseComments)
    files.push({ filename: csvFilename('pagamentos', from, to), text })
  }
  if (sections.includes('iva')) {
    const text = buildVatCsv(vatBreakdown(filtered, periodPayments, defaultVatRate), baseComments)
    files.push({ filename: csvFilename('iva', from, to), text })
  }
  if (sections.includes('auditoria')) {
    // A auditoria conta cancelamentos, por isso usa os pedidos do período COM os
    // cancelados incluídos (filterByRange, sem remover via pagamentos).
    const auditOrders: Order[] = filterByRange(orders, from, to)
    const uidNames = buildUidNameMap(profiles)
    const auditRows = staffAuditStats(auditOrders, periodPayments, shifts, uidNames)
    // Dados pessoais de trabalhadores → acrescenta o aviso RGPD aos comentários.
    const auditComments = [...baseComments, LEGAL_CONFIDENTIAL_RGPD]
    files.push({
      filename: csvFilename('auditoria', from, to),
      text: buildStaffAuditCsv(auditRows, auditComments),
    })
  }

  // Fallback: se nenhuma secção pedida tem dataset CSV (ex: só 'resumo' /
  // 'turnos' / 'rodizio'), o utilizador nunca deve receber 0 ficheiros  damos
  // o CSV de vendas por dia como conjunto de dados base.
  if (files.length === 0) {
    const text = buildDailyCsv(dailySeries(filtered, from, to), baseComments)
    files.push({ filename: csvFilename('vendas-dia', from, to), text })
  }

  return files
}
