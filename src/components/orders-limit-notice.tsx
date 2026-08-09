import { Popover } from 'radix-ui'
import { Info } from 'lucide-react'
import { ORDERS_LIMIT } from '../lib/db'
import { useDict } from '../lib/i18n'

// As vistas operacionais (cozinha, admin, mapa de mesas) só carregam os
// ORDERS_LIMIT pedidos mais recentes. Quando atingimos esse teto pode haver
// pedidos mais antigos que não aparecem. Antes mostrávamos uma barra de aviso
// grande em cada vista; agora é um ícone de informação discreto que abre a
// explicação ao toque/clique (Popover, não Tooltip, porque a app corre em
// tablets e o Popover abre por toque). Só aparece quando o teto é mesmo atingido.
export function OrdersLimitNotice({ count }: { count: number }) {
  const d = useDict()
  if (count < ORDERS_LIMIT) return null

  const message = d.admin.ordersLimitNotice(ORDERS_LIMIT)

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={message}
          className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Info className="size-4" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 max-w-xs rounded-lg border border-border bg-popover p-3 text-xs leading-relaxed text-popover-foreground shadow-lg animate-fade-in outline-none"
        >
          {message}
          <Popover.Arrow className="fill-border" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
