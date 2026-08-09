import { useEffect, useState } from 'react'
import { getCustomerOpenSession, type QrSession } from '../lib/db'

// Quanto tempo entre cada nova procura da sessão aberta da mesa. Fazemos polling
// porque o empregado pode abrir a mesa a qualquer momento (no mapa de mesas) e o
// cliente, no tablet, tem de ver a sessão aparecer sem dar refresh.
const POLL_INTERVAL_MS = 3000

// Procura, em tempo (quase) real, a sessão aberta da mesa fixa deste cliente.
// A mesa vem do profile (tablet do restaurante) — o cliente não a escolhe.
// Devolve a sessão encontrada (ou null) + os estados de loading/erro para a UI.
export function useOpenSession(
  tableNumber: number | null | undefined,
): { session: QrSession | null; loading: boolean; error: string } {
  const [session, setSession] = useState<QrSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    // Declarada antes do uso (no setInterval e na chamada inicial) para o
    // linter de hooks não se queixar de uso antes da declaração.
    async function loadOpenSession() {
      // Sem mesa atribuída não há nada a procurar: a sessão fica a null.
      if (tableNumber == null) {
        setSession(null)
        setLoading(false)
        return
      }

      try {
        const openSession = await getCustomerOpenSession()
        if (cancelled) return
        setSession(openSession)
        setError('')
      } catch (err) {
        if (cancelled) return
        setSession(null)
        setError(err instanceof Error ? err.message : 'Erro a procurar a sessão da mesa.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    setLoading(true)
    loadOpenSession()
    const interval = window.setInterval(loadOpenSession, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [tableNumber])

  return { session, loading, error }
}
