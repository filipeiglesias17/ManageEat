import { supabase } from '../supabase'
import type { Shift } from '../../@types/shift'
import { dict } from '../i18n'
import {
  throwOnError,
  subscribeTable,
  EXPORT_PAGE_SIZE,
  localRangeToUtcWindow,
  fetchAllPages,
} from './base'

export function rowToShift(r: Record<string, unknown>): Shift {
  const shift: Shift = {
    id: r.id as string,
    openedAt: r.opened_at as string,
    openedBy: r.opened_by as string,
    status: r.status as Shift['status'],
  }
  if (r.closed_at != null) shift.closedAt = r.closed_at as string
  if (r.closed_by != null) shift.closedBy = r.closed_by as string
  if (r.auto_closed === true) shift.autoClosed = true
  return shift
}

export async function getShifts(): Promise<Shift[]> {
  const { data, error } = await supabase
    .from('shifts')
    .select('*')
    .order('opened_at', { ascending: false })
    .limit(100)
  throwOnError(error)
  return (data ?? []).map(rowToShift)
}

// Traz TODOS os turnos de um intervalo de dias LOCAIS, para os exports não
// ficarem cortados ao limite de 100 do getShifts(). Filtra por opened_at (o
// momento em que o turno abriu). fromIso/toIso são YYYY-MM-DD (ou strings
// vazias = "Tudo", sem limites de data). A janela UTC é alargada de propósito
// (±1 dia); o corte fino por dia local é feito a jusante.
export async function getShiftsInRange(fromIso: string, toIso: string): Promise<Shift[]> {
  const window = localRangeToUtcWindow(fromIso, toIso)

  const rows = await fetchAllPages<Record<string, unknown>>((offset) => {
    let query = supabase
      .from('shifts')
      .select('*')
      // Ordenação estável por (opened_at, id) → paginação keyset sem saltos
      // nem duplicados em empates de timestamp.
      .order('opened_at', { ascending: false })
      .order('id', { ascending: false })

    if (window.gte) query = query.gte('opened_at', window.gte)
    if (window.lte) query = query.lte('opened_at', window.lte)

    return query.range(offset, offset + EXPORT_PAGE_SIZE - 1)
  })

  return rows.map(rowToShift)
}

export function subscribeShifts(callback: (shifts: Shift[]) => void): () => void {
  return subscribeTable('shifts', getShifts, callback)
}

// O turno aberto do PRÓPRIO utilizador (relógio de ponto: máx. 1 por pessoa,
// garantido pelo índice único). Substitui o antigo getActiveShift() global —
// com turnos por empregado deixou de existir "o" turno do restaurante.
export async function getMyActiveShift(uid: string): Promise<Shift | null> {
  const { data, error } = await supabase
    .from('shifts')
    .select('*')
    .eq('status', 'open')
    .eq('opened_by', uid)
    .maybeSingle()
  throwOnError(error)
  if (!data) return null
  return rowToShift(data as Record<string, unknown>)
}

// Pede à BD para fechar turnos abertos há mais do que o limite das
// settings (max_shift_hours; vazio = desligado, no-op barato). Chamado de
// forma oportunística — arranque da app, antes de picar entrada e no painel
// de turnos — em vez de um cron. Devolve quantos turnos fechou.
export async function closeStaleShifts(): Promise<number> {
  const { data, error } = await supabase.rpc('close_stale_shifts')
  throwOnError(error)
  return typeof data === 'number' ? data : 0
}

export async function createShift(openedByUid: string): Promise<Shift> {
  // Fecha turnos esquecidos antes da guarda "já tens um turno aberto" —
  // senão quem não picou a saída ontem nunca mais conseguia picar a entrada.
  await closeStaleShifts().catch(() => {})
  // Guard amigável para a UI; o backstop real é o índice único (1 turno aberto
  // por pessoa), que também trava o duplo picar em dois dispositivos.
  const active = await getMyActiveShift(openedByUid)
  if (active) throw new Error(dict().errors.shiftAlreadyOpen)

  const { data, error } = await supabase
    .from('shifts')
    .insert({ opened_at: new Date().toISOString(), opened_by: openedByUid, status: 'open' })
    .select()
    .single()
  throwOnError(error)
  return rowToShift(data as Record<string, unknown>)
}

export async function closeShift(shiftId: string, closedByUid: string): Promise<void> {
  const { error } = await supabase.from('shifts').update({
    closed_at: new Date().toISOString(),
    closed_by: closedByUid,
    status: 'closed',
  }).eq('id', shiftId)
  throwOnError(error)
}
