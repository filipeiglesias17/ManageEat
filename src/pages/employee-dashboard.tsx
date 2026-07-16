import { useCallback, useEffect, useRef, useState, type FormEvent, type AnimationEvent as ReactAnimationEvent } from 'react'
import { createPortal } from 'react-dom'
import { ClipboardList, MapPin, ShoppingCart, Tag, X, WifiOff } from 'lucide-react'
import { createOrder, subscribeSessions, subscribeOrders, subscribeServiceCalls } from '../lib/db'
import type { QrSession } from '../lib/db'
import type { DiscountType, Order } from '../@types/order'
import type { ServiceCall } from '../@types/service-call'
import type { StaffNotification } from '../@types/notification'
import type { SessionMode } from '../@types/settings'
import { buildOrderItems, useCart, validateCartAgainstMenu } from '../hooks/use-cart'
import { useAnimatedList } from '../hooks/use-animated-list'
import { useMenuData } from '../hooks/use-menu-data'
import { useToast } from '../hooks/use-toast'
import { useConnectionAlert } from '../hooks/use-connection-alert'
import { randomUUID, formatEuro, isNetworkError } from '../lib/helpers'
import {
  clearEmployeeOrderCartDraft,
  clearEmployeeOrderDiscountDraft,
  employeeOrderDraftCountsBySessionId,
  employeeOrderDraftKey,
  readEmployeeOrderDiscountDraft,
  writeEmployeeOrderDiscountDraft,
} from '../lib/employee-order-drafts'
import { MenuBrowser } from '../components/menu-browser'
import { CartRow } from '../components/cart-row'
import { ServiceCallsPanel } from '../components/service-calls-panel'
import { ShiftGateBanner } from '../components/shift-gate-banner'
import { TableMap } from '../components/table-map'
import { useAudioAlert, type AlertSound } from '../hooks/use-audio-alert'
import { useServiceNotifications } from '../hooks/use-service-notifications'
import { requestNotificationPermissions, haptic, presentNativeNotification, registerNotificationTap } from '../lib/notifications'
import { hapticSuccess } from '../lib/haptics'
import { useAuth } from '../lib/auth-context'
import { useMyShift } from '../lib/shift-context'
import { SHIFT_GATE_MESSAGE } from '../lib/shift-gate'
import { useDict } from '../lib/i18n'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const EMPTY_EMPLOYEE_CART_KEY = 'employee_no_selected_table'

// Rede de segurança do fecho animado da gaveta: se o animationend nunca
// disparar, a gaveta fecha na mesma passado este tempo (slide-down dura 250ms).
const CART_CLOSE_FALLBACK_MS = 350

// Cada tipo de notificação tem um som próprio para o empregado distinguir sem
// olhar (chamada vs conta vs pronto vs atrasado).
const SOUND_BY_KIND: Record<StaffNotification['kind'], AlertSound> = {
  waiter_call: 'call',
  bill_request: 'bill',
  order_ready: 'ready',
  order_late: 'late',
}

export function EmployeeDashboard() {
  const d = useDict()
  const { categories, menuItems, loading: menuLoading } = useMenuData()
  // Uid para o rascunho por utilizador (D4).
  const { profile } = useAuth()
  // D1: o dashboard inteiro fica em modo "só ver" fora de turno.
  const { canOperate, shiftLoaded } = useMyShift()
  const [error, setError] = useState('')
  // Sucesso vai por toast global: o envio fecha a gaveta e desmonta a section,
  // por isso uma mensagem local desaparecia antes de o empregado a ver.
  const toast = useToast()
  const [submitting, setSubmitting] = useState(false)
  const [discountType, setDiscountType] = useState<DiscountType>('percent')
  const [discountValue, setDiscountValue] = useState('')

  // ── Sessões (geridas no mapa de mesas) ──
  const [sessions, setSessions] = useState<QrSession[]>([])
  // Aviso de ligação perdida (só aparece se persistir): o mapa de mesas pode
  // ficar desatualizado; avisamos em vez de mostrar mesas paradas em silêncio.
  const { visible: sessionsFeedError, markOk: feedOk, markError: feedFail } = useConnectionAlert()
  // Pedidos e chamadas em tempo real: hub único para o mapa de mesas, o painel
  // de chamadas e o motor de notificações (evita subscrições duplicadas).
  const [orders, setOrders] = useState<Order[]>([])
  const [calls, setCalls] = useState<ServiceCall[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [isCartOpen, setIsCartOpen] = useState(false)
  // Fecho ANIMADO da gaveta (mesmo padrão do Modal): `cartClosing` troca o
  // slide-up pelo slide-down e a gaveta só desmonta quando a animação termina
  // (ou no timeout de segurança, se o animationend nunca disparar).
  const [cartClosing, setCartClosing] = useState(false)
  const cartCloseTimerRef = useRef<number | null>(null)
  // Ação adiada para o fim do fecho (ex.: desmarcar a mesa depois de enviar o
  // pedido). Em ref, para o animationend e o timeout lerem o valor atual.
  const afterCartCloseRef = useRef<(() => void) | null>(null)
  const cartDialogRef = useRef<HTMLDivElement>(null)
  const cartTriggerRef = useRef<HTMLButtonElement>(null)
  const orderPanelRef = useRef<HTMLDivElement>(null)
  const orderTitleRef = useRef<HTMLHeadingElement>(null)

  // ── Motor de notificações do empregado ──
  // Sem cartão flutuante in-app: o painel de chamadas e o mapa já mostram o
  // estado; aqui só disparamos som + vibração + notificação nativa do sistema.
  const playAlert = useAudioAlert()
  const mapRef = useRef<HTMLElement>(null)
  const [highlightedSessionId, setHighlightedSessionId] = useState<string | null>(null)
  const highlightTimerRef = useRef<number | undefined>(undefined)

  // Um evento novo levanta um cartão + som próprio do tipo. (Na Fase 2 junta-se
  // vibração e notificação nativa neste mesmo ponto.)
  const handleNewNotification = useCallback(
    (notification: StaffNotification) => {
      playAlert(SOUND_BY_KIND[notification.kind])
      // Fase 2 (nativo): vibração + banner do sistema. No-op na web.
      haptic(notification.kind)
      presentNativeNotification(notification)
    },
    [playAlert],
  )
  useServiceNotifications(orders, calls, sessions, handleNewNotification)

  // Tocar numa notificação destaca a mesa no mapa e traz o mapa à vista.
  const handleOpenTableFromNotification = useCallback((sessionId?: string) => {
    if (!sessionId) return
    setHighlightedSessionId(sessionId)
    mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current)
    highlightTimerRef.current = window.setTimeout(() => setHighlightedSessionId(null), 4000)
  }, [])

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current)
      if (cartCloseTimerRef.current !== null) window.clearTimeout(cartCloseTimerRef.current)
    }
  }, [])

  // ── Fecho animado da gaveta do carrinho ──
  // Conclui o fecho: limpa o timer de segurança, desmonta a gaveta e corre a
  // ação adiada (se houver). Chamado pelo animationend OU pelo timeout.
  const finishCartClose = useCallback(() => {
    if (cartCloseTimerRef.current !== null) {
      window.clearTimeout(cartCloseTimerRef.current)
      cartCloseTimerRef.current = null
    }
    setIsCartOpen(false)
    setCartClosing(false)
    const afterClose = afterCartCloseRef.current
    afterCartCloseRef.current = null
    afterClose?.()
  }, [])

  // Pede o fecho: troca para a animação de saída e agenda o timeout de
  // segurança. O guard é pelo ref do timer (não pelo estado `cartClosing`)
  // porque o handler do Escape vive num closure antigo e um estado obsoleto
  // deixaria agendar dois fechos.
  const requestCartClose = useCallback((afterClose?: () => void) => {
    if (afterClose) afterCartCloseRef.current = afterClose
    if (cartCloseTimerRef.current !== null) return
    setCartClosing(true)
    cartCloseTimerRef.current = window.setTimeout(finishCartClose, CART_CLOSE_FALLBACK_MS)
  }, [finishCartClose])

  function handleCartPanelAnimationEnd(e: ReactAnimationEvent<HTMLDivElement>) {
    // Só a animação do próprio painel conta — os filhos (linhas do carrinho em
    // saída) também disparam animationend. E só durante o fecho: o slide-up de
    // entrada também termina com um animationend.
    if (!cartClosing || e.target !== e.currentTarget) return
    finishCartClose()
  }

  // Notificações nativas (Fase 2): pedir permissão uma vez e encaminhar o toque
  // no banner do sistema para abrir a mesa. Tudo no-op na web.
  useEffect(() => {
    requestNotificationPermissions()
    let cleanup = () => {}
    registerNotificationTap(handleOpenTableFromNotification).then((fn) => {
      cleanup = fn
    })
    return () => cleanup()
  }, [handleOpenTableFromNotification])

  // Uma sessão só serve para enviar pedidos se estiver aberta E não expirada.
  // O "agora" é lido no render: as sessões chegam por subscrição em tempo real,
  // por isso recalcular aqui chega — não é preciso um timer dedicado.
  function isSessionAtivaParaPedir(s: QrSession): boolean {
    if (s.open !== true) return false
    if (!s.expiresAt) return true
    return new Date(s.expiresAt).getTime() > Date.now()
  }

  const selectedSession = selectedSessionId
    ? sessions.find((session) => session.id === selectedSessionId) ?? null
    : null
  const activeTableSession = selectedSession && isSessionAtivaParaPedir(selectedSession)
    ? selectedSession
    : null
  const selectedTableNumber = selectedSession?.tableNumber ?? null
  const currentOrderMode: SessionMode = activeTableSession?.mode === 'rodizio' ? 'rodizio' : 'normal'
  // Rascunho por utilizador (D4): a chave leva o uid para o próximo login no
  // mesmo aparelho não herdar o carrinho de quem saiu.
  const employeeCartKey = employeeOrderDraftKey(activeTableSession, profile?.uid)

  const { cart, setCart, total, count, plainQuantities, addToCart, decrementFromCart, updateQty, updateNotes, toggleIngredient, updateItemDiscount } = useCart(
    currentOrderMode,
    employeeCartKey ?? EMPTY_EMPLOYEE_CART_KEY,
  )

  // Linhas do carrinho com saída animada: uma linha removida fica ~220ms
  // marcada como `leaving` para colapsar com animate-sink em vez de sumir seca.
  const cartEntries = useAnimatedList(cart, (c) => c.uid)

  const draftCountsBySessionId = {
    ...employeeOrderDraftCountsBySessionId(sessions, profile?.uid, sessionStorage),
  }
  if (activeTableSession) {
    if (count > 0) {
      draftCountsBySessionId[activeTableSession.id] = count
    } else {
      delete draftCountsBySessionId[activeTableSession.id]
    }
  }

  // Calcula o desconto global do pedido, nunca ultrapassando o total.
  function computeDiscountAmount(): number {
    const v = Number(discountValue)
    if (!discountValue || isNaN(v) || v <= 0) return 0
    if (discountType === 'percent') return Math.min(total * (v / 100), total)
    return Math.min(v, total)
  }

  const discountAmount = computeDiscountAmount()
  const finalTotal = total - discountAmount

  function handleOrderForSession(session: QrSession) {
    if (!isSessionAtivaParaPedir(session)) {
      setSelectedSessionId(session.id)
      setError(d.employee.order.noOpenSessionError)
      return
    }

    setSelectedSessionId(session.id)
    setIsCartOpen(false)
    setError('')
    window.setTimeout(() => {
      orderPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      orderTitleRef.current?.focus({ preventScroll: true })
    }, 0)
  }

  function clearSelectedTable() {
    setSelectedSessionId(null)
    setIsCartOpen(false)
    setError('')
  }

  function handleDiscountTypeChange(nextType: DiscountType) {
    setDiscountType(nextType)
    writeEmployeeOrderDiscountDraft(sessionStorage, employeeCartKey, {
      discountType: nextType,
      discountValue,
    })
  }

  function handleDiscountValueChange(nextValue: string) {
    setDiscountValue(nextValue)
    writeEmployeeOrderDiscountDraft(sessionStorage, employeeCartKey, {
      discountType,
      discountValue: nextValue,
    })
  }

  // Sessões em tempo real (permanentes + temporárias). O mapa de mesas é o hub
  // onde o empregado as inicia/gere; aqui guardamos a lista para detetar o modo
  // da mesa no fluxo de pedido e para alimentar o mapa.
  useEffect(() => {
    return subscribeSessions(
      (list) => {
        feedOk()
        setSessions(list)
      },
      feedFail,
    )
  }, [feedOk, feedFail])

  useEffect(() => {
    return subscribeOrders(
      (list) => {
        feedOk()
        setOrders(list)
      },
      feedFail,
    )
  }, [feedOk, feedFail])

  useEffect(() => {
    return subscribeServiceCalls(
      (list) => {
        feedOk()
        setCalls(list)
      },
      feedFail,
    )
  }, [feedOk, feedFail])

  useEffect(() => {
    if (!selectedSessionId) return
    if (sessions.some((session) => session.id === selectedSessionId)) return

    // Se a sessão temporária expirou e saiu da lista, deixa de haver destino
    // seguro para o pedido. O rascunho antigo fica isolado pela chave da sessão.
    setSelectedSessionId(null)
    setIsCartOpen(false)
  }, [selectedSessionId, sessions])

  useEffect(() => {
    const draft = readEmployeeOrderDiscountDraft(sessionStorage, employeeCartKey)
    setDiscountType(draft.discountType)
    setDiscountValue(draft.discountValue)
  }, [employeeCartKey])

  useEffect(() => {
    if (!isCartOpen) return

    const previousFocus = document.activeElement as HTMLElement | null
    cartDialogRef.current?.focus()

    function handleKey(event: KeyboardEvent) {
      // Fecho animado (não desmontar já): igual ao backdrop e ao X.
      if (event.key === 'Escape') requestCartClose()
    }

    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('keydown', handleKey)
      if (previousFocus && document.contains(previousFocus)) previousFocus.focus()
    }
  }, [isCartOpen, requestCartClose])

  async function handlePlaceOrder(e: FormEvent) {
    e.preventDefault()
    setError('')
    // D1: sem turno picado o pedido ia bater no trigger da BD — mensagem
    // amigável em vez do erro cru (o botão já fica desativado, isto é backstop).
    if (!canOperate) {
      setError(d.employee.order.offShiftError)
      return
    }
    if (cart.length === 0) { setError(d.employee.order.emptyCartError); return }
    if (!activeTableSession) {
      setError(d.employee.order.noTableSelectedError)
      return
    }
    if (activeTableSession.expiresAt && new Date(activeTableSession.expiresAt).getTime() <= Date.now()) {
      setError(d.employee.order.sessionExpiredError)
      return
    }

    // Limites do desconto global: sem isto o valor era gravado tal e qual no
    // pedido (ex: 150% ou €50 num pedido de €10) e o total ficava negativo.
    const discountEntered = Number(discountValue)
    if (discountValue && discountType === 'percent' && discountEntered > 100) {
      setError(d.employee.order.discountPercentTooHighError)
      return
    }
    if (discountValue && discountType === 'euros' && discountEntered > total) {
      setError(d.employee.order.discountEurosTooHighError)
      return
    }
    // Falhar já aqui, sem tentar sequer o fetch: em Wi-Fi fraco o pedido ficava
    // "A enviar..." até o timeout do Supabase e só depois avisava — o empregado
    // ficava às escuras esse tempo todo, a pensar que o pedido tinha um erro.
    if (!navigator.onLine) {
      setError(d.employee.order.offlineError)
      return
    }

    const orderSession = activeTableSession
    const orderDraftKey = employeeCartKey

    setSubmitting(true)
    try {
      const validation = validateCartAgainstMenu(cart, menuItems, currentOrderMode)
      if (!validation.ok) {
        setCart(validation.cart)
        setError(d.employee.order.invalidCartSuffix(validation.message))
        return
      }

      await createOrder({
        requestId: randomUUID(),
        tableNumber: orderSession.tableNumber,
        source: 'empregado',
        sessionId: orderSession.id,
        items: buildOrderItems(validation.cart, currentOrderMode, { includeItemDiscount: true }),
        status: 'pending',
        createdAt: new Date().toISOString(),
        ...(discountAmount > 0 && { discountType, discountValue: Number(discountValue) }),
        ...(currentOrderMode === 'rodizio' && {
          // entryPrice/headcount vêm do snapshot da sessão (não da config global):
          // o trigger orders_validate_insert exige que o pedido traga exatamente
          // o entry_price/headcount da sessão, senão rejeita o insert.
          entryPrice: orderSession.entryPrice,
          headcount: orderSession.headcount,
          mode: 'rodizio',
        }),
      })

      clearEmployeeOrderCartDraft(sessionStorage, orderSession, profile?.uid)
      setCart([])
      clearEmployeeOrderDiscountDraft(sessionStorage, orderDraftKey)
      setDiscountType('percent')
      setDiscountValue('')
      // Fecho animado; a mesa só é desmarcada quando a gaveta acaba de descer —
      // desmarcá-la já desmontava o portal e cortava a animação a meio.
      requestCartClose(() => setSelectedSessionId(null))
      toast.success(d.employee.order.sentSuccess)
      // Vibração curta de "concluído" a acompanhar o toast (no-op na web).
      void hapticSuccess()
    } catch (err) {
      // Erro de rede não é culpa do carrinho — o carrinho pode estar perfeito,
      // só a ligação ao servidor falhou. Só pedimos para "corrigir o carrinho"
      // quando o erro vem mesmo da validação da BD.
      if (isNetworkError(err)) {
        setError(d.employee.order.networkSendError)
      } else {
        const msg = err instanceof Error ? err.message : String(err)
        setError(d.employee.order.sendErrorWithMessage(msg))
      }
    } finally {
      setSubmitting(false)
    }
  }

  function renderCartForm(formIdPrefix: string) {
    const discountInputId = `${formIdPrefix}-discount`

    return (
      <form onSubmit={handlePlaceOrder} className="space-y-4">
        <div className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={discountInputId} className="text-muted-foreground gap-1.5">
              <Tag className="size-3" />
              {d.employee.discount.globalLabel}
            </Label>
            <div className="flex items-center gap-1">
              <Input
                id={discountInputId}
                type="number"
                value={discountValue}
                onChange={(e) => handleDiscountValueChange(e.target.value)}
                min="0"
                step="0.01"
                placeholder="0"
                className="text-center"
              />
              <div className="flex rounded-md overflow-hidden border border-border shrink-0">
                <button
                  type="button"
                  onClick={() => handleDiscountTypeChange('percent')}
                  aria-label={d.employee.discount.percentAria}
                  aria-pressed={discountType === 'percent'}
                  className={`px-3 h-9 text-sm font-medium transition-colors ${
                    discountType === 'percent'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground hover:text-foreground'
                  }`}
                >
                  %
                </button>
                <button
                  type="button"
                  onClick={() => handleDiscountTypeChange('euros')}
                  aria-label={d.employee.discount.eurosAria}
                  aria-pressed={discountType === 'euros'}
                  className={`px-3 h-9 text-sm font-medium transition-colors ${
                    discountType === 'euros'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground hover:text-foreground'
                  }`}
                >
                  €
                </button>
              </div>
            </div>
          </div>

          {/* Totais */}
          <div className="border-t border-border pt-4 flex justify-between items-center">
            <span className="text-sm text-muted-foreground">{d.employee.cart.total}</span>
            {discountAmount > 0 ? (
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-muted-foreground line-through">{formatEuro(total)}</span>
                <span className="text-lg font-bold text-primary">{formatEuro(finalTotal)}</span>
                {/* text-warning: token de estado reativo ao tema (sem dark:). */}
                <span className="text-xs text-warning">(-{formatEuro(discountAmount)})</span>
              </div>
            ) : (
              <span className="text-lg font-bold text-primary">{formatEuro(total)}</span>
            )}
          </div>

          {/* size xl (h-12) = CTA de toque; o "press" e o disabled vêm da base do Button. */}
          <Button
            type="submit"
            disabled={submitting || !activeTableSession || !canOperate}
            title={canOperate ? undefined : SHIFT_GATE_MESSAGE}
            size="xl"
            className="w-full font-bold"
          >
            {submitting ? d.employee.cart.submitting : d.employee.cart.submit}
          </Button>

          {error && <Alert variant="destructive">{error}</Alert>}
        </div>
      </form>
    )
  }

  return (
    <div className="space-y-6">
      {sessionsFeedError && (
        <Alert variant="destructive" icon={<WifiOff />}>
          {d.employee.connectionLostAlert}
        </Alert>
      )}
      {/* D1: fora de turno vê tudo mas não opera — o picar está na barra acima. */}
      {shiftLoaded && !canOperate && <ShiftGateBanner />}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">{d.employee.title}</h1>

        {activeTableSession && (
          <Badge className="bg-primary/15 text-primary gap-1.5">
            <MapPin className="size-3.5" />
            {d.employee.tableLabel(activeTableSession.tableNumber)}
          </Badge>
        )}

        {cart.length > 0 && activeTableSession && (
          <Badge className="ml-auto hidden sm:inline-flex bg-primary/15 text-primary">
            {d.employee.itemsInCartBadge(count)}
          </Badge>
        )}
      </div>

      {/* Chamadas de mesa ao vivo (chamar empregado / pedir a conta). */}
      <ServiceCallsPanel calls={calls} />

      <div className="grid gap-6 lg:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)] items-start">
        <aside ref={mapRef} className="min-w-0 lg:sticky lg:top-24 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto custom-scrollbar scroll-mt-24">
          <TableMap
            sessions={sessions}
            orders={orders}
            calls={calls}
            selectedSessionId={selectedSessionId}
            highlightedSessionId={highlightedSessionId}
            draftCountsBySessionId={draftCountsBySessionId}
            onOrderForTable={handleOrderForSession}
          />
        </aside>

        <main ref={orderPanelRef} className="min-w-0 scroll-mt-24">
          {activeTableSession ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 rounded-sm border border-brand/30 bg-brand/10 px-3 py-2 text-sm">
                <h2
                  ref={orderTitleRef}
                  tabIndex={-1}
                  className="inline-flex items-center gap-1.5 font-semibold text-brand outline-none"
                >
                  <MapPin className="size-4" />
                  {d.employee.order.panelTitle(activeTableSession.tableNumber)}
                </h2>
                <span className="text-xs text-muted-foreground">{d.employee.order.panelHint}</span>
                <button
                  type="button"
                  onClick={clearSelectedTable}
                  className="ml-auto rounded-sm px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  {d.employee.order.closeOrder}
                </button>
              </div>

              <MenuBrowser
                categories={categories}
                items={menuItems}
                // Em mobile, adicionar só atualiza o FAB (contagem + preço): o
                // carrinho abre apenas quando o empregado toca no FAB, para não
                // interromper a seleção de vários itens. No desktop o carrinho
                // está sempre na coluna lateral.
                onAdd={addToCart}
                quantities={plainQuantities}
                onRemove={(item) => decrementFromCart(item.id)}
                mode={currentOrderMode}
                loading={menuLoading}
              />
            </div>
          ) : (
            <div className="flex min-h-[22rem] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-12 text-center">
              <div className="mb-4 rounded-full bg-muted p-4 text-muted-foreground">
                <ClipboardList className="size-8 stroke-[1.5]" />
              </div>
              <h2 className="text-base font-semibold text-foreground">
                {selectedTableNumber ? d.employee.order.emptyTitleWithTable(selectedTableNumber) : d.employee.order.emptyTitleNoTable}
              </h2>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                {selectedTableNumber
                  ? d.employee.order.emptyHintWithTable
                  : d.employee.order.emptyHintNoTable}
              </p>
              {error && (
                <Alert variant="destructive" className="mt-4 max-w-md text-left">
                  {error}
                </Alert>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Barra flutuante do carrinho (móvel e desktop). Sticky para nunca passar */}
      {/* por cima do footer. No desktop encolhe e fica em baixo à direita; em */}
      {/* qualquer tamanho, clicar abre a gaveta com o pedido. */}
      {activeTableSession && cart.length > 0 && !isCartOpen && (
        <div className="sticky bottom-[calc(env(safe-area-inset-bottom)_+_1.5rem)] flex justify-center lg:justify-end z-40 pointer-events-none">
          <button
            ref={cartTriggerRef}
            onClick={() => setIsCartOpen(true)}
            className="pointer-events-auto flex items-center justify-between gap-4 bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg rounded-lg px-6 py-4 w-full max-w-sm lg:w-auto lg:min-w-[16rem] transition-colors active:scale-[0.98]"
          >
            <div className="flex items-center gap-3">
              <div className="bg-primary-foreground/15 p-2 rounded-md">
                <ShoppingCart className="size-5" />
              </div>
              <div className="text-left">
                <p className="font-semibold">{d.employee.itemsCount(count)}</p>
                <p className="text-xs text-primary-foreground/80">{d.employee.cart.viewForTable(activeTableSession.tableNumber)}</p>
              </div>
            </div>
            <span className="font-bold">{formatEuro(finalTotal)}</span>
          </button>
        </div>
      )}

      {/* Gaveta do carrinho (slide-over) — a mesma no móvel e no desktop. */}
      {activeTableSession && isCartOpen && createPortal(
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop. Em fecho, acompanha o painel com um fade-out. */}
          <div
            className={`absolute inset-0 bg-black/60 backdrop-blur-sm ${cartClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
            onClick={() => requestCartClose()}
          />

          {/* Panel. O slide-down de fecho termina no onAnimationEnd, que é
              quem desmonta a gaveta de facto. */}
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="employee-cart-title"
            tabIndex={-1}
            ref={cartDialogRef}
            className={`relative w-full max-w-md h-full bg-card border-l border-border shadow-xl flex flex-col pr-safe ${cartClosing ? 'animate-slide-down' : 'animate-slide-up'}`}
            onClick={(e) => e.stopPropagation()}
            onAnimationEnd={handleCartPanelAnimationEnd}
          >
            {/* pt com a safe-area: este slide-over é h-full, por isso o
                cabeçalho (com o X de fechar) ficaria sob o notch no iPhone e
                seria impossível fechar o pedido. */}
            <div className="flex items-center justify-between gap-3 px-6 pt-[calc(env(safe-area-inset-top)+1rem)] pb-4 border-b border-border">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="font-semibold text-foreground flex items-center gap-2">
                  <ShoppingCart className="size-4 text-brand" />
                  <span id="employee-cart-title">{d.employee.cart.title(count)}</span>
                </span>
                <span className="rounded-full bg-brand/15 px-2 py-0.5 text-xs text-brand">
                  {d.employee.tableLabel(activeTableSession.tableNumber)}
                </span>
              </div>
              {/* X normalizado: alvo de toque com padding e focus ring padrão
                  (o teclado tem de conseguir fechar a gaveta de forma visível). */}
              <button
                type="button"
                onClick={() => requestCartClose()}
                aria-label={d.employee.cart.closeAria}
                className="shrink-0 rounded-sm p-1 -m-1 text-muted-foreground hover:text-foreground transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-6 space-y-4 custom-scrollbar">
              {cartEntries.map(({ item: c, key, leaving }) => (
                // Saída animada da linha: o wrapper colapsa a altura
                // (grid-rows 1fr→0fr) enquanto a linha faz animate-sink.
                <div
                  key={key}
                  className={`grid transition-[grid-template-rows] duration-200 ease-[var(--ease-out-strong)] ${leaving ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'}`}
                >
                  <div className={`overflow-hidden ${leaving ? 'animate-sink' : ''}`}>
                    <CartRow
                      item={c}
                      onQty={updateQty}
                      onNotes={updateNotes}
                      onToggleIngredient={toggleIngredient}
                      onRemove={(uid) => {
                        const nextCart = cart.filter((ci) => ci.uid !== uid)
                        setCart(nextCart)
                        // Fecho animado: a gaveta desce enquanto a última linha sai.
                        if (nextCart.length === 0) requestCartClose()
                      }}
                      onItemDiscount={updateItemDiscount}
                      notesPlaceholder={d.employee.cart.notesPlaceholder}
                      mode={currentOrderMode}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* pb com a safe-area: afasta o botão de enviar do home indicator. */}
            <div className="px-6 pt-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] border-t border-border bg-muted/30">
              {renderCartForm('employee-cart-mobile')}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
