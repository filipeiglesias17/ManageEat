import { useState } from 'react'
import { History, ChevronDown } from 'lucide-react'
import type { Order } from '../@types/order'
import type { QrSession } from '../lib/db'
import { tableHistory, orderItemsRevenue } from '../lib/account'
import { statusLabel, statusColor } from '../lib/order-status-ui'
import { formatDateTime, formatEuro } from '../lib/helpers'
import { safeQuantity, safeItemName } from '../lib/order-utils'
import { useDict } from '../lib/i18n'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'

interface Props {
  session: QrSession
  orders: Order[]
}

// Histórico de uma mesa para o empregado: a conta atual e as contas anteriores
// da mesma mesa física (inclui sessões antigas e pedidos cancelados). Só leitura.
// Está recolhido por defeito porque o foco do painel é a conta atual.
export function TableHistory({ session, orders }: Props) {
  const d = useDict()
  const [open, setOpen] = useState(false)
  const { current, previous } = tableHistory(session, orders)
  const hasAny = current.length > 0 || previous.length > 0

  return (
    <div className="border-t border-border pt-4">
      <button
        type="button"
        onClick={() => setOpen((isOpen) => !isOpen)}
        aria-expanded={open}
        className="w-full flex items-center justify-between text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="flex items-center gap-2">
          <History className="size-4" />
          {d.employee.history.toggleLabel}
        </span>
        <ChevronDown className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          {!hasAny && (
            <EmptyState
              icon={<History />}
              title={d.employee.history.emptyTitle}
              description={d.employee.history.emptyDescription}
              compact
            />
          )}
          {current.length > 0 && <OrderGroup title={d.employee.history.currentAccount} orders={current} />}
          {previous.length > 0 && <OrderGroup title={d.employee.history.previousAccounts} orders={previous} />}
        </div>
      )}
    </div>
  )
}

// Um grupo de pedidos (conta atual ou anteriores) com data, estado e total.
function OrderGroup({ title, orders }: { title: string; orders: Order[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <ul className="space-y-2">
        {orders.map((order) => (
          <li key={order.id} className="bg-muted/40 border border-border rounded-lg p-3 text-xs">
            <div className="flex items-center justify-between mb-1">
              <span className="text-muted-foreground">{formatDateTime(order.createdAt)}</span>
              <Badge variant="outline" className={statusColor[order.status]}>
                {statusLabel[order.status]}
              </Badge>
            </div>
            <p className="text-foreground">
              {order.items.map((item) => `${safeQuantity(item.quantity)}× ${safeItemName(item.menuItemName)}`).join(', ')}
            </p>
            <p className="text-right text-muted-foreground mt-1">{formatEuro(orderItemsRevenue(order))}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
