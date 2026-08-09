import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { X, KeyRound, ShoppingCart, Receipt, Play, RotateCcw, Plus, Minus, Ban } from 'lucide-react'
import { Modal } from './modal'
import { CancelOrderModal } from './cancel-order-modal'
import { CANCELLABLE_STATUSES } from '../lib/order-cancel'
import { TableHistory } from './table-history'
import type { QrSession } from '../lib/db'
import { resetSessionAccessCode, startSession, updateSessionHeadcount } from '../lib/db'
import type { Order } from '../@types/order'
import type { SessionMode } from '../@types/settings'
import { useRestaurantSettings } from '../hooks/use-restaurant-settings'
import { useMyShift } from '../lib/shift-context'
import { SHIFT_GATE_MESSAGE } from '../lib/shift-gate'
import { accountTotals, currentAccountOrders } from '../lib/account'
import { statusLabel, statusColor } from '../lib/order-status-ui'
import { sessionUrl } from '../lib/helpers'
import { parseTableNumber, formatEuro } from '../lib/helpers'
import { safeQuantity, safeItemName } from '../lib/order-utils'
import { useDict } from '../lib/i18n'
import { Button } from '@/components/ui/button'

// Limite de pessoas por mesa (espelha o clamp server-side em set_session_headcount).
const MAX_HEADCOUNT = 99

interface Props {
  session: QrSession
  orders: Order[]
  onClose: () => void
  // Abrir o pedido do empregado para esta sessão concreta.
  onOrderForTable: (session: QrSession) => void
  // Abrir o fluxo de fecho de conta (CloseBillModal)  gerido pelo dashboard.
  onCloseBill: (session: QrSession) => void
  // Cancelar um pedido da conta (cancelamento lógico, com motivo). A escrita e o
  // autor vivem no dashboard/TableMap; aqui só pedimos a confirmação + motivo.
  onCancelOrder: (order: Order, reason: string) => Promise<void>
}

// Painel de gestão de uma mesa a partir do mapa: iniciar a sessão (idle), ver os
// pedidos/conta e o QR (aberta) e fechar a conta. Reutiliza o CloseBillModal via
// onCloseBill. As escritas (startSession) refletem-se no mapa pela subscrição.
export function TableSessionPanel({ session, orders, onClose, onOrderForTable, onCloseBill, onCancelOrder }: Props) {
  const d = useDict()
  const { mode: restaurantMode, entryPrice } = useRestaurantSettings()
  // Iniciar, alterar ou fechar uma mesa exige um turno aberto.
  const { canOperate } = useMyShift()
  const [headcount, setHeadcount] = useState('')
  // No modo misto o empregado escolhe; senão segue o modo do restaurante.
  const [startMode, setStartMode] = useState<SessionMode>(restaurantMode === 'rodizio' ? 'rodizio' : 'normal')
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const [resettingCode, setResettingCode] = useState(false)

  const [updatingHeadcount, setUpdatingHeadcount] = useState(false)
  const [isEditingHeadcount, setIsEditingHeadcount] = useState(false)
  const [tempHeadcount, setTempHeadcount] = useState('')
  const [headcountError, setHeadcountError] = useState('')

  //  Cancelamento de um pedido: guardamos só qual o pedido; o motivo, a
  // validação e o estado de gravação vivem no CancelOrderModal partilhado.
  const [cancellingOrder, setCancellingOrder] = useState<Order | null>(null)

  useEffect(() => {
    if (session.open === true) return
    setStartMode(restaurantMode === 'rodizio' ? 'rodizio' : 'normal')
  }, [restaurantMode, session.open])

  async function handleUpdateHeadcount(val: number) {
    if (val < 1 || val > MAX_HEADCOUNT) return
    setHeadcountError('')
    setUpdatingHeadcount(true)
    try {
      await updateSessionHeadcount(session.id, val)
    } catch (err) {
      setHeadcountError(d.employee.session.headcountUpdateError)
      console.error(err)
    } finally {
      setUpdatingHeadcount(false)
      setIsEditingHeadcount(false)
    }
  }

  function saveTempHeadcount() {
    const val = parseInt(tempHeadcount, 10)
    if (isNaN(val) || val < 1) {
      // Mantém o input aberto para o utilizador corrigir, em vez de o fechar.
      setHeadcountError(d.employee.session.headcountMinError)
      return
    }
    handleUpdateHeadcount(Math.min(val, MAX_HEADCOUNT))
  }

  const isOpen = session.open === true
  const canOrder = isOpen && (!session.expiresAt || new Date(session.expiresAt).getTime() > Date.now())
  const sessionOrders = currentAccountOrders(session, orders)
  const total = accountTotals(session, sessionOrders).total
  const activeOrders = sessionOrders.filter((o) => o.status !== 'cancelled')

  async function handleStart() {
    setError('')
    let rodizio: { entryPrice: number; headcount: number } | undefined
    if (startMode === 'rodizio') {
      const n = parseTableNumber(headcount)
      if (n === null) { setError(d.employee.tableActions.headcountRequired); return }
      rodizio = { entryPrice, headcount: n }
    }
    setStarting(true)
    try {
      await startSession(session.id, rodizio)
      onClose()
    } catch (err) {
      setError(d.employee.session.startSessionError(err instanceof Error ? err.message : String(err)))
      setStarting(false)
    }
  }

  async function handleResetCode() {
    setError('')
    setResettingCode(true)
    try {
      await resetSessionAccessCode(session.id)
    } catch (err) {
      setError(d.employee.session.resetCodeError(err instanceof Error ? err.message : String(err)))
    } finally {
      setResettingCode(false)
    }
  }

  return (
    <>
    <Modal onClose={onClose} aria-labelledby="table-panel-title">
      <div className="flex items-center justify-between mb-4">
        <h2 id="table-panel-title" className="text-lg font-bold">
          {d.employee.tableLabel(session.tableNumber)}
          <span className={`ml-2 text-xs font-medium px-2 py-0.5 rounded-full ${isOpen ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : 'bg-muted text-muted-foreground'}`}>
            {isOpen ? d.employee.session.openBadge : d.employee.map.stateLabel.idle}
          </span>
        </h2>
        <button onClick={onClose} aria-label={d.common.close} className="p-2.5 -m-2.5 text-muted-foreground hover:text-foreground transition-colors">
          <X className="size-5" />
        </button>
      </div>

      {!isOpen ? (
        /*  Iniciar sessão*/
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {d.employee.session.startHint}
          </p>

          {restaurantMode === 'mixed' && (
            <div className="flex gap-2">
              <button
                onClick={() => { setStartMode('normal'); setError('') }}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border ${startMode === 'normal' ? 'bg-brand/10 border-brand text-brand' : 'border-border text-muted-foreground'}`}
              >{d.employee.modeOption.alaCarte}</button>
              <button
                onClick={() => { setStartMode('rodizio'); setError('') }}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border ${startMode === 'rodizio' ? 'bg-brand/10 border-brand text-brand' : 'border-border text-muted-foreground'}`}
              >{d.employee.modeOption.rodizio}</button>
            </div>
          )}

          {startMode === 'rodizio' && (
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{d.employee.map.headcountLabel}</label>
              <input
                type="number"
                min="1"
                value={headcount}
                onChange={(e) => { setHeadcount(e.target.value); setError('') }}
                placeholder={d.employee.session.headcountPlaceholder}
                className="border border-input rounded-lg px-3 py-2 bg-background text-foreground outline-none focus:border-brand focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
              <p className="text-xs text-muted-foreground">{d.employee.session.entryPriceStartHint(formatEuro(entryPrice))}</p>
            </div>
          )}

          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          {!canOperate && <p className="text-xs text-warning">{SHIFT_GATE_MESSAGE}</p>}

          <button
            onClick={handleStart}
            disabled={starting || !canOperate}
            title={canOperate ? undefined : SHIFT_GATE_MESSAGE}
            className="w-full flex items-center justify-center gap-2 h-11 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 font-bold disabled:opacity-50 transition-colors active:scale-95"
          >
            <Play className="size-4" />
            {starting ? d.employee.session.startingSession : d.employee.session.startSession}
          </button>
        </div>
      ) : (
        /*  Sessão aberta: QR, código, pedidos, conta, fechar*/
        <div className="space-y-5">
          <div className="bg-brand/10 border border-brand/25 rounded-xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-widest">{d.employee.session.accountTotal}</p>
                <p className="text-3xl font-black text-foreground mt-1">{formatEuro(total)}</p>
                {session.mode === 'rodizio' && typeof session.headcount === 'number' && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-brand">
                    <span className="text-muted-foreground">{d.employee.modeOption.rodizio} · </span>

                    {/* size="icon" (36px) para manter o alvo de toque dos ±*/}
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      onClick={() => handleUpdateHeadcount(session.headcount! - 1)}
                      disabled={session.headcount <= 1 || updatingHeadcount || !canOperate}
                      title={canOperate ? undefined : SHIFT_GATE_MESSAGE}
                      aria-label={d.employee.session.decreasePersonAria}
                    >
                      <Minus className="size-3" />
                    </Button>
                    
                    {isEditingHeadcount ? (
                      <input
                        type="number"
                        min="1"
                        max={MAX_HEADCOUNT}
                        value={tempHeadcount}
                        onChange={(e) => setTempHeadcount(e.target.value)}
                        onBlur={saveTempHeadcount}
                        aria-label={d.employee.session.editHeadcountAria}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveTempHeadcount()
                          if (e.key === 'Escape') setIsEditingHeadcount(false)
                        }}
                        autoFocus
                        className="w-12 h-9 text-center rounded bg-background border border-brand text-foreground outline-none focus:ring-1 focus:ring-brand font-bold text-base sm:text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setTempHeadcount(session.headcount!.toString())
                          setIsEditingHeadcount(true)
                        }}
                        className="px-2.5 py-1 font-bold text-foreground bg-brand/20 border border-brand/40 rounded cursor-pointer hover:bg-brand/30 transition-colors"
                        aria-label={d.employee.session.editHeadcountCurrentAria(session.headcount)}
                      >
                        {session.headcount}
                      </button>
                    )}

                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      onClick={() => handleUpdateHeadcount(session.headcount! + 1)}
                      disabled={session.headcount! >= MAX_HEADCOUNT || updatingHeadcount || !canOperate}
                      title={canOperate ? undefined : SHIFT_GATE_MESSAGE}
                      aria-label={d.employee.session.increasePersonAria}
                    >
                      <Plus className="size-3" />
                    </Button>

                    <span className="text-muted-foreground">
                      {d.employee.personWord(session.headcount)}
                    </span>

                    {headcountError && (
                      <span className="text-destructive text-[10px] animate-pulse ml-1">
                        {headcountError}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <span className="rounded-full bg-background/50 px-2 py-1 text-xs text-muted-foreground">
                {d.employee.orderCountLabel(activeOrders.length)}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                aria-label={canOrder ? d.employee.tableActions.orderForTableAria(session.tableNumber) : d.employee.tableActions.expiredSessionAria(session.tableNumber)}
                disabled={!canOrder}
                onClick={() => { onOrderForTable(session); onClose() }}
                className="flex items-center justify-center gap-2 h-11 rounded-lg border border-border text-foreground bg-background/40 hover:bg-accent transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ShoppingCart className="size-4" />
                {canOrder ? d.employee.tableActions.orderAction : d.employee.tableActions.expiredAction}
              </button>
              <button
                type="button"
                onClick={() => { onCloseBill(session); onClose() }}
                disabled={!canOperate}
                title={canOperate ? undefined : SHIFT_GATE_MESSAGE}
                className="flex items-center justify-center gap-2 h-11 rounded-lg bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 dark:bg-red-950/60 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/40 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Receipt className="size-4" />
                {d.employee.tableActions.accountAction}
              </button>
            </div>
          </div>

          <div className="flex flex-col items-center gap-2">
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <QRCodeSVG value={sessionUrl(session.id)} size={160} />
            </div>
            <p className="w-full bg-muted rounded-lg px-3 py-2 text-xs text-muted-foreground font-mono break-all text-center select-all border border-border">
              {sessionUrl(session.id)}
            </p>
            <p className={`flex items-center gap-1.5 text-xs font-medium ${session.hasAccessCode ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
              <KeyRound className="size-3.5" />
              {session.hasAccessCode ? d.employee.session.accessCodeCreated : d.employee.session.accessCodeWaiting}
            </p>
            {session.hasAccessCode && (
              <button
                type="button"
                onClick={handleResetCode}
                disabled={resettingCode || !canOperate}
                title={canOperate ? undefined : SHIFT_GATE_MESSAGE}
                className="mt-1 inline-flex items-center gap-1.5 text-xs text-yellow-700 dark:text-yellow-300 hover:text-yellow-800 dark:hover:text-yellow-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RotateCcw className="size-3.5" />
                {resettingCode ? d.employee.session.resettingCode : d.employee.session.resetCode}
              </button>
            )}
          </div>

          <div className="bg-muted/40 border border-border rounded-lg p-4">
            <span className="block text-sm text-muted-foreground mb-2">{d.employee.session.ordersInAccount}</span>
            {activeOrders.length === 0 ? (
              <p className="text-xs text-muted-foreground">{d.employee.session.noOrdersYet}</p>
            ) : (
              <ul className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                {activeOrders.map((o) => (
                  <li key={o.id} className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">
                        {o.items.map((i) => `${safeQuantity(i.quantity)}× ${safeItemName(i.menuItemName)}`).join(', ')}
                      </p>
                      <span className={`mt-1 inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full ${statusColor[o.status]}`}>
                        {statusLabel[o.status]}
                      </span>
                    </div>
                    {CANCELLABLE_STATUSES.includes(o.status) && (
                      <button
                        type="button"
                        onClick={() => setCancellingOrder(o)}
                        className="shrink-0 p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors cursor-pointer"
                        aria-label={d.employee.tableActions.cancelOrderAria(session.tableNumber)}
                        title={d.employee.tableActions.cancelOrderTitle}
                      >
                        <Ban className="size-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="mt-5">
        <TableHistory session={session} orders={orders} />
      </div>
    </Modal>

    {cancellingOrder && (
      <CancelOrderModal
        order={cancellingOrder}
        tableNumber={session.tableNumber}
        onConfirm={(reason) => onCancelOrder(cancellingOrder, reason)}
        onClose={() => setCancellingOrder(null)}
      />
    )}
    </>
  )
}
