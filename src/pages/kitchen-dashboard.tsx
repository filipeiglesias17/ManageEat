import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import { Ban, Inbox, List, Undo2, X, WifiOff } from 'lucide-react'
import { useAudioAlert } from '../hooks/use-audio-alert'
import { useConnectionAlert } from '../hooks/use-connection-alert'
import { useAnimatedList, type AnimatedEntry } from '../hooks/use-animated-list'
import type { Order, OrderStatus } from '../@types/order'
import { canTransition } from '../@types/order'
import { cancelOrder, subscribeOrders, updateOrderStatus } from '../lib/db'
import { useAuth } from '../lib/auth-context'
import { safeQuantity, safeItemName } from '../lib/order-utils'
import { OrdersLimitNotice } from '../components/orders-limit-notice'
import { OrderCard } from '../components/order-card'
import {
  statusColor,
  nextStatus, nextColor,
  prevStatus, kanbanColumns,
} from '../lib/order-status-ui'
import { useDict } from '../lib/i18n'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'

// Mensagem amigável a partir de um erro da base de dados.
function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// Chave estável para o useAnimatedList (a mesma nas 4 listas deste ecrã).
function orderKey(order: Order): string {
  return order.id
}

// Pedidos de uma coluna do kanban, FIFO: o pedido mais antigo aparece primeiro.
// Sem ordenar, as colunas mudavam de ordem a cada atualização em tempo real.
function ordersForKanbanColumn(orders: Order[], status: OrderStatus): Order[] {
  return orders
    .filter((o) => o.status === status)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}

export function KitchenDashboard() {
  const d = useDict()
  const { profile } = useAuth()
  const [orders, setOrders] = useState<Order[]>([])
  const [showAll, setShowAll] = useState(false)
  const [now, setNow] = useState(new Date())
  // Feedback de erro nas transições de estado. Se a BD falhar (offline,
  // RLS, rede) a cozinha tem de ver o que aconteceu, em vez de "nada acontece".
  const [actionError, setActionError] = useState('')
  // Aviso de ligação perdida (só aparece se persistir): sem isto, a cozinha via
  // uma lista parada sem perceber que deixou de receber pedidos novos.
  const { visible: connLost, markOk: feedOk, markError: feedFail } = useConnectionAlert()

  const playAlert = useAudioAlert()
  const prevPendingIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    const unsubscribe = subscribeOrders(
      (list) => {
        feedOk()
        setOrders(list)
      },
      feedFail,
    )
    return unsubscribe
  }, [feedOk, feedFail])

  useEffect(() => {
    const currentPendingIds = new Set(orders.filter(o => o.status === 'pending').map(o => o.id))

    // Há algum pendente que não existia no conjunto anterior? (= pedido novo)
    let hasNewPending = false
    for (const id of currentPendingIds) {
      if (!prevPendingIds.current.has(id)) {
        hasNewPending = true
        break
      }
    }

    // Só tocar o som se não for a renderização inicial (quando size era 0 e agora não é)
    // Para ser rigoroso: se passamos de N para N+x e x são novos.
    if (hasNewPending && prevPendingIds.current.size > 0) {
      playAlert()
    }

    prevPendingIds.current = currentPendingIds
  }, [orders, playAlert])

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date())
    }, 30_000)
    return () => clearInterval(interval)
  }, [])

  // Handlers estáveis (useCallback) para o OrderCard em React.memo não
  // re-renderizar todas as cartas quando um pedido muda.
  const handleAdvance = useCallback(async (order: Order) => {
    const next = nextStatus[order.status]
    if (!next || !canTransition(order.status, next)) return
    try {
      await updateOrderStatus(order.id, next)
      setActionError('')
      setOrders((prev) => prev.map((o) => o.id === order.id ? { ...o, status: next } : o))
    } catch (err) {
      setActionError(d.kitchen.advanceOrderError(order.tableNumber, describeError(err)))
    }
  }, [d])

  const handleGoBack = useCallback(async (order: Order) => {
    const prev = prevStatus[order.status]
    if (!prev || !canTransition(order.status, prev)) return
    try {
      await updateOrderStatus(order.id, prev)
      setActionError('')
      setOrders((cur) => cur.map((o) => o.id === order.id ? { ...o, status: prev } : o))
    } catch (err) {
      setActionError(d.kitchen.goBackOrderError(order.tableNumber, describeError(err)))
    }
  }, [d])

  const handleCancel = useCallback(async (order: Order) => {
    if (!profile) return
    const reason = prompt(d.kitchen.cancelReasonPrompt(order.tableNumber))
    if (reason === null) return

    const trimmedReason = reason.trim()
    if (!trimmedReason) {
      alert(d.kitchen.cancelReasonRequired)
      return
    }

    try {
      await cancelOrder(order.id, trimmedReason, profile.uid)
      setActionError('')
      const cancelledAt = new Date().toISOString()
      setOrders((cur) => cur.map((o) => (
        o.id === order.id
          ? {
              ...o,
              status: 'cancelled',
              cancelledAt,
              cancelledBy: profile.uid,
              cancelReason: trimmedReason,
            }
          : o
      )))
    } catch (err) {
      setActionError(d.kitchen.cancelOrderError(order.tableNumber, describeError(err)))
    }
  }, [profile, d])

  // ── Saída animada das listas (Fase 4) ──
  // useAnimatedList segura os itens removidos ~220ms marcados como `leaving`,
  // para saírem com animate-sink em vez de desaparecerem de repente quando o
  // realtime atualiza. As listas derivadas são memoizadas porque o hook compara
  // `items` por referência — sem useMemo, cada render criava um array novo e
  // re-disparava o efeito interno do hook em loop.
  const sortedAllOrders = useMemo(
    // Mais recentes primeiro. A BD devolve por linha, que é aleatório —
    // sem ordenar, a lista "Todos" mudava de ordem a cada snapshot.
    () => [...orders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [orders],
  )
  const allOrderEntries = useAnimatedList(sortedAllOrders, orderKey)

  // Uma lista por coluna do kanban, calculada aqui no topo (nunca dentro do
  // map) para respeitar as rules of hooks: o hook corre sempre 3× na mesma ordem.
  const pendingOrders = useMemo(() => ordersForKanbanColumn(orders, 'pending'), [orders])
  const preparingOrders = useMemo(() => ordersForKanbanColumn(orders, 'preparing'), [orders])
  const readyOrders = useMemo(() => ordersForKanbanColumn(orders, 'ready'), [orders])
  const pendingEntries = useAnimatedList(pendingOrders, orderKey)
  const preparingEntries = useAnimatedList(preparingOrders, orderKey)
  const readyEntries = useAnimatedList(readyOrders, orderKey)

  // Indexado pelo status da coluna, para o map do kanban ir buscar as suas entradas.
  const kanbanEntries: Partial<Record<OrderStatus, AnimatedEntry<Order>[]>> = {
    pending: pendingEntries,
    preparing: preparingEntries,
    ready: readyEntries,
  }
  // Vazio só quando a última saída terminou — senão o EmptyState aparecia por
  // cima de um cartão ainda a sair.
  const kanbanEmpty =
    pendingEntries.length === 0 && preparingEntries.length === 0 && readyEntries.length === 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black">{d.kitchen.title}</h1>
        <div className="flex items-center gap-3">
          <Button
            variant={showAll ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setShowAll((v) => !v)}
            aria-pressed={showAll}
          >
            <List className="size-4" />
            {d.kitchen.showAllButton}
          </Button>
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            {/* bg-success: token de estado reativo ao tema (sem dark:). */}
            <span className="size-1.5 rounded-full bg-success inline-block animate-pulse" />
            {d.kitchen.liveIndicator}
          </span>
          <OrdersLimitNotice count={orders.length} />
        </div>
      </div>

      {connLost && (
        <Alert variant="destructive" icon={<WifiOff />}>
          {d.kitchen.connectionLostAlert}
        </Alert>
      )}

      {actionError && (
        <Alert variant="destructive" className="items-center">
          <div className="flex items-center justify-between gap-3">
            <span>{actionError}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setActionError('')}
              className="shrink-0 text-destructive hover:text-destructive"
              aria-label={d.kitchen.dismissAlertLabel}
            >
              <X className="size-4" />
            </Button>
          </div>
        </Alert>
      )}

      {showAll ? (
        /* ── Vista: Todos ── */
        <div className="space-y-3">
          {/* allOrderEntries (não orders): assim o vazio só aparece depois de a
              última linha acabar a animação de saída. */}
          {allOrderEntries.length === 0 ? (
            <EmptyState
              compact
              icon={<Inbox />}
              title={d.kitchen.allEmptyTitle}
              description={d.kitchen.allEmptyDescription}
            />
          ) : (
            allOrderEntries.map(({ item: order, key, leaving }) => (
              // Saída animada: o wrapper colapsa a altura (grid-rows 1fr→0fr)
              // enquanto o cartão faz animate-sink, em vez de sumir de repente.
              <div
                key={key}
                className={`grid transition-[grid-template-rows] duration-200 ease-[var(--ease-out-strong)] ${leaving ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'}`}
              >
              <div
                className={`overflow-hidden flex flex-wrap items-center gap-3 bg-card border border-border rounded-lg p-4 shadow-sm ${leaving ? 'animate-sink' : ''}`}
              >
                <span className="text-lg font-black">{d.kitchen.tableLabel(order.tableNumber)}</span>
                <span className="text-sm text-muted-foreground">{d.kitchen.sourceLabel[order.source]}</span>
                <div className="w-full sm:flex-1 flex flex-col gap-0.5">
                  {order.items.map((item, idx) => (
                    <span key={idx} className="text-sm text-foreground/80">
                      {safeQuantity(item.quantity)}× {safeItemName(item.menuItemName)}
                      {/* Tokens de estado (destructive/warning): reativos ao tema, sem dark:. */}
                      {item.removedIngredients && item.removedIngredients.length > 0 && (
                        <span className="text-destructive ml-1">{d.kitchen.removedIngredientsInline(item.removedIngredients.join(', '))}</span>
                      )}
                      {item.notes && (
                        <span className="text-warning ml-1 italic">↳ {item.notes}</span>
                      )}
                    </span>
                  ))}
                </div>
                <Badge variant="outline" className={statusColor[order.status]}>
                  {d.kitchen.statusLabel[order.status]}
                </Badge>
                {order.status === 'cancelled' && order.cancelReason && (
                  <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/25">
                    {order.cancelReason}
                  </Badge>
                )}
                {nextStatus[order.status] && (
                  <button
                    onClick={() => handleAdvance(order)}
                    className={`text-sm px-4 py-2 rounded-lg font-semibold shadow-sm transition-all active:scale-95 ${nextColor[order.status]}`}
                  >
                    {d.kitchen.nextLabel[order.status]}
                  </button>
                )}
                {prevStatus[order.status] && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleGoBack(order)}
                    className="text-muted-foreground"
                    title={d.kitchen.prevLabel[order.status]}
                  >
                    <Undo2 className="size-3.5" />
                  </Button>
                )}
                {order.status !== 'delivered' && order.status !== 'cancelled' && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleCancel(order)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={d.kitchen.cancelOrderLabel(order.tableNumber)}
                    title={d.kitchen.cancelOrderTitle}
                  >
                    <Ban className="size-3.5" />
                  </Button>
                )}
              </div>
              </div>
            ))
          )}
        </div>
      ) : (
        /* ── Vista: 3 colunas ── */
        <>
          {kanbanEmpty && (
            <EmptyState
              compact
              icon={<Inbox />}
              title={d.kitchen.kanbanEmptyTitle}
              description={d.kitchen.kanbanEmptyDescription}
            />
          )}
          <div className="flex overflow-x-auto gap-6 pb-6 custom-scrollbar snap-x snap-mandatory">
            {kanbanColumns.map((col) => {
              const colEntries = kanbanEntries[col.status] ?? []
              // Contagem real da coluna: os itens em saída já não contam.
              const colCount = colEntries.filter((entry) => !entry.leaving).length
              return (
                <div key={col.status} className="flex flex-col gap-4 min-w-[320px] max-w-[400px] flex-1 snap-start">
                  {/* Cabeçalho da coluna */}
                  <div className={`flex items-center justify-between border-b-2 pb-3 ${col.headerColor}`}>
                    <span className="text-lg font-bold">{d.kitchen.columnLabel[col.status]}</span>
                    <span className="text-2xl font-black">{colCount}</span>
                  </div>

                  {/* Cards. Saída animada: quando um pedido avança de coluna, o
                      wrapper colapsa a altura enquanto o cartão faz animate-sink,
                      em vez de saltar de repente para a coluna seguinte. */}
                  {colEntries.length === 0 ? (
                    <p className="text-muted-foreground text-sm text-center py-6">—</p>
                  ) : (
                    colEntries.map(({ item: order, key, leaving }) => (
                      <div
                        key={key}
                        className={`grid transition-[grid-template-rows] duration-200 ease-[var(--ease-out-strong)] ${leaving ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'}`}
                      >
                        <div className={`overflow-hidden ${leaving ? 'animate-sink' : ''}`}>
                          <OrderCard
                            order={order}
                            now={now}
                            onAdvance={handleAdvance}
                            onGoBack={handleGoBack}
                            onCancel={handleCancel}
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
