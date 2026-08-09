import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { ToastContext, type ToastApi, type ToastVariant } from '../../hooks/use-toast'

// Toasts globais, feitos à mão (sem biblioteca): ~100 linhas cobrem o que a app
// precisa e mantêm a curva de easing assinatura. Empilham no fundo do ecrã
// (acima da safe-area), máximo 3 visíveis, saem sozinhos ao fim de 3,5s.

type ToastItem = {
  id: number
  variant: ToastVariant
  message: string
  // Em saída: troca a animação de entrada (rise) pela de saída (sink) antes de
  // remover do DOM — sem isto o toast desaparecia de repente.
  leaving: boolean
}

const AUTO_DISMISS_MS = 3500
// Duração do animate-sink (180ms) + folga para o frame final.
const EXIT_MS = 220
// Depois de tirar o rato de cima, o toast ainda fica um pouco antes de sair.
const RESUME_MS = 1500

const variantBorder: Record<ToastVariant, string> = {
  success: 'border-success/30 text-success',
  error: 'border-destructive/30 text-destructive',
  info: 'border-info/30 text-info',
}

const variantIcon: Record<ToastVariant, typeof Info> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  // Um timer de auto-dismiss por toast, para o hover poder pausar só esse.
  const timers = useRef(new Map<number, number>())

  const startLeaving = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)))
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, EXIT_MS)
  }, [])

  const scheduleDismiss = useCallback((id: number, ms: number) => {
    const handle = window.setTimeout(() => startLeaving(id), ms)
    timers.current.set(id, handle)
  }, [startLeaving])

  const push = useCallback((variant: ToastVariant, message: string) => {
    const id = nextId.current++
    setToasts((prev) => {
      const next = [...prev, { id, variant, message, leaving: false }]
      // Máximo 3: se transbordar, o mais antigo cai já (caso raro, sem animação).
      return next.length > 3 ? next.slice(next.length - 3) : next
    })
    scheduleDismiss(id, AUTO_DISMISS_MS)
  }, [scheduleDismiss])

  const api = useMemo<ToastApi>(() => ({
    success: (message) => push('success', message),
    error: (message) => push('error', message),
    info: (message) => push('info', message),
  }), [push])

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        // pointer-events-none no contentor para não bloquear cliques na app;
        // cada toast reativa os eventos só em si próprio.
        <div
          aria-live="polite"
          className="fixed bottom-0 inset-x-0 z-[60] pb-[calc(env(safe-area-inset-bottom)+1rem)] px-4 flex flex-col items-center gap-2 pointer-events-none"
        >
          {toasts.map((toast) => {
            const Icon = variantIcon[toast.variant]
            return (
              <div
                key={toast.id}
                onMouseEnter={() => {
                  const timer = timers.current.get(toast.id)
                  if (timer) clearTimeout(timer)
                }}
                onMouseLeave={() => scheduleDismiss(toast.id, RESUME_MS)}
                className={`pointer-events-auto flex items-center gap-2.5 bg-card border rounded-lg shadow-md px-4 py-2.5 text-sm w-full max-w-sm ${variantBorder[toast.variant]} ${toast.leaving ? 'animate-sink' : 'animate-rise'}`}
              >
                <Icon className="size-4 shrink-0" />
                <p className="text-foreground flex-1 min-w-0">{toast.message}</p>
                <button
                  type="button"
                  aria-label="Dispensar"
                  onClick={() => startLeaving(toast.id)}
                  className="text-muted-foreground hover:text-foreground transition-colors shrink-0 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <X className="size-4" />
                </button>
              </div>
            )
          })}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  )
}
