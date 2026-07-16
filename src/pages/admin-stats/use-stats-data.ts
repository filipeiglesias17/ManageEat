// Dados COMPLETOS do período para as Análises — o fix do "teto dos 200".
//
// As subscrições em tempo real (props da página) estão limitadas a ORDERS_LIMIT
// (200) registos: chegam para as vistas operacionais, mas truncavam em silêncio
// os totais de qualquer período com mais movimento — a página mostrava menos de
// metade da receita real de 30 dias enquanto o export (que pagina tudo) dava os
// números certos. Este hook usa o MESMO caminho paginado do export
// (getOrdersInRange/getPaymentsInRange/getShiftsInRange), com:
//   - cache por intervalo (trocar de separador não re-busca)
//   - re-busca com debounce quando o realtime traz movimento novo
//   - fallback para as props limitadas se a busca falhar (com aviso — nunca
//     mostrar números truncados em silêncio)

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Order } from '../../@types/order'
import type { Payment } from '../../@types/payment'
import type { Shift } from '../../@types/shift'
import { getOrdersInRange, getPaymentsInRange, getShiftsInRange } from '../../lib/db'

export type StatsData = {
  orders: Order[]
  payments: Payment[]
  shifts: Shift[]
  // true enquanto a primeira busca deste intervalo não chegou (mostrar skeletons).
  loading: boolean
  // true quando a busca falhou e estamos a usar as props limitadas a 200.
  limited: boolean
  error: string | null
  refetch: () => void
}

type CacheEntry = { orders: Order[]; payments: Payment[]; shifts: Shift[] }

export function useStatsData(
  fromDate: string,
  toDate: string,
  liveOrders: Order[],
  livePayments: Payment[],
): StatsData {
  const cache = useRef(new Map<string, CacheEntry>())
  const [entry, setEntry] = useState<CacheEntry | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Número da busca em curso: uma resposta antiga que chegue tarde não pode
  // sobrepor-se à do intervalo atual.
  const fetchSeq = useRef(0)

  const key = `${fromDate}:${toDate}`

  const load = useCallback(async (force: boolean) => {
    const seq = ++fetchSeq.current
    const cached = cache.current.get(key)
    if (cached && !force) {
      setEntry(cached)
      setLoading(false)
      setError(null)
      return
    }
    // Sem cache: skeletons. Com cache (refresh do realtime): mantém o que está
    // no ecrã e troca quando os dados novos chegarem — sem piscar.
    if (!cached) setLoading(true)
    try {
      const [orders, payments, shifts] = await Promise.all([
        getOrdersInRange(fromDate, toDate),
        getPaymentsInRange(fromDate, toDate),
        getShiftsInRange(fromDate, toDate),
      ])
      if (seq !== fetchSeq.current) return
      const fresh = { orders, payments, shifts }
      cache.current.set(key, fresh)
      setEntry(fresh)
      setError(null)
    } catch (err) {
      if (seq !== fetchSeq.current) return
      setEntry(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (seq === fetchSeq.current) setLoading(false)
    }
  }, [key, fromDate, toDate])

  // Busca inicial e sempre que o intervalo muda.
  useEffect(() => {
    void load(false)
  }, [load])

  // Movimento novo em tempo real (pedido lançado, conta fechada) → re-busca o
  // intervalo atual com debounce, para o Resumo do dia acompanhar a sala sem
  // martelar a BD a cada evento.
  const liveSignature = `${liveOrders.length}:${liveOrders[0]?.id ?? ''}:${livePayments.length}:${livePayments[0]?.id ?? ''}`
  const lastSignature = useRef(liveSignature)
  useEffect(() => {
    if (lastSignature.current === liveSignature) return
    lastSignature.current = liveSignature
    const timer = window.setTimeout(() => { void load(true) }, 2000)
    return () => window.clearTimeout(timer)
  }, [liveSignature, load])

  const refetch = useCallback(() => { void load(true) }, [load])

  if (entry) {
    return { orders: entry.orders, payments: entry.payments, shifts: entry.shifts, loading: false, limited: false, error: null, refetch }
  }
  // Falhou (ou ainda a carregar): com erro caímos nas props limitadas a 200 —
  // o chamador mostra o aviso de truncagem em vez de números errados calados.
  return { orders: liveOrders, payments: livePayments, shifts: [], loading, limited: error !== null, error, refetch }
}
