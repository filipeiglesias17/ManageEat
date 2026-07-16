// Fonte ÚNICA de verdade dos metadados e avisos legais que vão no topo de
// qualquer ficheiro exportado (XLSX, PDF, CSV, SAF-T). Todos os formatos
// reutilizam isto para que o cabeçalho e a copy legal sejam sempre iguais.

import type { AppProfile, UserRole } from '../@types/user'
import type { RestaurantSettings } from '../@types/settings'

export type ExportMeta = {
  exportedByUsername: string
  exportedByRole: string // já em PT (ex: "Administrador")
  exportedAt: string // data/hora local PT-PT
  from: string // 'YYYY-MM-DD' ou ''
  to: string // 'YYYY-MM-DD' ou ''
  purpose: string // finalidade indicada pelo admin (pode ser '')
  restaurantName: string
  nif?: string
  address?: string
}

// Label em português para cada role. O resto da app guarda o role em inglês,
// mas no documento exportado mostramos o termo que o staff reconhece.
const ROLE_LABEL_PT: Record<UserRole, string> = {
  admin: 'Administrador',
  gerente: 'Gerente',
  empregado: 'Empregado',
  cozinha: 'Cozinha',
  cliente: 'Cliente',
}

// Texto usado quando não temos o dado (ex: profile null, ou role desconhecido).
const MISSING = '—'

function roleLabelPt(role: UserRole | undefined): string {
  if (!role) return MISSING
  return ROLE_LABEL_PT[role] ?? MISSING
}

// Constrói os metadados a partir do que a app já tem em mãos. O `profile` pode
// ser null (ex: ainda a carregar) — nesse caso usamos os fallbacks '—'.
export function buildExportMeta(
  profile: AppProfile | null,
  settings: RestaurantSettings,
  from: string,
  to: string,
  purpose: string,
): ExportMeta {
  return {
    exportedByUsername: profile?.username ?? MISSING,
    exportedByRole: roleLabelPt(profile?.role),
    // Data/hora local PT-PT do momento da exportação.
    exportedAt: new Date().toLocaleString('pt-PT'),
    from,
    to,
    purpose,
    restaurantName: settings.name ?? '',
    nif: settings.nif,
    address: settings.address,
  }
}

// Texto do período: com datas mostra "DD/MM/YYYY a DD/MM/YYYY"; sem ambas as
// datas assume que é o histórico completo.
function periodLabel(from: string, to: string): string {
  if (from && to) {
    return `${formatDatePt(from)} a ${formatDatePt(to)}`
  }
  return 'Todo o histórico'
}

// Converte 'YYYY-MM-DD' para 'DD/MM/YYYY'. Se vier algo inesperado, devolve o
// valor original em vez de partir a exportação.
function formatDatePt(isoDate: string): string {
  const parts = isoDate.split('-')
  if (parts.length !== 3) return isoDate
  const [year, month, day] = parts
  return `${day}/${month}/${year}`
}

// Linhas chave/valor reutilizáveis por PDF/XLSX/CSV. A linha do NIF só aparece
// quando há NIF, para não mostrar um campo vazio.
export function metaRows(meta: ExportMeta): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ['Exportado por', meta.exportedByUsername],
    ['Função', meta.exportedByRole],
    ['Data/hora', meta.exportedAt],
    ['Período', periodLabel(meta.from, meta.to)],
    ['Finalidade', meta.purpose || MISSING],
    ['Estabelecimento', meta.restaurantName || MISSING],
  ]
  if (meta.nif) {
    rows.push(['NIF', meta.nif])
  }
  return rows
}

// ── Copy legal (PT-PT) ──
// Fonte única dos avisos legais. Todos os formatos (XLSX, PDF, CSV, SAF-T)
// reutilizam estas constantes para mostrarem exatamente o mesmo texto.
//
// Cuidado ao editar: o rodapé do PDF (report-pdf.ts) usa só a PRIMEIRA frase do
// aviso RGPD (corta no primeiro ponto). Por isso a 1.ª frase tem de ser curta e
// fazer sentido sozinha, e não pode ter pontos a meio (ex.: abreviaturas).

// Este software não é certificado pela AT, por isso os ficheiros que gera são
// documentos de gestão interna, sem qualquer valor fiscal.
export const LEGAL_NO_FISCAL =
  'Documento de gestão interna, sem validade fiscal. Não substitui a fatura ou o recibo, que em Portugal têm de ser emitidos por software certificado pela AT (com ATCUD, QR Code e assinatura digital).'

// Os relatórios podem conter dados pessoais de trabalhadores (ex.: turnos,
// vendas por empregado), por isso ficam sujeitos ao RGPD.
export const LEGAL_CONFIDENTIAL_RGPD =
  'Documento confidencial. Contém dados pessoais de trabalhadores protegidos pelo RGPD. O acesso é restrito à finalidade de gestão do restaurante; recolha apenas os dados necessários e não partilhe nem guarde o ficheiro além do tempo indispensável a essa finalidade.'
