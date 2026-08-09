import { useEffect, useRef, useState } from 'react'
import { Ban } from 'lucide-react'
import { Modal, ModalFooter, ModalHeader } from './modal'
import { useModalClose } from '../hooks/use-modal-close'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { CancelOrderModal } from './cancel-order-modal'
import { CANCELLABLE_STATUSES } from '../lib/order-cancel'
import { formatEuro } from '../lib/helpers'
import { useAuth } from '../lib/auth-context'
import { useMyShift } from '../lib/shift-context'
import { isShiftRequired } from '../lib/shift-gate'
import type { QrSession } from '../lib/db'
import { cancelOrder, closeSession, createPayment, createShift, getMyActiveShift, getOrdersBySession, resolveServiceCallsForSession } from '../lib/db'
import { hapticSuccess } from '../lib/haptics'
import type { Order } from '../@types/order'
import { accountTotals, currentAccountOrders, orderDiscountAmount, orderItemsRevenue, unfinishedAccountOrders } from '../lib/account'
import { orderSubtotal } from '../lib/order-utils'
import { statusLabel } from '../lib/order-status-ui'
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type PaymentMethod } from '../@types/payment'
import { useDict } from '../lib/i18n'

interface Props {
  session: QrSession
  // Pedidos já em tempo real no mapa — evita um fetch extra e o total é imediato.
  orders: Order[]
  // Chamado depois de o pagamento ser gravado e a sessão encerrada.
  onClosed: (sessionId: string) => void
  onCancel: () => void
}

// Fecho de conta: recalcula o total a partir dos pedidos da sessão (nunca de um
// valor enviado pelo cliente), regista o pagamento com o meio escolhido e só
// depois encerra a sessão. Se o pagamento falhar, a conta NÃO é perdida.
export function CloseBillModal({ session, orders, onClosed, onCancel }: Props) {
  const d = useDict()
  const { profile } = useAuth()
  // Fecho animado do Modal quando disponível por contexto; se vier null, o
  // botão "Cancelar" cai no onCancel cru recebido por prop.
  const requestClose = useModalClose()
  // Total inicial a partir dos pedidos já subscritos no mapa. Logo a seguir
  // buscamos a sessão diretamente para não fechar conta com a lista global
  // truncada a 200 pedidos.
  const [sessionOrders, setSessionOrders] = useState<Order[]>(() => currentAccountOrders(session, orders))
  const [loadingOrders, setLoadingOrders] = useState(true)
  const unfinishedOrders = unfinishedAccountOrders(session, sessionOrders)
  const totals = accountTotals(session, sessionOrders)
  const total = totals.total
  const billableOrders = sessionOrders.filter((order) => order.status !== 'cancelled')
  const [method, setMethod] = useState<PaymentMethod>('dinheiro')
  const [error, setError] = useState('')
  const [ordersLoadFailed, setOrdersLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  // Pedido a cancelar diretamente no fecho da conta (motivo no CancelOrderModal).
  const [cancellingOrder, setCancellingOrder] = useState<Order | null>(null)

  // Relógio de ponto: fechar contas exige o PRÓPRIO turno aberto para
  // empregado/gerente (a BD valida no trigger); o admin está isento e cobra
  // sem turno. O turno vem do ShiftProvider (subscrição única, em tempo real).
  const { myShift, shiftLoaded } = useMyShift()
  const needShift = isShiftRequired(profile?.role)
  const [punchingIn, setPunchingIn] = useState(false)

  // Picar a entrada sem sair do fecho de conta: abre o turno do próprio e o
  // pagamento segue associado a ele. O Realtime do provider traz o turno novo
  // e o botão de confirmar reativa sozinho.
  async function handlePunchIn() {
    if (!profile) return
    setPunchingIn(true)
    setError('')
    try {
      await createShift(profile.uid)
    } catch (err) {
      // Corrida entre dispositivos: se o turno afinal já existe, o provider
      // vai recebê-lo — só mostramos erro quando não há mesmo turno.
      const existing = await getMyActiveShift(profile.uid).catch(() => null)
      if (!existing) {
        setError(err instanceof Error ? err.message : d.employee.bill.punchInFailedError)
      }
    } finally {
      setPunchingIn(false)
    }
  }

  // Idempotência do pagamento: id estável por conta. Se a rede falhar entre o
  // pagamento e o fecho da sessão e o staff repetir, o mesmo id faz a BD ignorar
  // o 2.º insert em vez de cobrar a conta duas vezes.
  const paymentRequestId = useRef<string | null>(null)
  // Pagamento já gravado nesta conta — um retry salta o createPayment e só
  // repete o fecho da sessão (resolver chamadas + closeSession).
  const paymentDone = useRef(false)

  useEffect(() => {
    let active = true
    // Conta diferente → novo id de pagamento e estado de fecho limpo.
    paymentRequestId.current = crypto.randomUUID()
    paymentDone.current = false
    // Ao trocar de sessão no modal, recomeçamos a confirmação dos pedidos antes
    // do fetch direto à BD. É estado de sincronização do próprio efeito.
    setLoadingOrders(true)
    setOrdersLoadFailed(false)
    getOrdersBySession(session.id, session.openedAt)
      .then((freshOrders) => {
        if (active) setSessionOrders(freshOrders)
      })
      .catch((err) => {
        if (active) {
          setOrdersLoadFailed(true)
          setError(d.employee.bill.ordersConfirmError(err instanceof Error ? err.message : String(err)))
        }
      })
      .finally(() => {
        if (active) setLoadingOrders(false)
      })

    return () => {
      active = false
    }
    // "d" fica de fora de propósito: reagir a uma troca de idioma aqui reiniciaria
    // o paymentRequestId/paymentDone e repetiria o fetch dos pedidos sem motivo —
    // este efeito só deve correr quando a CONTA muda, não quando o idioma muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, session.openedAt])

  // Recarrega os pedidos da conta direto da BD (mesma query do efeito). Usado
  // depois de cancelar um pedido aqui, já que este modal não está em Realtime —
  // sem isto a lista e o "por concluir" não atualizavam.
  async function refreshSessionOrders() {
    const fresh = await getOrdersBySession(session.id, session.openedAt)
    setSessionOrders(fresh)
  }

  async function handleConfirm() {
    if (!profile) return
    setSaving(true)
    setError('')
    try {
      if (unfinishedOrders.length > 0) {
        setError(d.employee.bill.unfinishedOrdersError)
        setSaving(false)
        return
      }

      // O botão fica desativado sem turno, mas revalidamos aqui na mesma para
      // dar uma mensagem clara em vez do erro cru da BD. Fechar a sessão
      // também é operação; a guarda vale mesmo com total zero.
      if (needShift && !myShift) {
        setError(d.employee.bill.notInShiftError)
        setSaving(false)
        return
      }

      // Sessão sem consumo (total 0): não faz sentido um registo de pagamento —
      // apenas encerramos. Evita poluir as estatísticas com pagamentos de €0.
      // O paymentDone evita repetir o createPayment num retry após falha parcial.
      if (total > 0 && !paymentDone.current) {
        const requestId = paymentRequestId.current ?? crypto.randomUUID()
        paymentRequestId.current = requestId
        await createPayment({
          tableNumber: session.tableNumber,
          sessionId: session.id,
          requestId,
          // Admin cobra sem turno: shiftId segue vazio e a BD aceita (isenção
          // do dono); para empregado/gerente vai sempre preenchido.
          shiftId: myShift?.id,
          amount: total,
          method,
          createdAt: new Date().toISOString(),
          createdBy: profile.uid,
        })
        paymentDone.current = true
      }
      // Só mexemos na sessão depois de o pagamento estar gravado. Fechamos por
      // sessionId para preservar o histórico e não resolver chamadas antigas da mesa.
      await resolveServiceCallsForSession(session.id)
      await closeSession(session.id)
      // Confirmação tátil de conta fechada (no-op na web).
      void hapticSuccess()
      onClosed(session.id)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      if (paymentDone.current) {
        // Pagamento já gravado (id idempotente): só falhou encerrar a sessão.
        // Tranquiliza o staff — um novo "Confirmar" salta o pagamento e só
        // repete o fecho, sem risco de cobrar a conta duas vezes.
        setError(d.employee.bill.paymentDoneCloseFailedError(detail))
      } else {
        setError(d.employee.bill.closeFailedError(detail))
      }
      setSaving(false)
    }
  }

  return (
    <>
    <Modal onClose={saving ? undefined : onCancel} aria-labelledby="close-bill-title">
      <ModalHeader
        title={d.employee.bill.modalTitle(session.tableNumber)}
        titleId="close-bill-title"
        closeDisabled={saving}
      />

      <div className="space-y-5">
          <div className="text-center bg-muted/40 border border-border rounded-lg py-5">
            <p className="text-xs text-muted-foreground uppercase tracking-widest">{d.employee.bill.totalToPay}</p>
            <p className="text-4xl font-black text-foreground mt-1">{formatEuro(total)}</p>
            {loadingOrders && <p className="mt-2 text-xs text-muted-foreground" role="status">{d.employee.bill.confirmingOrders}</p>}
          </div>

          <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
            <p className="mb-3 font-semibold text-foreground">{d.employee.bill.composition}</p>
            <dl className="space-y-2">
              {session.mode === 'rodizio' && (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">
                    {d.employee.bill.entryRodizio}
                    {session.headcount ? ` · ${session.headcount} ${d.employee.personWord(session.headcount)}` : ''}
                  </dt>
                  <dd className="font-semibold tabular-nums text-foreground">{formatEuro(totals.entry)}</dd>
                </div>
              )}
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{d.employee.bill.extrasAndOrders}</dt>
                <dd className="font-semibold tabular-nums text-foreground">{formatEuro(totals.submittedExtras)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-border pt-2">
                <dt className="font-semibold text-foreground">{d.employee.bill.total}</dt>
                <dd className="font-bold tabular-nums text-brand">{formatEuro(totals.total)}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-lg border border-border bg-muted/40 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-foreground">{d.employee.bill.ordersIncluded}</p>
              <span className="text-xs text-muted-foreground">{d.employee.orderCountLabel(billableOrders.length)}</span>
            </div>

            {billableOrders.length === 0 ? (
              <p className="text-xs text-muted-foreground">{d.employee.bill.noPaidOrders}</p>
            ) : (
              <ul className="max-h-44 space-y-2 overflow-y-auto pr-1 text-xs custom-scrollbar">
                {billableOrders.map((order) => {
                  const subtotal = orderSubtotal(order)
                  const discount = orderDiscountAmount(order)
                  const revenue = orderItemsRevenue(order)
                  return (
                    <li key={order.id} className="rounded-lg border border-border bg-background/40 p-3">
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <span className="font-medium text-foreground">{d.employee.bill.orderWithStatus(statusLabel[order.status])}</span>
                        <span className="font-semibold tabular-nums text-foreground">{formatEuro(revenue)}</span>
                      </div>
                      <p className="text-muted-foreground">
                        {order.items.map((item) => `${item.quantity}× ${item.menuItemName}`).join(', ')}
                      </p>
                      {discount > 0 && (
                        <p className="mt-1 text-muted-foreground">
                          {d.employee.bill.subtotalDiscountLine(formatEuro(subtotal), formatEuro(discount))}
                        </p>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {unfinishedOrders.length > 0 && (
            <Alert variant="warning">
              <AlertTitle>{d.employee.bill.unfinishedTitle}</AlertTitle>
              <AlertDescription className="mt-1">
                {d.employee.bill.unfinishedDescription}
              </AlertDescription>
              <ul className="mt-3 space-y-2 text-xs">
                {unfinishedOrders.map((order) => (
                  <li key={order.id} className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      {statusLabel[order.status]} · {order.items.map((item) => `${item.quantity}× ${item.menuItemName}`).join(', ')}
                    </span>
                    {CANCELLABLE_STATUSES.includes(order.status) && (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        onClick={() => setCancellingOrder(order)}
                        aria-label={d.employee.tableActions.cancelOrderAria(session.tableNumber)}
                        title={d.employee.tableActions.cancelOrderTitle}
                      >
                        <Ban />
                        {d.common.cancel}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Alert>
          )}

          {needShift && shiftLoaded && !myShift && (
            <Alert variant="warning">
              <AlertTitle>{d.employee.bill.notInShiftTitle}</AlertTitle>
              <AlertDescription className="mt-1">
                {d.employee.bill.notInShiftDescription}
              </AlertDescription>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handlePunchIn}
                disabled={punchingIn}
                className="mt-3"
              >
                {punchingIn ? d.employee.bill.punchingIn : d.employee.bill.punchInNow}
              </Button>
            </Alert>
          )}

          {total > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{d.employee.bill.paymentMethod}</p>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_METHODS.map((m) => {
                const active = method === m
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethod(m)}
                    className={`py-2.5 rounded-lg text-sm font-medium border transition-all ${
                      active
                        ? 'bg-brand/15 border-brand text-brand'
                        : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
                    }`}
                  >
                    {PAYMENT_METHOD_LABEL[m]}
                  </button>
                )
              })}
            </div>
          </div>
          )}

          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>

      <ModalFooter>
        <Button type="button" variant="outline" size="lg" onClick={requestClose ?? onCancel} disabled={saving}>
          {d.common.cancel}
        </Button>
        <Button
          type="button"
          size="lg"
          onClick={handleConfirm}
          disabled={saving || loadingOrders || ordersLoadFailed || unfinishedOrders.length > 0 || (needShift && !myShift)}
        >
          {saving ? d.employee.bill.closing : d.employee.bill.confirmAndClose}
        </Button>
      </ModalFooter>
    </Modal>

    {cancellingOrder && (
      <CancelOrderModal
        order={cancellingOrder}
        tableNumber={session.tableNumber}
        onClose={() => setCancellingOrder(null)}
        onConfirm={async (reason) => {
          // O autor fica registado em cancelled_by para auditoria. Guard ao
          // profile como no handleConfirm (a sessão pode ter caído).
          if (!profile) throw new Error(d.employee.invalidSessionError)
          await cancelOrder(cancellingOrder.id, reason, profile.uid)
          // Atualiza a conta: o pedido sai de "por concluir" e, se não restar
          // nenhum, o botão de fechar reativa.
          await refreshSessionOrders()
        }}
      />
    )}
    </>
  )
}
