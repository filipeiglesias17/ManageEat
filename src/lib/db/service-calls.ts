import { supabase } from '../supabase'
import type { ServiceCall, ServiceCallStatus, ServiceCallType } from '../../@types/service-call'
import { throwOnError, subscribeTable } from './base'

type CreateServiceCallInput = {
  id: string
  tableNumber: number
  type: ServiceCallType
  sessionId: string
}

export function rowToServiceCall(r: Record<string, unknown>): ServiceCall {
  const call: ServiceCall = {
    id: r.id as string,
    tableNumber: Number(r.table_number),
    type: r.type as ServiceCallType,
    createdAt: r.created_at as string,
    status: r.status as ServiceCallStatus,
  }
  if (r.session_id != null) call.sessionId = r.session_id as string
  if (r.acknowledged_at != null) call.acknowledgedAt = r.acknowledged_at as string
  if (r.acknowledged_by != null) call.acknowledgedBy = r.acknowledged_by as string
  if (r.resolved_at != null) call.resolvedAt = r.resolved_at as string
  if (r.resolved_by != null) call.resolvedBy = r.resolved_by as string
  return call
}

export async function getServiceCalls(): Promise<ServiceCall[]> {
  const { data, error } = await supabase.from('service_calls').select('*')
  throwOnError(error)
  return (data ?? []).map(rowToServiceCall)
}

export function subscribeServiceCalls(
  callback: (calls: ServiceCall[]) => void,
  onError?: (error: Error) => void,
): () => void {
  return subscribeTable('service_calls', getServiceCalls, callback, { onError })
}

export async function createServiceCall(input: CreateServiceCallInput): Promise<void> {
  const { error } = await supabase.from('service_calls').insert({
    id: input.id,
    table_number: input.tableNumber,
    type: input.type,
    created_at: new Date().toISOString(),
    session_id: input.sessionId,
  })
  throwOnError(error)
}

export async function acknowledgeServiceCall(id: string): Promise<void> {
  const { error } = await supabase.from('service_calls').update({ status: 'acknowledged' }).eq('id', id)
  throwOnError(error)
}

export async function resolveServiceCall(id: string): Promise<void> {
  const { error } = await supabase.from('service_calls').update({ status: 'resolved' }).eq('id', id)
  throwOnError(error)
}

export async function resolveServiceCallsForSession(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from('service_calls')
    .update({ status: 'resolved' })
    .eq('session_id', sessionId)
    .in('status', ['open', 'acknowledged'])
  throwOnError(error)
}
