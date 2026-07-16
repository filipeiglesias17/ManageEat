import { supabase } from '../supabase'
import type { Payment, PaymentVoidAction } from '../../@types/payment'
import {
  throwOnError,
  subscribeTable,
  ORDERS_LIMIT,
  EXPORT_PAGE_SIZE,
  localRangeToUtcWindow,
  fetchAllPages,
} from './base'

// requestId é o id estável da tentativa de fecho (gerado no cliente). Torna o
// pagamento idempotente: um retry com o mesmo requestId não cria 2.ª linha.
type CreatePaymentInput = Omit<Payment, 'id' | 'sessionId'> & { sessionId: string; requestId: string }

export function rowToPayment(r: Record<string, unknown>): Payment {
  const payment: Payment = {
    id: r.id as string,
    tableNumber: Number(r.table_number),
    amount: Number(r.amount),
    method: r.method as Payment['method'],
    createdAt: r.created_at as string,
    createdBy: r.created_by as string,
  }
  if (r.session_id != null) payment.sessionId = r.session_id as string
  if (r.shift_id != null) payment.shiftId = r.shift_id as string
  if (r.voided_at != null) payment.voidedAt = r.voided_at as string
  if (r.voided_by != null) payment.voidedBy = r.voided_by as string
  if (r.void_reason != null) payment.voidReason = r.void_reason as string
  if (r.account_opened_at != null) payment.accountOpenedAt = r.account_opened_at as string
  if (r.account_closed_at != null) payment.accountClosedAt = r.account_closed_at as string
  if (r.account_mode != null) payment.accountMode = r.account_mode as Payment['accountMode']
  if (r.account_entry_price != null) payment.accountEntryPrice = Number(r.account_entry_price)
  if (r.account_headcount != null) payment.accountHeadcount = Number(r.account_headcount)
  return payment
}

export async function createPayment(data: CreatePaymentInput): Promise<Payment> {
  const { requestId, ...rest } = data
  // id = requestId + upsert ignoreDuplicates: se a rede falhar e o staff repetir,
  // o 2.º insert é ignorado em vez de gravar a conta duas vezes (igual a createOrder).
  const row = {
    id: requestId,
    table_number: data.tableNumber,
    session_id: data.sessionId,
    shift_id: data.shiftId ?? null,
    amount: data.amount,
    method: data.method,
    created_at: data.createdAt,
    created_by: data.createdBy,
  }
  const { error } = await supabase.from('payments').upsert(row, { onConflict: 'id', ignoreDuplicates: true })
  throwOnError(error)
  return { id: requestId, ...rest }
}

export async function getPayments(): Promise<Payment[]> {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(ORDERS_LIMIT)
  throwOnError(error)
  return (data ?? []).map(rowToPayment)
}

// Traz TODOS os pagamentos de um intervalo de dias LOCAIS, para os exports não
// ficarem cortados aos 200 das subscrições. fromIso/toIso são YYYY-MM-DD (ou
// strings vazias = "Tudo", sem limites de data). A janela UTC é alargada de
// propósito (±1 dia); o corte fino por dia local é feito por filterPaymentsByRange.
export async function getPaymentsInRange(fromIso: string, toIso: string): Promise<Payment[]> {
  const window = localRangeToUtcWindow(fromIso, toIso)

  const rows = await fetchAllPages<Record<string, unknown>>((offset) => {
    let query = supabase
      .from('payments')
      .select('*')
      // Ordenação estável por (created_at, id) → paginação keyset sem saltos
      // nem duplicados em empates de timestamp.
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })

    if (window.gte) query = query.gte('created_at', window.gte)
    if (window.lte) query = query.lte('created_at', window.lte)

    return query.range(offset, offset + EXPORT_PAGE_SIZE - 1)
  })

  return rows.map(rowToPayment)
}

export function subscribePayments(
  callback: (payments: Payment[]) => void,
  onError?: (error: Error) => void,
): () => void {
  return subscribeTable('payments', getPayments, callback, { onError })
}

export async function voidPayment(
  paymentId: string,
  reason: string,
  action: PaymentVoidAction,
): Promise<void> {
  const { error } = await supabase.rpc('void_payment', {
    p_payment_id: paymentId,
    p_reason: reason,
    p_action: action,
  })
  throwOnError(error)
}
