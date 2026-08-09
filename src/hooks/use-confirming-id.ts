import { useEffect, useRef, useState } from 'react'
import { toggleConfirmingId, clearConfirmingId } from '../lib/confirm-state'

// Estado do "confirmar inline por-linha": guarda o id da linha (não um
// boolean) para clicar em "apagar" numa linha não confirmar todas as outras.
// Cancela sozinho ao fim de `autoCancelMs` — se o utilizador clicar e se
// distrair, a app não fica presa em modo "a confirmar apagar" para sempre.
export function useConfirmingId(autoCancelMs = 4000) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function clearTimer() {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  // Primeiro clique no botão "apagar" de uma linha: entra em modo confirmação
  // (ou sai, se já estava a confirmar essa mesma linha).
  function requestConfirm(id: string) {
    setConfirmingId((prev) => toggleConfirmingId(prev, id))
  }

  function cancel() {
    clearTimer()
    setConfirmingId(null)
  }

  // Ação confirmada (2º clique): o chamador já executou o efeito, isto só
  // limpa o estado de confirmação da linha em questão.
  function confirmed(id: string) {
    clearTimer()
    setConfirmingId((prev) => clearConfirmingId(prev, id))
  }

  useEffect(() => {
    clearTimer()
    if (confirmingId === null) return
    timer.current = setTimeout(() => setConfirmingId(null), autoCancelMs)
    return clearTimer
  }, [confirmingId, autoCancelMs])

  return {
    confirmingId,
    isConfirming: (id: string) => confirmingId === id,
    requestConfirm,
    cancel,
    confirmed,
  }
}
