import { supabase } from '../supabase'
import type { Database } from '../database.types'
import { dict } from '../i18n'

// Atalhos para os tipos de escrita gerados (Insert/Update por tabela). Usados só
// nos poucos sítios em que o payload é construído à mão como Record<string,
// unknown> (updates parciais). O cast fica LOCAL — mantém o adapter (rowToX)
// como fronteira, é só de compilação e não muda runtime.
type Tables = Database['public']['Tables']
export type TableInsert<T extends keyof Tables> = Tables[T]['Insert']
export type TableUpdate<T extends keyof Tables> = Tables[T]['Update']

// Um código-máquina de erro do Postgres (RLS/triggers): 'err_<área>_<motivo>',
// com parâmetro opcional depois de um '|' (ex.: 'err_order_item_unavailable|Pizza').
// Ver supabase/migrations/20260707150000_error_codes.sql.
const ERROR_CODE_RE = /^err_[a-z0-9_]+$/

// Entrada do dicionário de erros: texto fixo OU função de interpolação (quando
// o código vem com parâmetro, ex.: o nome do item).
type ErrorDictEntry = string | ((param: string) => string)
type ErrorDict = Record<string, ErrorDictEntry | undefined> & { unknown: (code: string) => string }

// Traduz um código 'err_...' na mensagem do dicionário ATIVO no momento em que
// o erro é lançado (não pré-calculada no Postgres) — assim PT/EN respondem à
// troca de idioma sem tocar na BD. Código sem entrada no dicionário (função
// nova ainda por traduzir) cai no genérico `unknown`, que mostra o código para
// o staff poder reportar.
function resolveErrorMessage(code: string, param?: string): string {
  const errors = dict().errors as unknown as ErrorDict
  const entry = errors[code]
  if (typeof entry === 'function') return entry(param ?? '')
  if (typeof entry === 'string') return entry
  return errors.unknown(code)
}

// Erro de negócio vindo de um `raise exception 'err_...'` no Postgres (RLS/
// triggers). Guarda o código-máquina (para quem quiser decidir por código, ex.:
// mostrar um botão diferente) e o parâmetro cru; `message` já vem traduzido.
export class AppDbError extends Error {
  code: string
  param?: string

  constructor(code: string, param?: string) {
    super(resolveErrorMessage(code, param))
    this.name = 'AppDbError'
    this.code = code
    this.param = param
  }
}

// Lança em caso de erro Postgrest. Se a mensagem for um código-máquina
// 'err_...' (opcionalmente com '|parâmetro'), lança AppDbError com o texto
// traduzido; senão a mensagem passa tal e qual (comportamento antigo).
export function throwOnError(error: { message: string } | null): void {
  if (!error) return

  const raw = error.message
  const pipeIndex = raw.indexOf('|')
  const code = pipeIndex === -1 ? raw : raw.slice(0, pipeIndex)
  const param = pipeIndex === -1 ? undefined : raw.slice(pipeIndex + 1)

  if (ERROR_CODE_RE.test(code)) throw new AppDbError(code, param)
  throw new Error(raw)
}

// Nome de canal único por subscrição
let channelSeq = 0

// Carga inicial e re-busca a lista inteira a cada alteração
export function subscribeTable<T>(
  table: string,
  fetcher: () => Promise<T>,
  callback: (data: T) => void,
  options: { filter?: string; onError?: (error: Error) => void } = {},
): () => void {
  let latestLoadId = 0
  let active = true
  // A 1.ª leitura pode falhar num blip de arranque (ex.: o token de sessão do
  // Supabase ainda a assentar logo após o login). Sem isto, um feed ficava preso
  // "em erro" até ao próximo evento Realtime — que em salas paradas pode nunca vir.
  // Retentamos com recuo, limitado, para o feed recuperar sozinho sem martelar
  // numa falha real.
  let retries = 0
  const MAX_RETRIES = 3

  function load() {
    latestLoadId++
    const currentLoadId = latestLoadId
    fetcher()
      .then((data) => {
        if (active && currentLoadId === latestLoadId) {
          retries = 0
          callback(data)
        }
      })
      .catch((err) => {
        if (active && currentLoadId === latestLoadId) {
          options.onError?.(err as Error)
          if (retries < MAX_RETRIES) {
            retries++
            window.setTimeout(() => { if (active) load() }, 1500 * retries)
          }
        }
      })
  }
  load()

  const channel = supabase
    .channel(`${table}-${channelSeq++}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table, ...(options.filter ? { filter: options.filter } : {}) },
      () => load(),
    )
    .subscribe()

  return () => {
    active = false
    supabase.removeChannel(channel)
  }
}

export const ORDERS_LIMIT = 200

// ── Exportação por intervalo de datas ──────────────────────────────
//
// As subscrições ao vivo limitam-se a ORDERS_LIMIT (200) registos, o que chega
// para as vistas em tempo real mas trunca qualquer export de um período real.
// Os fetchers de export abaixo trazem TODOS os registos do intervalo, paginando
// por keyset. EXPORT_PAGE_SIZE = 1000 porque o PostgREST devolve no máximo ~1000
// linhas por pedido.
export const EXPORT_PAGE_SIZE = 1000

// Teto de segurança do export: um intervalo "Tudo" sem limites podia puxar a BD
// inteira numa só chamada (dump de histórico). Capamos e LANÇAMOS erro claro se
// for excedido — nunca truncamos em silêncio (isso corromperia totais de
// relatórios). Um restaurante normal não chega aqui num período real; se chegar,
// a mensagem pede para encurtar o intervalo. NB: a fronteira real é a RLS — isto
// é defesa-em-profundidade contra exports acidentais/abusivos no caminho da app.
export const EXPORT_MAX_ROWS = 50000

// Janela UTC alargada (±1 dia) à volta de um intervalo de dias LOCAIS.
//
// Porquê alargar: `fromIso`/`toIso` são dias LOCAIS (YYYY-MM-DD), mas o
// created_at/opened_at na BD está em UTC. Um pedido perto da meia-noite local
// pode cair no dia UTC anterior ou seguinte. Em vez de reimplementar timezone
// em SQL, trazemos um SUPERCONJUNTO seguro (mais 1 dia de cada lado) e deixamos
// o corte fino por dia local para `filterByRange`/`filterPaymentsByRange` em
// stats.ts. Strings vazias = "Tudo" → devolve null nesse lado (sem filtro).
export type UtcWindow = { gte: string | null; lte: string | null }

export function localRangeToUtcWindow(fromIso: string, toIso: string): UtcWindow {
  let gte: string | null = null
  let lte: string | null = null

  // Início do dia (fromIso − 1) em ISO: garante apanhar pedidos que em UTC
  // ficaram no dia anterior ao início local.
  if (fromIso) {
    const start = new Date(fromIso + 'T00:00:00')
    start.setDate(start.getDate() - 1)
    gte = start.toISOString()
  }

  // Fim do dia (toIso + 1) em ISO: idem para o lado de cima do intervalo.
  if (toIso) {
    const end = new Date(toIso + 'T23:59:59.999')
    end.setDate(end.getDate() + 1)
    lte = end.toISOString()
  }

  return { gte, lte }
}

// Builder de uma query PostgREST de uma página (offset → offset+size−1).
// Recebe o offset porque cada página precisa de uma query nova (o supabase-js
// não deixa reutilizar a mesma após .range()).
export type PageQuery<Row> = (offset: number) => PromiseLike<{
  data: Row[] | null
  error: { message: string } | null
}>

// Paginação keyset por (created_at desc, id desc): vai pedindo páginas de
// EXPORT_PAGE_SIZE até uma página vir com menos linhas que o tamanho da página
// (sinal de que chegámos ao fim). Acumula tudo numa só lista.
//
// Usamos .range() com offset crescente porque a ordenação estável por
// (created_at, id) evita saltar ou duplicar linhas em empates de timestamp.
export async function fetchAllPages<Row>(pageQuery: PageQuery<Row>): Promise<Row[]> {
  const allRows: Row[] = []
  let offset = 0

  // Sem condição infinita: paramos assim que uma página não encher a página.
  while (true) {
    const { data, error } = await pageQuery(offset)
    throwOnError(error)

    const rows = data ?? []
    allRows.push(...rows)

    // Página incompleta = última página. Saímos.
    if (rows.length < EXPORT_PAGE_SIZE) return allRows

    // Guarda: passámos o teto → erro claro em vez de truncar/puxar tudo.
    if (allRows.length > EXPORT_MAX_ROWS) {
      throw new Error(dict().errors.exportTooLarge(EXPORT_MAX_ROWS))
    }

    offset += EXPORT_PAGE_SIZE
  }
}
