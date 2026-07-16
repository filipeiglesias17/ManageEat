import { useEffect, useState } from 'react'
import { Clock, LogIn, LogOut } from 'lucide-react'
import { createShift, closeShift } from '../lib/db'
import { formatDateTime, formatDuration } from '../lib/helpers'
import { useAuth } from '../lib/auth-context'
import { useMyShift } from '../lib/shift-context'
import { hapticSuccess } from '../lib/haptics'
import { useDict } from '../lib/i18n'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

// Barra do relógio de ponto, no topo do conteúdo de cada dashboard de staff
// (montada uma vez no Layout). Antes vivia apertada na navbar; aqui tem espaço
// para mostrar o turno ao vivo. O turno aberto é também o que liga os pagamentos
// a quem cobra — por isso está sempre à mão.
export function ShiftStatusBar() {
  const d = useDict()
  const { profile } = useAuth()
  // O turno vem do ShiftProvider (subscrição única para a app toda).
  const { myShift, shiftLoaded } = useMyShift()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Passo de confirmação inline da saída (em vez do confirm() nativo): o botão
  // "Picar saída" vira "Confirmar" + "Cancelar", para não picar por engano.
  const [confirmingOut, setConfirmingOut] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const hasShift = !!myShift

  // Cronómetro ao vivo: só corre quando há turno aberto, para não fazer render
  // a cada segundo à toa. O clamp em formatDuration trata do 1.º segundo em que
  // `now` ainda é o do arranque.
  useEffect(() => {
    if (!hasShift) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [hasShift])

  // Se o turno fechar (saída própria ou forçada), esconder o passo de confirmação.
  useEffect(() => {
    if (!hasShift) setConfirmingOut(false)
  }, [hasShift])

  async function handlePunchIn() {
    if (!profile) return
    setBusy(true)
    setError('')
    try {
      await createShift(profile.uid)
      // Confirmação tátil do picar (no-op na web) — o ponto é a ação de registo
      // mais importante do dia do empregado.
      void hapticSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : d.layout.shiftStatusBar.punchInError)
    } finally {
      setBusy(false)
    }
  }

  async function handlePunchOut() {
    if (!profile || !myShift) return
    setBusy(true)
    setError('')
    try {
      await closeShift(myShift.id, profile.uid)
      void hapticSuccess()
      setConfirmingOut(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : d.layout.shiftStatusBar.punchOutError)
    } finally {
      setBusy(false)
    }
  }

  // Só staff de sala pica ponto: o tablet de mesa (cliente) não tem turno e a
  // cozinha é uma conta partilhada que fica aberta nos ecrãs — não é uma
  // pessoa, não pica. Antes do primeiro fetch não sabemos o estado.
  if (!profile || profile.role === 'cliente' || profile.role === 'cozinha' || !shiftLoaded) return null

  return (
    // Empilha no telemóvel (texto em cima, ações por baixo) e alinha em linha a
    // partir de sm — senão os dois botões da confirmação esmagam o cronómetro.
    <div
      className={`animate-rise mb-6 flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center ${
        hasShift ? 'border-success/30 bg-success/5' : 'border-border bg-card'
      }`}
    >
      {/* Info: ícone + estado */}
      <div className="flex min-w-0 items-center gap-3 sm:flex-1">
        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-md ${
            hasShift ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'
          }`}
        >
          <Clock className="size-5" />
        </span>

        <div className="min-w-0">
          {hasShift ? (
            <>
              <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                {/* Ponto a pulsar = "estás em direto no turno". */}
                <span className="size-2 rounded-full bg-success animate-pulse" />
                {d.layout.shiftStatusBar.onShift}
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {/* "desde HH:MM" só cabe bem em ecrãs largos; no telemóvel fica só
                    o contador ao vivo, que é o que interessa ver a mexer. */}
                <span className="hidden sm:inline">
                  {d.layout.shiftStatusBar.sinceTime(formatDateTime(myShift.openedAt, { timeStyle: 'short' }))}{' '}
                </span>
                {d.layout.shiftStatusBar.timeAgo(formatDuration(now - new Date(myShift.openedAt).getTime(), { seconds: true }))}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-foreground">{d.layout.shiftStatusBar.offShift}</p>
              <p className="text-xs text-muted-foreground">
                {d.layout.shiftStatusBar.offShiftHint}
              </p>
            </>
          )}
          {error && (
            <p role="alert" className="mt-0.5 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      </div>

      {/* Ações (por baixo no telemóvel, à direita em sm+) */}
      <div className="flex shrink-0 items-center gap-2">
        {!hasShift && (
          <Button onClick={handlePunchIn} disabled={busy} className="w-full sm:w-auto">
            {busy ? <Spinner /> : <LogIn className="size-4" />}
            {d.layout.shiftStatusBar.punchInButton}
          </Button>
        )}

        {hasShift && !confirmingOut && (
          <Button variant="outline" size="sm" onClick={() => setConfirmingOut(true)} disabled={busy} className="w-full sm:w-auto">
            <LogOut className="size-4" />
            {d.layout.shiftStatusBar.punchOutButton}
          </Button>
        )}

        {hasShift && confirmingOut && (
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmingOut(false)} disabled={busy} className="flex-1 sm:flex-none">
              {d.common.cancel}
            </Button>
            <Button variant="destructive" size="sm" onClick={handlePunchOut} disabled={busy} className="flex-1 sm:flex-none">
              {busy ? <Spinner /> : <LogOut className="size-4" />}
              {d.layout.shiftStatusBar.confirmPunchOut}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
