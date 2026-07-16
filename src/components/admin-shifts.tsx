import { useState, useEffect, useMemo } from 'react'
import { Clock, Download, RotateCcw, Square } from 'lucide-react'
import type { Shift } from '../@types/shift'
import type { Order } from '../@types/order'
import type { AppProfile } from '../@types/user'
import type { Payment, PaymentVoidAction } from '../@types/payment'
import { PAYMENT_METHOD_LABEL } from '../@types/payment'
import type { QrSession } from '../lib/db'
import { closeShift, closeStaleShifts, subscribeShifts, voidPayment } from '../lib/db'
import { shiftDurationHours } from '../lib/staff-audit'
import { orderSubtotal } from '../lib/order-utils'
import { downloadText } from '../lib/export-download'
import { billableOrders } from '../lib/account'
import { activePayments, buildCsv, isVoidedPayment, orderDiscount, orderRevenueBreakdown } from '../lib/stats'
import { formatDateTime, formatEuro, formatDuration } from '../lib/helpers'
import { useAuth } from '../lib/auth-context'
import { useDict } from '../lib/i18n'
import { useConfirmingId } from '../hooks/use-confirming-id'
import { Modal, ModalHeader } from './modal'
import { CloseBillModal } from './close-bill-modal'
import { OrdersLimitNotice } from './orders-limit-notice'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

type ShiftTotals = {
  totalRevenue: number
  paymentCount: number
  orderCount: number
  shiftOrders: Order[]
  shiftPayments: Payment[]
}

function timeFromIso(iso: string): number {
  const time = new Date(iso).getTime()
  return Number.isFinite(time) ? time : 0
}

function dateForFilename(iso: string): string {
  const date = new Date(iso)
  if (isNaN(date.getTime())) return 'sem-data'
  return date.toISOString().split('T')[0]
}

function orderBelongsToShift(order: Order, shift: Shift, now: number): boolean {
  const orderTime = timeFromIso(order.createdAt)
  const openedAt = timeFromIso(shift.openedAt)
  const closedAt = shift.closedAt ? timeFromIso(shift.closedAt) : now
  return orderTime >= openedAt && orderTime <= closedAt
}

function paymentBelongsToShift(payment: Payment, shift: Shift): boolean {
  return payment.shiftId === shift.id
}

function calculateShiftTotals(shift: Shift, orders: Order[], payments: Payment[], now: number): ShiftTotals {
  const shiftOrders = billableOrders(orders.filter((order) => orderBelongsToShift(order, shift, now)))
  const shiftPayments = activePayments(payments).filter((payment) => paymentBelongsToShift(payment, shift))
  return {
    totalRevenue: shiftPayments.reduce((sum, payment) => sum + payment.amount, 0),
    paymentCount: shiftPayments.length,
    orderCount: shiftOrders.length,
    shiftOrders,
    shiftPayments,
  }
}

function buildShiftCsv(shift: Shift, totals: ShiftTotals): string {
  const orderRows = orderRevenueBreakdown(totals.shiftOrders)
    .sort((a, b) => timeFromIso(a.order.createdAt) - timeFromIso(b.order.createdAt))
    .map(({ order, entryRevenue, revenue }) => {
      const items = order.items.map((item) => `${item.quantity}x ${item.menuItemName}`).join(' | ')
      return [
        formatDateTime(order.createdAt),
        `Mesa ${order.tableNumber}`,
        items,
        orderSubtotal(order).toFixed(2),
        orderDiscount(order).toFixed(2),
        entryRevenue.toFixed(2),
        revenue.toFixed(2),
      ]
    })

  const summaryRows: Array<Array<string | number>> = [
    [],
    ['Resumo do Turno'],
    ['Aberto em', formatDateTime(shift.openedAt)],
    ['Total Pedidos', totals.orderCount],
    ['Pagamentos Registados', totals.paymentCount],
    ['Receita Registada', totals.totalRevenue.toFixed(2)],
  ]

  if (shift.closedAt) {
    summaryRows.splice(3, 0, ['Fechado em', formatDateTime(shift.closedAt)])
    const hours = shiftDurationHours(shift)
    if (hours != null) {
      summaryRows.splice(4, 0, ['Horas trabalhadas', hours.toFixed(2)])
    }
  }

  const paymentRows = totals.shiftPayments.map((payment) => [
    formatDateTime(payment.createdAt),
    `Mesa ${payment.tableNumber}`,
    PAYMENT_METHOD_LABEL[payment.method],
    payment.amount.toFixed(2),
    payment.voidedAt ? 'Anulado' : 'Ativo',
  ])

  return buildCsv([
    ['Data/Hora', 'Mesa', 'Itens', 'Subtotal', 'Desconto', 'Entrada rodízio', 'Total'],
    ...orderRows,
    [],
    ['Pagamentos'],
    ['Data/Hora', 'Mesa', 'Método', 'Valor', 'Estado'],
    ...paymentRows,
    ...summaryRows,
  ])
}

// Reutiliza o helper partilhado: no web faz download, no app nativo grava e
// abre a folha de partilha (o WebView não suporta o <a download>).
async function downloadCsv(filename: string, csv: string) {
  await downloadText(csv, filename, 'text/csv;charset=utf-8;', true)
}

type AdminShiftsProps = {
  orders: Order[]
  profiles: AppProfile[]
  payments: Payment[]
  sessions: QrSession[]
}

function paymentCanReopen(payment: Payment, payments: Payment[]): boolean {
  if (isVoidedPayment(payment)) return false
  if (!payment.sessionId || !payment.accountOpenedAt || !payment.accountClosedAt) return false
  return !payments.some((candidate) => (
    candidate.tableNumber === payment.tableNumber
    && candidate.id !== payment.id
    && Date.parse(candidate.createdAt) > Date.parse(payment.createdAt)
  ))
}

export function AdminShifts({ orders, profiles, payments, sessions }: AdminShiftsProps) {
  const d = useDict()
  const { profile } = useAuth()
  const [shifts, setShifts] = useState<Shift[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [voidingPayment, setVoidingPayment] = useState<Payment | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [voidError, setVoidError] = useState('')
  const [voidSaving, setVoidSaving] = useState<PaymentVoidAction | null>(null)
  const [recloseSessionId, setRecloseSessionId] = useState<string | null>(null)
  // Forçar saída pede confirmação inline (D5) em vez do confirm() nativo; por
  // shift.id porque pode haver vários turnos abertos ao mesmo tempo na lista.
  const forceCloseConfirm = useConfirmingId()
  const usernamesByUid = useMemo(
    () => new Map(profiles.map((userProfile) => [userProfile.uid, userProfile.username])),
    [profiles],
  )
  const shiftTotalsById = useMemo(
    () => new Map(shifts.map((shift) => [shift.id, calculateShiftTotals(shift, orders, payments, now)])),
    [shifts, orders, payments, now],
  )
  const recentPayments = useMemo(
    () => [...payments].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20),
    [payments],
  )
  const recloseSession = recloseSessionId
    ? sessions.find((session) => session.id === recloseSessionId && session.open === true) ?? null
    : null

  useEffect(() => {
    // D7: ao abrir o painel, varrer turnos esquecidos — o chefe vê logo os
    // auto-fechos em vez de turnos "abertos" há 20 horas. A subscrição traz
    // as mudanças a seguir; falhar aqui não parte o painel.
    void closeStaleShifts().catch(() => {})
    const unsubscribe = subscribeShifts((data) => {
      setShifts(data)
      setNow(Date.now())
      setLoading(false)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    // Os dados chegam por props via realtime no admin. Atualizamos o "agora"
    // fora do render para o turno aberto incluir alterações recentes.
    setNow(Date.now())
  }, [orders, payments, sessions])

  useEffect(() => {
    // As durações de quem está em turno contam ao vivo: um tique por minuto
    // chega (o ponto mostra horas e minutos, não segundos).
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  function getShiftTotals(shift: Shift): ShiftTotals {
    return shiftTotalsById.get(shift.id) ?? calculateShiftTotals(shift, orders, payments, now)
  }

  // Relógio de ponto: pode haver vários turnos abertos ao mesmo tempo (um por
  // pessoa). Quem pica entrada/saída é o próprio, na navbar.
  const openShifts = shifts.filter((shift) => shift.status === 'open')

  // Total de horas por pessoa, só dos turnos fechados listados (últimos 100):
  // um resumo rápido para o chefe sem precisar de exportar relatórios.
  const hoursByPerson = useMemo(() => {
    const totals = new Map<string, number>()
    shifts.forEach((shift) => {
      const hours = shiftDurationHours(shift)
      if (hours == null) return
      totals.set(shift.openedBy, (totals.get(shift.openedBy) ?? 0) + hours)
    })
    return [...totals.entries()].sort((a, b) => b[1] - a[1])
  }, [shifts])

  // Forçar a saída de quem se esqueceu de picar. closed_by fica quem forçou
  // (auditoria correta) — o trigger na BD garante isso.
  async function handleForceClose(shift: Shift) {
    if (!profile) return
    setError('')
    try {
      await closeShift(shift.id, profile.uid)
      forceCloseConfirm.confirmed(shift.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : d.admin.shifts.forceCloseGenericError)
    }
  }

  function getUsername(uid: string) {
    return usernamesByUid.get(uid) ?? d.admin.shifts.unknownUser
  }

  async function exportShiftCSV(shift: Shift) {
    const totals = getShiftTotals(shift)
    const csv = buildShiftCsv(shift, totals)
    const date = dateForFilename(shift.openedAt)
    await downloadCsv(`Turno_${shift.id.slice(0, 6)}_${date}.csv`, csv)
  }

  function openVoidModal(payment: Payment) {
    setVoidingPayment(payment)
    setVoidReason('')
    setVoidError('')
    setVoidSaving(null)
  }

  function closeVoidModal() {
    if (voidSaving) return
    setVoidingPayment(null)
    setVoidReason('')
    setVoidError('')
  }

  async function handleVoidPayment(action: PaymentVoidAction) {
    if (!voidingPayment) return
    const reason = voidReason.trim()
    if (!reason) {
      setVoidError(d.admin.shifts.payments.voidReasonRequired)
      return
    }

    setVoidSaving(action)
    setVoidError('')
    try {
      await voidPayment(voidingPayment.id, reason, action)
      if (action === 'reopen_and_close' && voidingPayment.sessionId) {
        setRecloseSessionId(voidingPayment.sessionId)
      }
      closeVoidModal()
    } catch (err) {
      setVoidError(err instanceof Error ? err.message : d.admin.shifts.payments.voidGenericError)
    } finally {
      setVoidSaving(null)
    }
  }

  if (loading) return <p className="text-muted-foreground">{d.admin.shifts.loading}</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Clock className="size-6 text-brand" />
          {d.admin.shifts.title}
        </h1>
        {/* Subtítulo + ⓘ do limite de pedidos, juntos no canto direito da linha. */}
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground">
            {d.admin.shifts.subtitle}
          </p>
          <OrdersLimitNotice count={orders.length} />
        </div>
      </div>

      {error && <Alert variant="destructive" className="mb-4">{error}</Alert>}

      <div className="bg-muted/40 border border-brand/20 p-5 rounded-lg mb-6">
        <h2 className="text-lg font-semibold text-brand mb-3">{d.admin.shifts.nowOnShift}</h2>
        {openShifts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{d.admin.shifts.noOneOnShift}</p>
        ) : (
          <ul className="space-y-3">
            {openShifts.map((shift) => {
              const totals = getShiftTotals(shift)
              return (
                <li key={shift.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-border bg-background/40 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{getUsername(shift.openedBy)}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.admin.shifts.clockedInAt(formatDateTime(shift.openedAt, { dateStyle: 'short', timeStyle: 'short' }))}
                      {' · '}{d.admin.shifts.timeAgo(formatDuration(now - timeFromIso(shift.openedAt)))}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums text-foreground">{formatEuro(totals.totalRevenue)}</p>
                      <p className="text-xs text-muted-foreground">
                        {d.admin.shifts.paymentsCount(totals.paymentCount)}
                      </p>
                    </div>
                    {forceCloseConfirm.isConfirming(shift.id) ? (
                      <>
                        <Button variant="ghost" size="sm" onClick={forceCloseConfirm.cancel}>
                          {d.admin.shifts.cancel}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleForceClose(shift)}
                          title={d.admin.shifts.confirmForceCloseTitle}
                        >
                          <Square className="size-3" fill="currentColor" />
                          {d.admin.shifts.confirmForceCloseOf(getUsername(shift.openedBy))}
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => forceCloseConfirm.requestConfirm(shift.id)}
                        title={d.admin.shifts.forceCloseTitle}
                      >
                        <Square className="size-3" fill="currentColor" />
                        {d.admin.shifts.forceClose}
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {hoursByPerson.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-5 mb-4">
          <h2 className="text-sm font-semibold text-foreground mb-1">{d.admin.shifts.hoursByPerson}</h2>
          <p className="text-xs text-muted-foreground mb-3">{d.admin.shifts.hoursByPersonSubtitle}</p>
          <div className="flex flex-wrap gap-2">
            {hoursByPerson.map(([uid, hours]) => (
              <span key={uid} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs">
                <span className="font-medium text-foreground">{getUsername(uid)}</span>
                <span className="tabular-nums text-muted-foreground">{formatDuration(hours * 3_600_000)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-lg overflow-hidden shadow-sm mb-4">
        {/* Wrapper relativo para a dica de scroll: em ecrã pequeno um gradiente
            na borda direita sugere que a tabela continua para o lado. */}
        <div className="relative">
          <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-sm min-w-[600px]">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left py-4 px-5 font-semibold text-foreground">{d.admin.shifts.columns.clockIn}</th>
                <th className="text-left py-4 px-5 font-semibold text-foreground">{d.admin.shifts.columns.clockOut}</th>
                <th className="text-left py-4 px-5 font-semibold text-foreground">{d.admin.shifts.columns.duration}</th>
                <th className="text-left py-4 px-5 font-semibold text-foreground">{d.admin.shifts.columns.staff}</th>
                <th className="text-right py-4 px-5 font-semibold text-foreground">{d.admin.shifts.columns.orders}</th>
                <th className="text-right py-4 px-5 font-semibold text-foreground">{d.admin.shifts.columns.revenue}</th>
                <th className="text-center py-4 px-5 font-semibold text-foreground">{d.admin.shifts.columns.export}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shifts.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 px-4 text-muted-foreground text-center">{d.admin.shifts.empty}</td>
                </tr>
              )}
              {shifts.map((shift) => {
                const { totalRevenue, orderCount, paymentCount } = getShiftTotals(shift)
                return (
                  <tr key={shift.id} className={`hover:bg-accent transition-colors ${shift.status === 'open' ? 'bg-brand/5' : ''}`}>
                    <td className="py-3 px-5">
                      {formatDateTime(shift.openedAt, { dateStyle: 'short', timeStyle: 'short' })}
                      {shift.status === 'open' && <Badge variant="outline" className="ml-2 bg-brand/20 text-brand border-transparent">{d.admin.shifts.openBadge}</Badge>}
                    </td>
                    <td className="py-3 px-5">
                      {shift.closedAt
                        ? formatDateTime(shift.closedAt, { dateStyle: 'short', timeStyle: 'short' })
                        : <span className="text-muted-foreground">—</span>}
                      {/* D7: turno fechado sozinho por exceder o máximo das
                          definições — a hora de saída é entrada + limite. */}
                      {shift.autoClosed && (
                        <Badge variant="warning" className="ml-2" title={d.admin.shifts.autoClosedTitle}>
                          {d.admin.shifts.autoClosedBadge}
                        </Badge>
                      )}
                    </td>
                    <td className="py-3 px-5 tabular-nums">
                      {shift.closedAt
                        ? formatDuration(timeFromIso(shift.closedAt) - timeFromIso(shift.openedAt))
                        : <span className="text-muted-foreground">{d.admin.shifts.inProgress}</span>}
                    </td>
                    <td className="py-3 px-5 text-muted-foreground text-xs">
                      {d.admin.shifts.clockInAbbrev(getUsername(shift.openedBy))}<br/>
                      {shift.closedAt && <>{d.admin.shifts.clockOutAbbrev(getUsername(shift.closedBy!))}</>}
                    </td>
                    <td className="py-3 px-5 text-right">
                      {orderCount}
                      <span className="ml-1 text-xs text-muted-foreground">{d.admin.shifts.paymentsAbbrevSuffix(paymentCount)}</span>
                    </td>
                    <td className="py-3 px-5 text-right font-medium text-foreground">
                      {formatEuro(totalRevenue)}
                    </td>
                    <td className="py-3 px-5 text-center">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => exportShiftCSV(shift)}
                        title={d.admin.shifts.exportCsvTitle}
                      >
                        <Download className="size-3.5" />
                        {d.admin.shifts.exportCsv}
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
          <div aria-hidden="true" className="sm:hidden pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-card to-transparent" />
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{d.admin.shifts.payments.title}</h2>
            <p className="text-xs text-muted-foreground">{d.admin.shifts.payments.subtitle}</p>
          </div>
        </div>
        {/* Mesmo padrão da tabela de turnos: gradiente como dica de scroll. */}
        <div className="relative">
          <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-5 py-3 text-left font-semibold text-foreground">{d.admin.shifts.payments.columns.date}</th>
                <th className="px-5 py-3 text-left font-semibold text-foreground">{d.admin.shifts.payments.columns.table}</th>
                <th className="px-5 py-3 text-left font-semibold text-foreground">{d.admin.shifts.payments.columns.method}</th>
                <th className="px-5 py-3 text-right font-semibold text-foreground">{d.admin.shifts.payments.columns.amount}</th>
                <th className="px-5 py-3 text-left font-semibold text-foreground">{d.admin.shifts.payments.columns.status}</th>
                <th className="px-5 py-3 text-right font-semibold text-foreground">{d.admin.shifts.payments.columns.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {recentPayments.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-center text-muted-foreground">{d.admin.shifts.payments.empty}</td>
                </tr>
              )}
              {recentPayments.map((payment) => {
                const voided = isVoidedPayment(payment)
                return (
                  <tr key={payment.id} className={voided ? 'text-muted-foreground' : 'text-foreground'}>
                    <td className="px-5 py-3">{formatDateTime(payment.createdAt, { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td className="px-5 py-3">{d.admin.orders.tableLabel(payment.tableNumber)}</td>
                    <td className="px-5 py-3">{PAYMENT_METHOD_LABEL[payment.method]}</td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums">{formatEuro(payment.amount)}</td>
                    <td className="px-5 py-3">
                      {voided ? (
                        <Badge variant="outline" className="bg-destructive/15 text-destructive border-transparent">
                          {d.admin.shifts.payments.voided}
                        </Badge>
                      ) : (
                        <Badge variant="success">{d.admin.shifts.payments.active}</Badge>
                      )}
                      {payment.voidReason && <p className="mt-1 text-xs text-muted-foreground">{payment.voidReason}</p>}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => openVoidModal(payment)}
                        disabled={voided}
                      >
                        <RotateCcw className="size-3.5" />
                        {d.admin.shifts.payments.voidButton}
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
          <div aria-hidden="true" className="sm:hidden pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-card to-transparent" />
        </div>
      </div>

      {voidingPayment && (
        <Modal onClose={closeVoidModal} aria-labelledby="void-payment-title" maxWidth="max-w-lg">
          <ModalHeader
            title={d.admin.shifts.payments.voidModal.titleFor(voidingPayment.tableNumber)}
            titleId="void-payment-title"
            closeDisabled={Boolean(voidSaving)}
          />
          <p className="-mt-2 mb-4 text-sm text-muted-foreground">
            {d.admin.shifts.payments.voidModal.summary(formatEuro(voidingPayment.amount), PAYMENT_METHOD_LABEL[voidingPayment.method])}
          </p>

          <div className="space-y-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="void-payment-reason" className="text-sm text-muted-foreground">{d.admin.shifts.payments.voidModal.reasonLabel}</label>
              <textarea
                id="void-payment-reason"
                value={voidReason}
                onChange={(event) => { setVoidReason(event.target.value); setVoidError('') }}
                rows={3}
                maxLength={500}
                className="resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-brand focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </div>

            {!paymentCanReopen(voidingPayment, payments) && (
              <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {d.admin.shifts.payments.voidModal.cannotReopenHint}
              </p>
            )}

            {voidError && <Alert variant="destructive">{voidError}</Alert>}

            <div className="grid gap-2 sm:grid-cols-3">
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => handleVoidPayment('void_only')}
                disabled={Boolean(voidSaving)}
              >
                {voidSaving === 'void_only' ? d.admin.shifts.payments.voidModal.voidingOnly : d.admin.shifts.payments.voidModal.voidOnly}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => handleVoidPayment('reopen_session')}
                disabled={Boolean(voidSaving) || !paymentCanReopen(voidingPayment, payments)}
              >
                {voidSaving === 'reopen_session' ? d.admin.shifts.payments.voidModal.reopening : d.admin.shifts.payments.voidModal.voidAndReopen}
              </Button>
              <Button
                type="button"
                size="lg"
                onClick={() => handleVoidPayment('reopen_and_close')}
                disabled={Boolean(voidSaving) || !paymentCanReopen(voidingPayment, payments)}
              >
                {voidSaving === 'reopen_and_close' ? d.admin.shifts.payments.voidModal.preparing : d.admin.shifts.payments.voidModal.voidAndRedo}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {recloseSessionId && !recloseSession && (
        <p className="text-sm text-muted-foreground" role="status">{d.admin.shifts.payments.reopeningStatus}</p>
      )}

      {recloseSession && (
        <CloseBillModal
          session={recloseSession}
          orders={orders}
          onClosed={() => setRecloseSessionId(null)}
          onCancel={() => setRecloseSessionId(null)}
        />
      )}
    </div>
  )
}
