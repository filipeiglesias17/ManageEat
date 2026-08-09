import { supabase } from '../supabase'
import type { QrSession } from '../db'
import { dict } from '../i18n'
import { throwOnError, subscribeTable, type TableUpdate } from './base'

const SESSION_TTL_MS = 4 * 60 * 60 * 1000 // 4 horas

export function rowToSession(r: Record<string, unknown>): QrSession {
  const session: QrSession = {
    id: r.id as string,
    tableNumber: Number(r.table_number),
    createdAt: r.created_at as string,
  }
  if (r.expires_at != null) session.expiresAt = r.expires_at as string
  if (r.open != null) session.open = r.open as boolean
  if (r.opened_at != null) session.openedAt = r.opened_at as string
  if (r.access_code_hash != null) session.accessCodeHash = r.access_code_hash as string
  if (r.has_access_code != null) session.hasAccessCode = r.has_access_code as boolean
  if (r.code_failed_attempts != null) session.codeFailedAttempts = Number(r.code_failed_attempts)
  if (r.code_locked_until != null) session.codeLockedUntil = r.code_locked_until as string
  if (session.accessCodeHash) session.hasAccessCode = true
  if (r.mode != null) session.mode = r.mode as QrSession['mode']
  if (r.entry_price != null) session.entryPrice = Number(r.entry_price)
  if (r.headcount != null) session.headcount = Number(r.headcount)
  return session
}

function notExpired(s: QrSession, now: Date): boolean {
  return !s.expiresAt || new Date(s.expiresAt) > now
}

export async function getSessions(): Promise<QrSession[]> {
  // Colunas explícitas (sem access_code_hash): o hash nunca sai da BD para o
  // browser — o staff só precisa do booleano has_access_code (coluna gerada).
  // Os detalhes de lockout (code_failed_attempts/code_locked_until) vivem na
  // tabela session_code_attempts e chegam ao CLIENTE via get_public_session;
  // o mapa de mesas do staff não os usa, por isso não os pedimos aqui.
  const { data, error } = await supabase
    .from('sessions')
    .select(
      'id, table_number, created_at, expires_at, open, opened_at, has_access_code, mode, entry_price, headcount',
    )
  throwOnError(error)
  const now = new Date()
  return (data ?? []).map(rowToSession).filter((s) => s.open === true || notExpired(s, now))
}

export async function getSessionById(id: string): Promise<QrSession | null> {
  const { data, error } = await supabase
    .rpc('get_public_session', { session_id: id })
    .maybeSingle()
  throwOnError(error)
  if (!data) return null
  const session = rowToSession(data as Record<string, unknown>)
  if (session.expiresAt && new Date(session.expiresAt) < new Date()) return null
  return session
}

export async function getCustomerOpenSession(): Promise<QrSession | null> {
  const { data, error } = await supabase
    .rpc('get_customer_open_session')
    .maybeSingle()
  throwOnError(error)
  if (!data) return null
  return rowToSession(data as Record<string, unknown>)
}

export async function createSession(
  session: Omit<QrSession, 'expiresAt'>,
  options: { permanent?: boolean } = {},
): Promise<QrSession> {
  const base = {
    id: session.id,
    table_number: session.tableNumber,
    created_at: session.createdAt,
    open: session.open ?? null,
    opened_at: session.openedAt ?? null,
    mode: session.mode ?? null,
    entry_price: session.entryPrice ?? null,
    headcount: session.headcount ?? null,
  }

  function throwIfTableAlreadyOpen(error: { code?: string } | null): void {
    if (error && error.code === '23505') {
      throw new Error(dict().errors.sessionTableAlreadyOpen(session.tableNumber))
    }
  }

  if (options.permanent) {
    const { error } = await supabase.from('sessions').insert(base)
    throwIfTableAlreadyOpen(error)
    throwOnError(error)
    return { ...session }
  }

  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
  const { error } = await supabase.from('sessions').insert({ ...base, expires_at: expiresAt })
  throwIfTableAlreadyOpen(error)
  throwOnError(error)
  return { ...session, expiresAt }
}

export async function deleteSession(id: string): Promise<void> {
  const { error } = await supabase.from('sessions').delete().eq('id', id)
  throwOnError(error)
}

export async function updateSessionHeadcount(id: string, headcount: number): Promise<void> {
  // A entrada de rodízio vive na sessão e, denormalizada, no primeiro pedido
  // ativo. A RPC atualiza os dois de uma só vez (no Postgres) para os relatórios
  // e o SAF-T não divergirem da conta/pagamento quando o headcount muda.
  const { error } = await supabase.rpc('set_session_headcount', {
    p_session_id: id,
    p_headcount: headcount,
  })
  throwOnError(error)
}

export function subscribeSession(
  id: string,
  callback: (session: QrSession | null) => void,
  onError?: (error: Error) => void,
): () => void {
  let cancelled = false
  let latestLoadId = 0

  async function load() {
    latestLoadId++
    const currentLoadId = latestLoadId
    try {
      const session = await getSessionById(id)
      if (!cancelled && currentLoadId === latestLoadId) {
        callback(session)
      }
    } catch (err) {
      if (!cancelled && currentLoadId === latestLoadId) {
        onError?.(err as Error)
      }
    }
  }

  load()
  // Polling (não Realtime) porque a leitura pública passa pela RPC get_public_session:
  // o cliente é anónimo e a RLS de `sessions` (is_staff) bloquearia eventos Realtime.
  // 10s chega: os pedidos já são instantâneos (Realtime) e há revalidação no submit.
  const interval = window.setInterval(load, 10000)

  return () => {
    cancelled = true
    window.clearInterval(interval)
  }
}

export function subscribeSessions(
  callback: (sessions: QrSession[]) => void,
  onError?: (error: Error) => void,
): () => void {
  return subscribeTable('sessions', getSessions, callback, { onError })
}



export async function startSession(
  id: string,
  rodizio?: { entryPrice: number; headcount: number },
): Promise<void> {
  const row: Record<string, unknown> = {
    open: true,
    opened_at: new Date().toISOString(),
  }
  if (rodizio) {
    row.mode = 'rodizio'
    row.entry_price = rodizio.entryPrice
    row.headcount = rodizio.headcount
  }
  const { error } = await supabase.from('sessions').update(row as TableUpdate<'sessions'>).eq('id', id)
  throwOnError(error)
}

export async function closeSession(id: string): Promise<void> {
  const { error } = await supabase.from('sessions').update({
    open: false,
    access_code_hash: null,
    opened_at: null,
    mode: null,
    entry_price: null,
    headcount: null,
  }).eq('id', id)
  throwOnError(error)
}

export async function claimSessionWithCode(id: string, codeHash: string): Promise<void> {
  const { data, error } = await supabase.rpc('claim_session_with_code', {
    p_session_id: id,
    p_code_hash: codeHash,
  })
  throwOnError(error)

  const result = Array.isArray(data) ? data[0] as Record<string, unknown> | undefined : data as Record<string, unknown> | null
  if (!result || result.ok === true) return

  const reason = result.reason as string | undefined
  const errors = dict().errors
  if (reason === 'bloqueado') throw new Error(errors.claim_bloqueado)
  if (reason === 'codigo_incorreto') throw new Error(errors.claim_codigo_incorreto)
  if (reason === 'sessao_fechada') throw new Error(errors.claim_sessao_fechada)
  if (reason === 'sessao_inexistente_ou_expirada') {
    throw new Error(errors.claim_sessao_inexistente_ou_expirada)
  }
  if (reason === 'login_necessario') throw new Error(errors.claim_login_necessario)
  throw new Error(errors.unknown(reason ?? 'claim_session_with_code'))
}

export async function resetSessionAccessCode(id: string): Promise<void> {
  const { error } = await supabase.rpc('reset_session_access_code', {
    p_session_id: id,
  })
  throwOnError(error)
}
