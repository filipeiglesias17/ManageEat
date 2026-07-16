import { useEffect, useState, useMemo } from 'react'
import { Clock, Users, Receipt, Bell, KeyRound, Hourglass, X, QrCode, ShoppingCart } from 'lucide-react'
import { createSession, closeSession, resolveServiceCallsForSession, cancelOrder } from '../lib/db'
import type { QrSession } from '../lib/db'
import type { Order } from '../@types/order'
import type { ServiceCall } from '../@types/service-call'
import type { SessionMode } from '../@types/settings'
import { accountTotals, currentAccountOrders } from '../lib/account'
import { TableSessionPanel } from './table-session-panel'
import { CloseBillModal } from './close-bill-modal'
import { Modal } from './modal'
import { useRestaurantSettings } from '../hooks/use-restaurant-settings'
import { useAuth } from '../lib/auth-context'
import { useMyShift } from '../lib/shift-context'
import { SHIFT_GATE_MESSAGE } from '../lib/shift-gate'
import { parseTableNumber, randomHexId, formatEuro } from '../lib/helpers'
import { useDict } from '../lib/i18n'
import { Button } from '@/components/ui/button'

interface Props {
  // Todas as sessões (permanentes + temporárias), em tempo real, vindas do
  // dashboard. As escritas (iniciar/criar/fechar) refletem-se aqui pela subscrição.
  sessions: QrSession[]
  // Pedidos e chamadas em tempo real, também vindos do dashboard (fonte única —
  // antes este componente subscrevia por conta própria e duplicava a subscrição).
  orders: Order[]
  calls: ServiceCall[]
  selectedSessionId?: string | null
  // Mesa a destacar por instantes quando o empregado toca numa notificação.
  highlightedSessionId?: string | null
  draftCountsBySessionId?: Record<string, number>
  // Abrir o pedido do empregado para esta sessão concreta. Passar a sessão evita
  // ambiguidades quando um QR permanente é reaberto na mesma mesa.
  onOrderForTable: (session: QrSession) => void
}

// 'idle' = sessão por iniciar (QR permanente à espera). As restantes só se
// aplicam a sessões abertas (com pedidos/chamadas).
type TableState = 'idle' | 'servida' | 'pronto' | 'aguardar' | 'atrasada_chamada'

function getTableState(session: QrSession, orders: Order[], calls: ServiceCall[], now: Date): TableState {
  if (session.open !== true) return 'idle'

  const tableCalls = calls.filter((c) => isCallForCurrentSession(c, session))
  if (tableCalls.length > 0) return 'atrasada_chamada'

  const sessionOrders = currentAccountOrders(session, orders)

  // Há comida pronta na cozinha à espera de ser levada à mesa. Antes esta mesa
  // caía em 'servida' (verde) e o empregado não tinha sinal para a ir buscar.
  const hasReadyOrder = sessionOrders.some((o) => o.status === 'ready')
  if (hasReadyOrder) return 'pronto'

  const activeOrders = sessionOrders.filter((o) => o.status === 'pending' || o.status === 'preparing')
  if (activeOrders.length === 0) return 'servida'

  const hasLateOrder = activeOrders.some((o) => {
    const diffMins = Math.max(0, Math.floor((now.getTime() - new Date(o.createdAt).getTime()) / 60_000))
    return diffMins >= 10
  })
  return hasLateOrder ? 'atrasada_chamada' : 'aguardar'
}

const STATE_COLORS: Record<TableState, string> = {
  idle: 'bg-muted/40 border-border text-muted-foreground',
  servida: 'bg-green-500/10 border-green-500/30 text-green-600 dark:text-green-400',
  // Pisca (como 'atrasada_chamada') para puxar o olhar — é uma ação a fazer já.
  pronto: 'bg-emerald-500/15 border-emerald-500/60 text-emerald-700 dark:text-emerald-300 animate-pulse-border',
  aguardar: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-400',
  atrasada_chamada: 'bg-red-500/10 border-red-500/50 text-red-600 dark:text-red-400 animate-pulse-border',
}

// Estilo partilhado dos botões de ação rápida do card (Pedir/Conta/Iniciar).
// Centralizado para os três não divergirem se um dia mudar o visual.
const QUICK_ACTION_BUTTON =
  'inline-flex items-center justify-center gap-1.5 rounded-sm bg-background/60 px-2 py-2 text-xs font-semibold text-foreground border border-border hover:bg-background transition-colors disabled:cursor-not-allowed disabled:opacity-50'

function isCallForCurrentSession(call: ServiceCall, session: QrSession): boolean {
  if (call.status === 'resolved') return false
  if (call.sessionId && call.sessionId !== session.id) return false
  if (!call.sessionId && call.tableNumber !== session.tableNumber) return false
  if (!session.openedAt) return true
  return new Date(call.createdAt).getTime() >= new Date(session.openedAt).getTime()
}

export function TableMap({ sessions, orders, calls, selectedSessionId, highlightedSessionId, draftCountsBySessionId = {}, onOrderForTable }: Props) {
  const d = useDict()
  const { mode: restaurantMode, entryPrice } = useRestaurantSettings()
  const { profile } = useAuth()
  // D1: fora de turno não se criam mesas (e o auto-fecho de expiradas espera).
  const { canOperate } = useMyShift()
  const [now, setNow] = useState(new Date())

  // Sessão a gerir (painel) e sessão a fechar (CloseBillModal).
  const [managingSession, setManagingSession] = useState<QrSession | null>(null)
  const [closingSession, setClosingSession] = useState<QrSession | null>(null)

  // Form de "Nova mesa" (cria uma sessão temporária já aberta).
  const [creatingNew, setCreatingNew] = useState(false)
  const [newTable, setNewTable] = useState('')
  const [newHeadcount, setNewHeadcount] = useState('')
  const [newMode, setNewMode] = useState<SessionMode>('normal')
  const [newError, setNewError] = useState('')
  const [savingNew, setSavingNew] = useState(false)

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(interval)
  }, [])

  // Auto-fechar sessões expiradas na base de dados (experiência App Nativa).
  // Só fechamos contas SEM consumo por liquidar: uma sessão expirada com pedidos
  // ou com entrada de rodízio por cobrar fica aberta para fecho manual, em vez de
  // a app apagar receita sem rasto. (A BD aplica a mesma guarda no trigger.)
  useEffect(() => {
    // Sem turno, o closeSession ia falhar no trigger (D1) e encher a consola em
    // loop — a limpeza fica para quando alguém com turno estiver no mapa (a BD
    // aplica a mesma limpeza quando se cria uma sessão nova na mesa).
    if (!canOperate) return
    const expired = sessions.filter(
      (s) => s.open === true && s.expiresAt && new Date(s.expiresAt) < now
    )
    if (expired.length > 0) {
      expired.forEach(async (session) => {
        const accountOrders = currentAccountOrders(session, orders)
        const hasConsumo =
          accountOrders.some((o) => o.status !== 'cancelled')
          || accountTotals(session, accountOrders).total > 0
        if (hasConsumo) return
        try {
          await resolveServiceCallsForSession(session.id)
          await closeSession(session.id)
        } catch (err) {
          console.error(`Erro ao auto-fechar comanda expirada da mesa ${session.tableNumber}:`, err)
        }
      })
    }
  }, [sessions, now, orders, canOperate])

  // Manter o painel/fecho sincronizados com a sessão viva (ex: cliente cria o
  // código, ou o estado muda) sem fechar o que o empregado tem aberto.
  const liveManaging = managingSession ? sessions.find((s) => s.id === managingSession.id) ?? null : null

  // Cancelar um pedido (cancelamento lógico, com motivo obrigatório). O autor
  // fica registado em cancelled_by para auditoria. O Realtime atualiza a lista,
  // por isso não guardamos estado aqui — só disparamos a escrita e deixamos o
  // erro propagar para o painel mostrar a mensagem.
  async function handleCancelOrder(order: Order, reason: string) {
    if (!profile) throw new Error(d.employee.invalidSessionError)
    await cancelOrder(order.id, reason, profile.uid)
  }

  function openNewSession() {
    setNewTable('')
    setNewHeadcount('')
    setNewMode(restaurantMode === 'rodizio' ? 'rodizio' : 'normal')
    setNewError('')
    setCreatingNew(true)
  }

  async function handleCreateNew() {
    setNewError('')
    const num = parseTableNumber(newTable)
    if (num === null) { setNewError(d.employee.map.invalidTableNumber); return }
    if (sessions.some((s) => s.tableNumber === num)) { setNewError(d.employee.map.duplicateTableNumber); return }

    const finalMode: SessionMode = restaurantMode === 'mixed' ? newMode : (restaurantMode === 'rodizio' ? 'rodizio' : 'normal')
    let headcount: number | null = null
    if (finalMode === 'rodizio') {
      headcount = parseTableNumber(newHeadcount)
      if (headcount === null) { setNewError(d.employee.tableActions.headcountRequired); return }
    }

    setSavingNew(true)
    try {
      const created = await createSession({
        id: randomHexId(8),
        tableNumber: num,
        createdAt: new Date().toISOString(),
        open: true,
        openedAt: new Date().toISOString(),
        ...(finalMode === 'rodizio' && headcount !== null && { mode: 'rodizio', entryPrice, headcount }),
      })
      setCreatingNew(false)
      // Abrir logo o painel da nova mesa para mostrar o QR a apontar ao cliente.
      setManagingSession(created)
    } catch (err) {
      setNewError(d.employee.map.createSessionError(err instanceof Error ? err.message : String(err)))
    } finally {
      setSavingNew(false)
    }
  }

  // Pré-calcular o estado e os totais de cada mesa uma só vez. Sem isto,
  // qualquer render (ex: escrever no form "Nova mesa") refazia os filtros de
  // orders/calls para todas as mesas. Só recalcula quando os dados mudam.
  const tableViews = useMemo(() => {
    const sorted = [...sessions].sort((a, b) => a.tableNumber - b.tableNumber)
    return sorted.map((session) => {
      const state = getTableState(session, orders, calls, now)
      // Tempo: nas abertas conta desde openedAt; nas idle não mostramos.
      const since = session.openedAt ?? session.createdAt
      const diffMins = Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / 60_000))
      const timeText = diffMins > 60 ? `${Math.floor(diffMins / 60)}h${diffMins % 60}m` : `${diffMins}m`

      const sessionOrders = currentAccountOrders(session, orders)
      const total = accountTotals(session, sessionOrders).total
      const tableCalls = calls.filter((c) => isCallForCurrentSession(c, session))
      return { session, state, timeText, total, tableCalls }
    })
  }, [sessions, orders, calls, now])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">{d.employee.map.title}</h2>
        <button
          onClick={openNewSession}
          disabled={!canOperate}
          title={canOperate ? undefined : SHIFT_GATE_MESSAGE}
          className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-xl bg-brand/10 border border-brand/30 text-brand hover:bg-brand/20 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-brand/10"
        >
          <QrCode className="size-4" />
          {d.employee.map.newTableButton}
        </button>
      </div>

      {tableViews.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
          <Hourglass className="size-8 opacity-20" />
          <p>{d.employee.map.emptyState}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2 gap-4">
          {tableViews.map(({ session, state, timeText, total, tableCalls }) => {
            const isOpen = session.open === true
            const canOrder = isOpen && (!session.expiresAt || new Date(session.expiresAt).getTime() > now.getTime())
            const isSelected = session.id === selectedSessionId || session.id === highlightedSessionId
            const draftCount = draftCountsBySessionId[session.id] ?? 0

            return (
              <div
                key={session.id}
                className={`flex flex-col rounded-2xl p-4 border transition-transform active:scale-[0.98] ${
                  isSelected ? 'ring-2 ring-brand/70' : ''
                } ${STATE_COLORS[state]}`}
              >
                {/* Conteúdo do card: tocar abre o painel de detalhes da mesa. */}
                <button
                  type="button"
                  onClick={() => setManagingSession(session)}
                  className="flex flex-1 w-full cursor-pointer flex-col text-left outline-none focus-visible:ring-2 focus-visible:ring-brand/70 rounded-sm"
                  aria-label={d.employee.map.openTableDetailsAria(session.tableNumber)}
                >
                  <div className="flex items-start justify-between w-full mb-3 gap-2">
                    <div>
                      <span className="text-xl font-black">{d.employee.tableLabel(session.tableNumber)}</span>
                      <p className="text-xs uppercase tracking-wide opacity-80">{d.employee.map.stateLabel[state]}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {isOpen && session.hasAccessCode && <KeyRound className="size-3.5 text-green-600 dark:text-green-400" aria-label={d.employee.map.accessCodeCreatedAria} />}
                      {!session.expiresAt && <span className="text-xs uppercase tracking-wide text-muted-foreground">{d.employee.map.fixedBadge}</span>}
                      {tableCalls.length > 0 && tableCalls.map((c) => c.type === 'bill'
                        ? <Receipt key={c.id} className="size-4 animate-bounce" />
                        : <Bell key={c.id} className="size-4 animate-bounce" />)}
                    </div>
                  </div>

                  {isOpen ? (
                    <div className="space-y-1 mt-auto">
                      {session.headcount && (
                        <p className="flex items-center gap-1.5 text-xs opacity-80">
                          <Users className="size-3.5" />
                          {d.employee.map.headcountUnit(session.headcount)}
                        </p>
                      )}
                      <p className="flex items-center gap-1.5 text-xs opacity-80">
                        <Clock className="size-3.5" />
                        {timeText}
                      </p>
                      <p className="font-bold mt-2 text-foreground">{formatEuro(total)}</p>
                      {draftCount > 0 && (
                        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-brand/15 px-2 py-1 text-[11px] font-semibold text-brand">
                          <ShoppingCart className="size-3" />
                          {d.employee.map.draftCount(draftCount)}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="mt-auto flex items-center gap-1.5 text-xs">
                      <Hourglass className="size-3.5" />
                      {d.employee.map.tapToStart}
                    </div>
                  )}
                </button>

                {/* Ações rápidas por mesa: o pedido começa aqui, sem entrar nos detalhes. */}
                {isOpen ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      aria-label={canOrder ? d.employee.tableActions.orderForTableAria(session.tableNumber) : d.employee.tableActions.expiredSessionAria(session.tableNumber)}
                      disabled={!canOrder}
                      onClick={() => onOrderForTable(session)}
                      className={QUICK_ACTION_BUTTON}
                    >
                      <ShoppingCart className="size-3.5" />
                      {canOrder ? d.employee.tableActions.orderAction : d.employee.tableActions.expiredAction}
                    </button>
                    <button
                      type="button"
                      aria-label={d.employee.tableActions.closeBillAria(session.tableNumber)}
                      onClick={() => setClosingSession(session)}
                      className={QUICK_ACTION_BUTTON}
                    >
                      <Receipt className="size-3.5" />
                      {d.employee.tableActions.accountAction}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setManagingSession(session)}
                    className={`${QUICK_ACTION_BUTTON} mt-3`}
                  >
                    <QrCode className="size-3.5" />
                    {d.employee.tableActions.startAction}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {liveManaging && (
        <TableSessionPanel
          session={liveManaging}
          orders={orders}
          onClose={() => setManagingSession(null)}
          onOrderForTable={onOrderForTable}
          onCloseBill={(s) => setClosingSession(s)}
          onCancelOrder={handleCancelOrder}
        />
      )}

      {closingSession && (
        <CloseBillModal
          session={closingSession}
          orders={orders}
          onClosed={() => setClosingSession(null)}
          onCancel={() => setClosingSession(null)}
        />
      )}

      {creatingNew && (
        <Modal onClose={() => setCreatingNew(false)} aria-labelledby="new-session-title">
          <div className="flex items-center justify-between mb-2">
            <h2 id="new-session-title" className="text-lg font-bold flex items-center gap-2">
              <QrCode className="size-5 text-brand" />
              {d.employee.map.newSessionTitle}
            </h2>
            <button onClick={() => setCreatingNew(false)} aria-label={d.common.close} className="p-1 text-muted-foreground hover:text-foreground">
              <X className="size-5" />
            </button>
          </div>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {d.employee.map.newSessionHint}
            </p>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{d.employee.map.tableNumberLabel}</label>
              <input
                type="number"
                min="1"
                value={newTable}
                onChange={(e) => { setNewTable(e.target.value); setNewError('') }}
                className="border border-input rounded-lg px-3 py-2 bg-background text-foreground outline-none focus:border-brand focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </div>

            {restaurantMode === 'mixed' && (
              <div className="flex gap-2">
                <button onClick={() => { setNewMode('normal'); setNewError('') }} className={`flex-1 py-2 rounded-lg text-sm font-medium border ${newMode === 'normal' ? 'bg-brand/10 border-brand text-brand' : 'border-border text-muted-foreground'}`}>{d.employee.modeOption.alaCarte}</button>
                <button onClick={() => { setNewMode('rodizio'); setNewError('') }} className={`flex-1 py-2 rounded-lg text-sm font-medium border ${newMode === 'rodizio' ? 'bg-brand/10 border-brand text-brand' : 'border-border text-muted-foreground'}`}>{d.employee.modeOption.rodizio}</button>
              </div>
            )}

            {(restaurantMode === 'rodizio' || (restaurantMode === 'mixed' && newMode === 'rodizio')) && (
              <div className="flex flex-col gap-1">
                <label className="text-sm text-muted-foreground">{d.employee.map.headcountLabel}</label>
                <input
                  type="number"
                  min="1"
                  value={newHeadcount}
                  onChange={(e) => { setNewHeadcount(e.target.value); setNewError('') }}
                  className="border border-input rounded-lg px-3 py-2 bg-background text-foreground outline-none focus:border-brand focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
                <p className="text-xs text-muted-foreground">{d.employee.map.entryPriceHint(formatEuro(entryPrice))}</p>
              </div>
            )}

            {newError && <p className="text-sm text-destructive" role="alert">{newError}</p>}

            <Button
              type="button"
              size="lg"
              className="w-full font-bold"
              onClick={handleCreateNew}
              disabled={savingNew}
            >
              {savingNew ? d.employee.map.creating : d.employee.map.createAndShowQr}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
