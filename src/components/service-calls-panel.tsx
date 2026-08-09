import { useMemo, useState } from 'react'
import { Bell, Receipt, Check, UserCheck } from 'lucide-react'
import { acknowledgeServiceCall, resolveServiceCall } from '../lib/db'
import { formatTime } from '../lib/helpers'
import { useAnimatedList } from '../hooks/use-animated-list'
import { useMyShift } from '../lib/shift-context'
import { SHIFT_GATE_MESSAGE } from '../lib/shift-gate'
import type { ServiceCall } from '../@types/service-call'
import { Button } from '@/components/ui/button'
import { BetaBadge } from './ui/beta-badge'
import { betaFeature } from '../lib/beta-features'
import { useDict } from '../lib/i18n'

// Painel ao vivo das chamadas de mesa (chamar empregado / pedir a conta).
// Recebe as chamadas do dashboard (fonte única) e resolve-as. O som/alerta de
// uma chamada nova é do motor de notificações, não deste painel.

export function ServiceCallsPanel({ calls }: { calls: ServiceCall[] }) {
  // useDict (não só dict()) para o componente re-renderizar ao trocar de
  // idioma — o hint do BetaBadge (betaFeature) não subscreve isso sozinho.
  const d = useDict()
  const callLabel: Record<ServiceCall['type'], string> = {
    waiter: d.employee.calls.typeLabel.waiter,
    bill: d.employee.calls.typeLabel.bill,
  }
  // Atender chamadas é uma operação; fora de turno só é permitida a consulta.
  const { canOperate } = useMyShift()
  const [handlingId, setHandlingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  // Mais antigas primeiro (FIFO): a mesa que espera há mais tempo fica no topo.
  // useMemo: o useAnimatedList compara a lista por referência — sem memo, o
  // filter/sort criava um array novo a cada render e re-corria o efeito.
  const sorted = useMemo(
    () => calls.filter((call) => call.status !== 'resolved').sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    ),
    [calls]
  )
  // Chamadas resolvidas saem com animação em vez de desaparecerem de repente.
  const entries = useAnimatedList(sorted, (call) => call.id)

  async function handleCallAction(callId: string, action: 'acknowledge' | 'resolve') {
    setError('')
    setHandlingId(callId)
    try {
      if (action === 'acknowledge') {
        await acknowledgeServiceCall(callId)
      } else {
        await resolveServiceCall(callId)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(d.employee.calls.updateError(message))
    } finally {
      setHandlingId(null)
    }
  }

  // Sem chamadas (nem nenhuma a acabar de sair), não ocupa espaço no dashboard.
  if (entries.length === 0) return null

  return (
    <section className="border border-warning/40 bg-warning/10 rounded-sm p-4 space-y-3">
      <h2 className="text-sm font-semibold text-warning flex items-center gap-2">
        <Bell className="size-4" />
        {d.employee.calls.heading(sorted.length)}
        <BetaBadge hint={betaFeature('notifications').limitation} />
      </h2>{/* contagem usa a lista real (sem as que estão a sair) */}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {!canOperate && <p className="text-xs text-warning">{SHIFT_GATE_MESSAGE}</p>}
      <div className="space-y-2">
        {entries.map(({ item: call, key, leaving }) => (
          <div
            key={key}
            className={`grid transition-[grid-template-rows] duration-200 ease-[var(--ease-out-strong)] ${leaving ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'}`}
          >
          <div className={`overflow-hidden ${leaving ? 'animate-sink' : ''}`}>
          <div
            className="flex flex-wrap items-center gap-3 bg-card border border-border rounded-sm px-3 py-2"
          >
            {call.type === 'bill'
              ? <Receipt className="size-4 text-warning shrink-0" />
              : <Bell className="size-4 text-warning shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{d.employee.tableLabel(call.tableNumber)}</p>
              <p className="text-xs text-muted-foreground">
                {callLabel[call.type]} · {formatTime(call.createdAt)}
                {call.status === 'acknowledged' && d.employee.calls.acknowledgedSuffix}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {call.status === 'open' && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => handleCallAction(call.id, 'acknowledge')}
                  disabled={handlingId === call.id || !canOperate}
                  title={canOperate ? undefined : SHIFT_GATE_MESSAGE}
                >
                  <UserCheck className="size-3.5" />
                  {d.employee.calls.acknowledge}
                </Button>
              )}
              {/* Hover a primary mantém-se: sinaliza a ação que fecha a chamada. */}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="hover:bg-primary hover:text-primary-foreground"
                onClick={() => handleCallAction(call.id, 'resolve')}
                disabled={handlingId === call.id || !canOperate}
                title={canOperate ? undefined : SHIFT_GATE_MESSAGE}
              >
                <Check className="size-3.5" />
                {d.employee.calls.resolve}
              </Button>
            </div>
          </div>
          </div>
          </div>
        ))}
      </div>
    </section>
  )
}
