import { memo } from 'react'
import { Ban, Undo2 } from 'lucide-react'
import type { Order } from '../@types/order'
import { safeQuantity, safeItemName } from '../lib/order-utils'
import { formatTime } from '../lib/helpers'
import { nextStatus, nextColor, prevStatus } from '../lib/order-status-ui'
import { hapticTap } from '../lib/haptics'
import { useDict, type Translation } from '../lib/i18n'
import { Button } from '@/components/ui/button'

// Tempo decorrido desde que o pedido foi criado, em texto curto para o card.
// Recebe o dicionário da cozinha como parâmetro porque esta função vive fora
// do componente (não pode chamar useDict diretamente).
function getElapsedTime(
  createdAt: string,
  now: Date,
  dictKitchen: Translation['kitchen'],
): { minutes: number; text: string } {
  const diffMs = now.getTime() - new Date(createdAt).getTime()
  const diffMins = Math.max(0, Math.floor(diffMs / 60_000))
  if (diffMins === 0) return { minutes: 0, text: dictKitchen.elapsedNow }
  return { minutes: diffMins, text: dictKitchen.elapsedMinutes(diffMins) }
}

interface OrderCardProps {
  order: Order
  now: Date
  onAdvance: (o: Order) => void
  onGoBack: (o: Order) => void
  onCancel: (o: Order) => void
}

// Card de um pedido no quadro Kanban da cozinha.
//
// Está em React.memo porque a cozinha recebe pedidos em tempo real: quando um
// pedido muda, só queremos re-desenhar esse card, não as ~15-20 cartas todas. O
// memo só funciona se as props forem estáveis — por isso os handlers chegam com
// useCallback e o `now` (que muda de 30 em 30s para atualizar o tempo) é
// partilhado por todos.
function OrderCardBase({ order, now, onAdvance, onGoBack, onCancel }: OrderCardProps) {
  const d = useDict()
  const next = nextStatus[order.status]
  const prev = prevStatus[order.status]

  const elapsed = getElapsedTime(order.createdAt, now, d.kitchen)
  // Urgência aplica-se a pedidos ainda na cozinha (pendente OU em preparação):
  // um prato que demora demasiado a sair também tem de saltar à vista. "Pronto"
  // já não conta (está feito, só falta entregar).
  const isActive = order.status === 'pending' || order.status === 'preparing'

  const isUrgentAmber = isActive && elapsed.minutes >= 10 && elapsed.minutes < 15
  const isUrgentRed = isActive && elapsed.minutes >= 15

  let borderClass = 'border-border'
  if (isUrgentRed) borderClass = 'animate-pulse-border border-red-500'
  else if (isUrgentAmber) borderClass = 'border-orange-500/60'

  let timeColorClass = 'text-muted-foreground'
  if (isUrgentRed) timeColorClass = 'text-red-600 dark:text-red-400 font-bold'
  else if (isUrgentAmber) timeColorClass = 'text-orange-600 dark:text-orange-400 font-medium'

  return (
    <div className={`bg-card border shadow-sm rounded-lg p-6 space-y-4 transition-all ${borderClass}`}>
      <div className="flex items-start justify-between">
        <span className="text-3xl font-black tracking-tight text-foreground">{d.kitchen.tableLabel(order.tableNumber)}</span>
        <div className="flex flex-col items-end gap-1">
          <span className="text-xs text-muted-foreground px-2 py-0.5 bg-muted rounded-full">{d.kitchen.sourceLabel[order.source]}</span>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={`text-sm font-semibold font-mono ${timeColorClass}`}>
              {elapsed.text}
            </span>
            <span className="text-[11px] text-muted-foreground">({formatTime(order.createdAt, true)})</span>
          </div>
        </div>
      </div>

      <ul className="space-y-3 border-t border-border pt-4">
        {order.items.map((item, i) => (
          <li key={i} className="flex flex-col gap-0.5">
            <span className="text-lg font-bold text-foreground">
              {safeQuantity(item.quantity)}× {safeItemName(item.menuItemName)}
            </span>
            {item.removedIngredients && item.removedIngredients.length > 0 && (
              <span className="text-xs font-semibold w-fit mt-0.5 px-2 py-0.5 rounded bg-destructive/10 border border-destructive/25 text-destructive">{d.kitchen.removedIngredientsBadge(item.removedIngredients.join(', '))}</span>
            )}
            {item.notes && (
              <span className="text-xs italic w-fit mt-0.5 px-2 py-0.5 rounded text-warning bg-warning/10 border border-warning/25">↳ {item.notes}</span>
            )}
          </li>
        ))}
      </ul>

      {next && (
        // Fica <button> cru: a cor vem de nextColor por estado, não cabe numa
        // variant do Button. Só o press foi normalizado ao 0.98 padrão da app.
        <button
          // Toque leve ao avançar o pedido (no-op na web): feedback imediato
          // no tablet da cozinha, mesmo antes do realtime confirmar.
          onClick={() => { void hapticTap(); onAdvance(order) }}
          className={`w-full py-4 rounded-lg font-bold text-lg tracking-wide transition-all active:scale-[0.98] shadow-sm cursor-pointer ${nextColor[order.status]}`}
        >
          {d.kitchen.nextLabel[order.status]}
        </button>
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        {prev && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onGoBack(order)}
            className="text-muted-foreground"
            title={d.kitchen.prevLabel[order.status]}
          >
            <Undo2 />
          </Button>
        )}
        {/* dark:hover repetido para ganhar ao dark:hover:bg-accent/50 do ghost. */}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => onCancel(order)}
          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 dark:hover:bg-destructive/10"
          aria-label={d.kitchen.cancelOrderLabel(order.tableNumber)}
          title={d.kitchen.cancelOrderTitle}
        >
          <Ban />
        </Button>
      </div>
    </div>
  )
}

export const OrderCard = memo(OrderCardBase)
