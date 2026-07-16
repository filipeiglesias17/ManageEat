import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useParams } from 'react-router'
import { ShoppingCart, Lock, Bell, Receipt, X, KeyRound, Hourglass, Check, WifiOff } from 'lucide-react'
import { ensureAnonymousSession } from '../lib/supabase'
import { claimSessionWithCode, createOrder, getSessionById, createServiceCall, subscribeOrdersBySession, subscribeSession } from '../lib/db'
import type { QrSession } from '../lib/db'
import type { ServiceCallType } from '../@types/service-call'
import type { Order } from '../@types/order'
import type { SessionMode } from '../@types/settings'
import { buildOrderItems, useCart, validateCartAgainstMenu } from '../hooks/use-cart'
import { useAnimatedList } from '../hooks/use-animated-list'
import { useMenuData } from '../hooks/use-menu-data'
import { useFlashMessage } from '../hooks/use-flash-message'
import { accountTotals as calculateAccountTotals } from '../lib/account'
import { randomHexId, randomUUID, hashAccessCode, formatEuro, isNetworkError } from '../lib/helpers'
import { hapticSuccess } from '../lib/haptics'
import { useDict, dict } from '../lib/i18n'
import { MenuBrowser } from '../components/menu-browser'
import { CartRow } from '../components/cart-row'
import { Modal } from '../components/modal'
import { LanguageToggle } from '../components/language-toggle'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

const ACCESS_CODE_LENGTH = 6
const ACCESS_CODE_PLACEHOLDER = '•'.repeat(ACCESS_CODE_LENGTH)

// Botão de idioma fixo no canto, igual em TODOS os ecrãs desta página (mesmo
// antes de desbloquear a sessão) — é a primeira coisa que um cliente vê ao
// abrir o QR, por isso não pode ficar escondido atrás do código de acesso.
// `fixed` (não `absolute`): mesma técnica do botão flutuante do carrinho mais
// abaixo, não exige tocar no layout de cada ecrã.
function LanguageCorner() {
  return (
    <div className="fixed top-[calc(env(safe-area-inset-top)+0.75rem)] right-3 z-40">
      <LanguageToggle />
    </div>
  )
}

// Código de acesso lembrado neste dispositivo (em claro, só no localStorage do
// telemóvel do cliente). No Supabase vive apenas o hash. Continua válido
// enquanto a RPC claim_session_with_code o aceitar — quando o empregado fecha,
// as associações antigas à sessão deixam de autorizar a conta.
function deviceCodeKey(sessionId: string): string {
  return `manageEat_sessionCode_${sessionId}`
}

function localSubmittedOrdersKey(sessionId: string, openedAt?: string): string {
  return `manageEat_submittedOrders_${sessionId}_${openedAt ?? 'idle'}`
}

function loadLocalSubmittedOrders(sessionId: string, openedAt?: string): Order[] {
  try {
    const saved = sessionStorage.getItem(localSubmittedOrdersKey(sessionId, openedAt))
    if (!saved) return []

    const parsed = JSON.parse(saved)
    return Array.isArray(parsed) ? parsed as Order[] : []
  } catch {
    return []
  }
}

function saveLocalSubmittedOrders(sessionId: string, openedAt: string | undefined, orders: Order[]) {
  const key = localSubmittedOrdersKey(sessionId, openedAt)
  if (orders.length === 0) {
    sessionStorage.removeItem(key)
    return
  }

  sessionStorage.setItem(key, JSON.stringify(orders))
}

type SessionSnapshot = {
  tableNumber: number
  mode: SessionMode
  entryPrice: number
  headcount: number
}

function snapshotFromSession(session: QrSession): SessionSnapshot {
  return {
    tableNumber: session.tableNumber,
    mode: session.mode === 'rodizio' ? 'rodizio' : 'normal',
    entryPrice: session.entryPrice ?? 0,
    headcount: session.headcount ?? 0,
  }
}

function uniqueOrdersById(remoteOrders: Order[], localOrders: Order[]): Order[] {
  return [...new Map(
    [...remoteOrders, ...localOrders].map((order) => [order.id, order]),
  ).values()]
}

function codeErrorMessage(error: unknown): string {
  // Fora de um componente React: usa `dict()` (não reativo), não `useDict()`.
  const d = dict()
  // A RPC do Supabase devolve sempre a mensagem em português (independente do
  // idioma da interface) — a comparação abaixo tem de ficar em português.
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('bloqueado') || message.includes('tentativas')) {
    return d.customer.accessCode.errors.tooManyAttempts
  }
  if (message.includes('incorreto')) return d.customer.accessCode.errors.incorrect
  return d.customer.accessCode.errors.generic
}

export function CustomerSession() {
  const d = useDict()
  const { sessionId } = useParams<{ sessionId: string }>()
  // A sessão vem em tempo real (subscribeSession): a página reage quando o
  // empregado a inicia/fecha ou quando o código de acesso muda.
  const [session, setSession] = useState<QrSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessionNotFound, setSessionNotFound] = useState(false)
  // Falha a LER a sessão (rede/servidor), distinta de "sessão expirada". Um blip
  // de rede não deve mandar o cliente para o ecrã fatal — o polling recupera.
  const [connectionError, setConnectionError] = useState(false)
  // Força uma nova tentativa imediata de ligação (senão só a cada 10s do poll).
  const [retryNonce, setRetryNonce] = useState(0)
  // O feed de pedidos (Realtime) falhou a atualizar: mostramos os últimos
  // conhecidos com um aviso, em vez de os deixar desatualizar em silêncio.
  const [ordersStale, setOrdersStale] = useState(false)
  // Código que desbloqueou este dispositivo (lembrado no localStorage).
  const [deviceCode, setDeviceCode] = useState<string>(() =>
    sessionId ? localStorage.getItem(deviceCodeKey(sessionId)) ?? '' : '')
  const [codeInput, setCodeInput] = useState('')
  const [codeError, setCodeError] = useState('')
  const [savingCode, setSavingCode] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const [lastKnownTableNumber, setLastKnownTableNumber] = useState<number | null>(null)

  // Snapshot derivado da sessão viva (deixou de ser estado próprio).
  const sessionMode: SessionMode = session?.mode === 'rodizio' ? 'rodizio' : 'normal'
  const entryPrice = session?.entryPrice ?? 0
  const headcount = session?.headcount ?? 0
  const tableNumber = session?.tableNumber ?? null
  const openedAt = session?.openedAt

  // Estados do ciclo de vida usados para escolher o ecrã a mostrar.
  const isOpen = session?.open === true
  const hasCode = Boolean(session?.hasAccessCode ?? session?.accessCodeHash)
  const codeLockedUntil = session?.codeLockedUntil ? new Date(session.codeLockedUntil) : null
  const codeIsLocked = Boolean(codeLockedUntil && codeLockedUntil > new Date())

  const cartAccountKey = sessionId && openedAt ? `${sessionId}_${openedAt}` : sessionId
  const { cart, setCart, total, count, plainQuantities, addToCart, decrementFromCart, updateQty, updateNotes, toggleIngredient } = useCart(sessionMode, cartAccountKey)
  // Linhas do carrinho com saída animada: uma linha removida fica ~220ms
  // marcada como `leaving` para colapsar com animate-sink em vez de sumir seca.
  const cartEntries = useAnimatedList(cart, (c) => c.uid)
  const { categories, menuItems, loading: menuLoading } = useMenuData()
  const [sessionOrders, setSessionOrders] = useState<Order[]>([])
  const [localSubmittedOrders, setLocalSubmittedOrders] = useState<Order[]>([])

  const [callError, setCallError] = useState('')
  const [error, setError] = useState('')
  const [success, flashSuccess] = useFlashMessage()
  const [submitting, setSubmitting] = useState(false)
  const [sendingCall, setSendingCall] = useState(false)

  // O carrinho agora é um modal controlado pelo History Stack (URL Hash)
  // Isto resolve a "Armadilha do Botão Voltar" em Mobile.
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [showSuccessModal, setShowSuccessModal] = useState(false)

  useEffect(() => {
    function handleHash() {
      setIsCartOpen(window.location.hash === '#cart')
    }
    window.addEventListener('hashchange', handleHash)
    handleHash() // Verifica logo no mount
    return () => window.removeEventListener('hashchange', handleHash)
  }, [])

  function openCart() {
    window.location.hash = 'cart'
  }

  function closeCart() {
    if (window.location.hash === '#cart') {
      window.history.back()
    } else {
      setIsCartOpen(false)
    }
  }

  // Período de graça antes de aceitar "sessão não encontrada" como definitivo:
  // um blip transitório do polling (ex.: RPC devolve 0 linhas por um instante,
  // antes do token anónimo assentar) não deve esconder logo o menu/carrinho
  // atrás do ecrã fatal "Sessão expirada". Só quando `live === null` chega DUAS
  // vezes seguidas é que confiamos que é mesmo isso, e não um soluço de rede.
  // Mesma ideia do período de graça do useConnectionAlert.
  const missingSessionStreak = useRef(0)

  useEffect(() => {
    if (!sessionId) {
      setSessionNotFound(true)
      setLoading(false)
      return
    }

    const currentSessionId = sessionId
    let cancelled = false
    missingSessionStreak.current = 0
    setSessionOrders([])
    setLocalSubmittedOrders([])

    // Login anónimo: necessário para criar pedidos e para gravar o código de
    // acesso. A leitura da sessão é pública, mas as escritas exigem signedIn.
    // Em background — não bloqueia a leitura da sessão.
    ensureAnonymousSession().catch(() => { /* leitura ainda funciona */ })

    const unsubscribe = subscribeSession(
      currentSessionId,
      (live) => {
        if (cancelled) return
        setLoading(false)
        // Chegou resposta do servidor → há ligação. Limpa o estado de erro de rede.
        setConnectionError(false)
        if (!live) {
          missingSessionStreak.current += 1
          // Ainda pode ser um blip transitório — só marcamos "não encontrada"
          // ao confirmar em dois polls seguidos (o próximo é ≤10s depois).
          if (missingSessionStreak.current < 2) return
          setSession(null)
          setSessionNotFound(true)
          localStorage.removeItem('manageEat_activeSession')
          return
        }
        missingSessionStreak.current = 0
        setSessionNotFound(false)
        setSession(live)
        if (live.tableNumber !== undefined && live.tableNumber !== null) {
          setLastKnownTableNumber(live.tableNumber)
        }
        localStorage.setItem('manageEat_activeSession', currentSessionId)
      },
      () => {
        if (cancelled) return
        setLoading(false)
        // NÃO marcamos "sessão não encontrada": falhar a leitura é problema de
        // rede/servidor, não sessão expirada (essa vem como live === null acima).
        // O próximo poll (≤10s) recupera sozinho e limpa este estado.
        setConnectionError(true)
      },
    )

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [sessionId, retryNonce])

  useEffect(() => {
    if (!sessionId || tableNumber === null) {
      setSessionOrders([])
      return
    }

    if (!unlocked) {
      setSessionOrders([])
      return
    }

    // Pedidos otimistas guardados localmente (sobrevivem a refresh até o
    // Supabase confirmar). Carregados aqui, já com a mesa conhecida.
    setLocalSubmittedOrders(loadLocalSubmittedOrders(sessionId, openedAt))

    return subscribeOrdersBySession(
      sessionId,
      (orders) => {
        setOrdersStale(false)
        const remoteOrderIds = new Set(orders.map((order) => order.id))
        setSessionOrders(orders)
        setLocalSubmittedOrders((current) => {
          const next = current.filter((order) => !remoteOrderIds.has(order.id))
          saveLocalSubmittedOrders(sessionId, openedAt, next)
          return next
        })
      },
      // Falhou atualizar os pedidos: marca como desatualizado (recupera no
      // próximo evento Realtime). Mantém os últimos pedidos visíveis.
      () => setOrdersStale(true),
      openedAt,
    )
  }, [sessionId, tableNumber, unlocked, openedAt])

  useEffect(() => {
    if (!sessionId || !isOpen || !hasCode || deviceCode === '') {
      if (sessionId && isOpen && !hasCode && deviceCode !== '') {
        localStorage.removeItem(deviceCodeKey(sessionId))
        setDeviceCode('')
      }
      setUnlocked(false)
      return
    }

    let cancelled = false
    const currentSessionId = sessionId

    async function verifySavedCode() {
      try {
        await ensureAnonymousSession()
        await claimSessionWithCode(currentSessionId, hashAccessCode(deviceCode))
        if (!cancelled) setUnlocked(true)
      } catch {
        if (cancelled) return
        localStorage.removeItem(deviceCodeKey(currentSessionId))
        setDeviceCode('')
        setUnlocked(false)
      }
    }

    verifySavedCode()

    return () => {
      cancelled = true
    }
  }, [sessionId, isOpen, hasCode, deviceCode])

  async function handleServiceCall(type: ServiceCallType) {
    const tableNum = tableNumber ?? lastKnownTableNumber
    if (!sessionId || tableNum === null || sendingCall) return
    setCallError('')
    setSendingCall(true)
    try {
      await ensureAnonymousSession()
      await createServiceCall({
        id: randomHexId(8),
        tableNumber: tableNum,
        type,
        sessionId,
      })
      flashSuccess(type === 'waiter' ? d.customer.waiterCalledSuccess : d.customer.billRequestedSuccess)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setCallError(d.customer.serviceCallError(msg))
    } finally {
      setSendingCall(false)
    }
  }

  // Seis dígitos ainda são usáveis à mesa, mas reduzem a superfície de brute
  // force sem complicar a experiência do cliente.
  function isValidCode(code: string): boolean {
    return new RegExp(`^\\d{${ACCESS_CODE_LENGTH}}$`).test(code)
  }

  // Cliente cria o código (1ª vez). Grava só o hash no Supabase e guarda o
  // código em claro neste dispositivo para voltar a provar a sessão.
  async function handleCreateCode(e: FormEvent) {
    e.preventDefault()
    setCodeError('')
    if (!sessionId) return
    if (!isValidCode(codeInput)) { setCodeError(d.customer.accessCode.invalidLength(ACCESS_CODE_LENGTH)); return }

    setSavingCode(true)
    try {
      await ensureAnonymousSession()
      await claimSessionWithCode(sessionId, hashAccessCode(codeInput))
      // Atualização otimista: a sessão local ainda diz "sem código" até o
      // Realtime chegar, e nessa janela o efeito de verificação interpretava
      // deviceCode+semCódigo como "o staff fez reset" e APAGAVA o código
      // acabado de criar — o cliente caía no ecrã "Introduz o código".
      setSession((current) => (current ? { ...current, hasAccessCode: true } : current))
      localStorage.setItem(deviceCodeKey(sessionId), codeInput)
      setDeviceCode(codeInput)
      setUnlocked(true)
      setCodeInput('')
    } catch (err) {
      // Tipicamente outro dispositivo definiu o código primeiro (a regra só
      // deixa criar uma vez). O cliente passa a ter de introduzir esse código.
      setCodeError(codeErrorMessage(err))
    } finally {
      setSavingCode(false)
    }
  }

  // Outro dispositivo (ou o mesmo após limpar dados) introduz o código já criado.
  async function handleEnterCode(e: FormEvent) {
    e.preventDefault()
    setCodeError('')
    if (!sessionId || !hasCode || codeIsLocked) return
    if (!isValidCode(codeInput)) { setCodeError(d.customer.accessCode.invalidLength(ACCESS_CODE_LENGTH)); return }

    setSavingCode(true)
    try {
      await ensureAnonymousSession()
      await claimSessionWithCode(sessionId, hashAccessCode(codeInput))
      localStorage.setItem(deviceCodeKey(sessionId), codeInput)
      setDeviceCode(codeInput)
      setUnlocked(true)
      setCodeInput('')
    } catch (err) {
      setCodeError(codeErrorMessage(err))
    } finally {
      setSavingCode(false)
    }
  }

  async function handlePlaceOrder(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (cart.length === 0) { setError(d.customer.errors.cartEmpty); return }
    if (!sessionId) { setError(d.customer.errors.invalidSession); return }
    if (tableNumber === null) { setError(d.customer.errors.invalidSession); return }
    if (!unlocked) { setError(d.customer.errors.codeRequiredBeforeOrder); return }
    // Falhar já aqui, sem tentar sequer o fetch: em Wi-Fi fraco o pedido ficava
    // "A enviar..." até o timeout do Supabase e só depois avisava — o cliente
    // ficava às escuras esse tempo todo, a pensar que o carrinho tinha um erro.
    if (!navigator.onLine) {
      setError(d.customer.errors.offline)
      return
    }

    setSubmitting(true)
    try {
      const fresh = await getSessionById(sessionId)
      if (!fresh) {
        setSessionNotFound(true)
        localStorage.removeItem('manageEat_activeSession')
        return
      }
      // Revalidar antes de submeter porque o empregado pode ter encerrado a
      // sessão entretanto. Se já não estiver aberta, não deixamos pedir. O
      // pedido usa este snapshot acabado de ler.
      if (fresh.open !== true) {
        setError(d.customer.errors.sessionClosed)
        return
      }
      const snapshot = snapshotFromSession(fresh)

      const validation = validateCartAgainstMenu(cart, menuItems, snapshot.mode)
      if (!validation.ok) {
        setCart(validation.cart)
        setError(d.customer.errors.fixCartMessage(validation.message))
        return
      }

      const createdOrder = await createOrder({
        requestId: randomUUID(),
        tableNumber: snapshot.tableNumber,
        source: 'cliente',
        sessionId,
        items: buildOrderItems(validation.cart, snapshot.mode),
        status: 'pending',
        createdAt: new Date().toISOString(),
        ...(snapshot.mode === 'rodizio' && {
          entryPrice: snapshot.entryPrice,
          headcount: snapshot.headcount,
          mode: 'rodizio',
        }),
      })

      setLocalSubmittedOrders((current) => {
        const next = [createdOrder, ...current.filter((order) => order.id !== createdOrder.id)]
        saveLocalSubmittedOrders(sessionId, openedAt, next)
        return next
      })
      setCart([])
      closeCart()
      setShowSuccessModal(true)
      // Vibração curta de "concluído" a acompanhar o modal de sucesso (no-op na web).
      void hapticSuccess()
    } catch (err) {
      // Erro de rede não é culpa do carrinho — o carrinho pode estar perfeito,
      // só a ligação ao servidor falhou. Só pedimos para "corrigir o carrinho"
      // quando o erro vem mesmo da validação da BD.
      if (isNetworkError(err)) {
        setError(d.customer.errors.networkSendFailed)
      } else {
        const msg = err instanceof Error ? err.message : String(err)
        setError(d.customer.errors.sendFailedGeneric(msg))
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="py-24 flex items-center justify-center">
        <LanguageCorner />
        <span className="text-sm text-muted-foreground animate-pulse" role="status">{d.customer.loadingSession}</span>
      </div>
    )
  }

  // Sem ligação ao servidor E sem sessão em mãos: ecrã recuperável (não fatal).
  // Se já tínhamos uma sessão, mantemo-la visível e deixamos o poll reconectar
  // em silêncio — não interrompemos quem está a meio de um pedido.
  if (connectionError && !session) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center px-4">
        <LanguageCorner />
        <WifiOff className="size-12 text-muted-foreground" aria-hidden="true" />
        <p className="text-xl font-bold text-foreground">{d.customer.connectionLost.title}</p>
        <p className="text-sm text-muted-foreground max-w-xs">
          {d.customer.connectionLost.description}
        </p>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          onClick={() => {
            setLoading(true)
            setConnectionError(false)
            setRetryNonce((n) => n + 1)
          }}
          className="mt-2"
        >
          {d.common.retry}
        </Button>
      </div>
    )
  }

  if (sessionNotFound) {
    const tableNum = tableNumber ?? lastKnownTableNumber
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center px-4">
        <LanguageCorner />
        <Lock className="size-12 text-muted-foreground" aria-hidden="true" />
        <p className="text-xl font-bold text-foreground">{d.customer.sessionExpired.title}</p>
        <p className="text-sm text-muted-foreground">{d.customer.sessionExpired.description}</p>

        {tableNum !== null && (
          <div className="w-full max-w-sm mt-4 space-y-4">
            <Button
              type="button"
              variant="secondary"
              size="lg"
              onClick={() => handleServiceCall('waiter')}
              disabled={sendingCall}
              className="w-full"
            >
              <Bell className="size-4 text-muted-foreground" />
              {sendingCall ? d.customer.callingWaiterButton : d.customer.callWaiterButton}
            </Button>
            {success && <Alert variant="success">{success}</Alert>}
            {callError && <Alert variant="destructive">{callError}</Alert>}
          </div>
        )}
      </div>
    )
  }

  // Sessão existe mas o empregado ainda não a iniciou (QR permanente em espera).
  // Sem botão de "chamar empregado" aqui de propósito: a BD só aceita chamadas
  // com a sessão ABERTA (o trigger service_calls_validate_insert exige-o), por
  // isso chamar antes da abertura falhava com um erro. A mensagem já diz que o
  // empregado vem abrir a mesa e a página atualiza-se sozinha quando isso
  // acontece — aí aparecem os botões de chamada, que funcionam.
  if (!isOpen) {
    const tableNum = tableNumber ?? lastKnownTableNumber
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center px-4">
        <LanguageCorner />
        <Hourglass className="size-12 text-muted-foreground animate-pulse" aria-hidden="true" />
        <p className="text-xl font-bold text-foreground">{d.customer.waiting.title}</p>
        <p className="text-sm text-muted-foreground max-w-xs">
          {tableNum !== null ? d.customer.waiting.tablePrefix(tableNum) : ''}{d.customer.waiting.description}
        </p>
      </div>
    )
  }

  // Sessão aberta mas ainda sem código: o cliente cria o seu código de acesso.
  if (!hasCode) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4">
        <LanguageCorner />
        <form onSubmit={handleCreateCode} className="w-full max-w-sm bg-card border border-border rounded-lg p-6 space-y-4 shadow-sm">
          <div className="flex flex-col items-center text-center gap-2">
            <div className="size-12 rounded-full bg-brand/10 border border-brand/30 flex items-center justify-center text-brand">
              <KeyRound className="size-6" />
            </div>
            <h2 className="text-lg font-bold text-foreground">{d.customer.accessCode.create.title(ACCESS_CODE_LENGTH)}</h2>
            <p className="text-sm text-muted-foreground">
              {d.customer.accessCode.create.descriptionPrefix}
              {tableNumber !== null ? d.customer.accessCode.tableSuffix(tableNumber) : ''}
              {d.customer.accessCode.create.descriptionSuffix}
            </p>
          </div>
          <input
            value={codeInput}
            onChange={(e) => { setCodeInput(e.target.value.replace(/\D/g, '').slice(0, ACCESS_CODE_LENGTH)); setCodeError('') }}
            inputMode="numeric"
            autoComplete="off"
            maxLength={ACCESS_CODE_LENGTH}
            placeholder={ACCESS_CODE_PLACEHOLDER}
            aria-label={d.customer.accessCode.create.ariaLabel(ACCESS_CODE_LENGTH)}
            className="w-full text-center text-3xl tracking-[0.35em] font-mono bg-background border border-input rounded-lg py-3 outline-none focus:border-brand focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          {codeError && <Alert variant="destructive">{codeError}</Alert>}
          {callError && <Alert variant="destructive">{callError}</Alert>}
          <Button
            type="submit"
            size="xl"
            disabled={savingCode || !isValidCode(codeInput)}
            className="w-full"
          >
            {savingCode ? d.customer.accessCode.create.submitting : d.customer.accessCode.create.submit}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={() => handleServiceCall('waiter')}
            disabled={sendingCall || tableNumber === null}
            className="w-full"
          >
            {sendingCall ? d.customer.callingWaiterButton : d.customer.callWaiterButton}
          </Button>
        </form>
      </div>
    )
  }

  // Sessão aberta e protegida, mas este dispositivo ainda não desbloqueou.
  if (!unlocked) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4">
        <LanguageCorner />
        <form onSubmit={handleEnterCode} className="w-full max-w-sm bg-card border border-border rounded-lg p-6 space-y-4 shadow-sm">
          <div className="flex flex-col items-center text-center gap-2">
            <div className="size-12 rounded-full bg-muted border border-border flex items-center justify-center text-muted-foreground">
              <Lock className="size-6" />
            </div>
            <h2 className="text-lg font-bold text-foreground">{d.customer.accessCode.enter.title}</h2>
            <p className="text-sm text-muted-foreground">
              {d.customer.accessCode.enter.descriptionPrefix}
              {tableNumber !== null ? d.customer.accessCode.tableSuffix(tableNumber) : ''}
              {d.customer.accessCode.enter.descriptionSuffix(ACCESS_CODE_LENGTH)}
            </p>
          </div>
          <input
            value={codeInput}
            onChange={(e) => { setCodeInput(e.target.value.replace(/\D/g, '').slice(0, ACCESS_CODE_LENGTH)); setCodeError('') }}
            inputMode="numeric"
            autoComplete="off"
            maxLength={ACCESS_CODE_LENGTH}
            placeholder={ACCESS_CODE_PLACEHOLDER}
            aria-label={d.customer.accessCode.enter.ariaLabel(ACCESS_CODE_LENGTH)}
            className="w-full text-center text-3xl tracking-[0.35em] font-mono bg-background border border-input rounded-lg py-3 outline-none focus:border-brand focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          {codeIsLocked && (
            // role="status" (não "alert"): estado de espera já visível no ecrã,
            // não é uma interrupção nova.
            <Alert variant="warning" role="status">
              {d.customer.accessCode.enter.locked}
            </Alert>
          )}
          {codeError && <Alert variant="destructive">{codeError}</Alert>}
          {callError && <Alert variant="destructive">{callError}</Alert>}
          <Button
            type="submit"
            size="xl"
            disabled={savingCode || codeIsLocked || !isValidCode(codeInput)}
            className="w-full"
          >
            {savingCode ? d.customer.accessCode.enter.submitting : d.customer.accessCode.enter.submit}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={() => handleServiceCall('waiter')}
            disabled={sendingCall || tableNumber === null}
            className="w-full"
          >
            {sendingCall ? d.customer.callingWaiterButton : d.customer.callWaiterButton}
          </Button>
        </form>
      </div>
    )
  }

  const submittedOrders = uniqueOrdersById(sessionOrders, localSubmittedOrders)
  const accountTotals = calculateAccountTotals(
    { mode: sessionMode, entryPrice, headcount },
    submittedOrders,
    total,
  )

  return (
    <div className="space-y-8">
      <LanguageCorner />
      <div className="flex items-center gap-4 flex-wrap">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{d.customer.menuTitle}</h1>
        <span className="flex items-center gap-1.5 text-xs font-medium bg-secondary border border-border text-foreground px-3 py-1.5 rounded-full">
          <Lock className="size-3.5 text-brand" />
          {d.customer.tableWord} {tableNumber}
        </span>
      </div>

      {ordersStale && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 border border-border px-3 py-2 rounded-lg" role="status" aria-live="polite">
          <WifiOff className="size-3.5 shrink-0" />
          {d.customer.ordersStaleNotice}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => handleServiceCall('waiter')}
          disabled={sendingCall}
          className="flex items-center gap-2 bg-card border border-border hover:bg-accent disabled:opacity-50 text-foreground px-4 py-2.5 rounded-lg text-sm font-medium transition-colors active:scale-95"
        >
          <Bell className="size-4 text-muted-foreground" />
          {d.customer.callWaiterButton}
        </button>
        <button
          type="button"
          onClick={() => handleServiceCall('bill')}
          disabled={sendingCall}
          className="flex items-center gap-2 bg-card border border-border hover:bg-accent disabled:opacity-50 text-foreground px-4 py-2.5 rounded-lg text-sm font-medium transition-colors active:scale-95"
        >
          <Receipt className="size-4 text-muted-foreground" />
          {d.customer.requestBillButton}
        </button>
      </div>

      {callError && <Alert variant="destructive">{callError}</Alert>}

      {success && <Alert variant="success">{success}</Alert>}

      {sessionMode === 'rodizio' ? (
        <div className="bg-card border border-border rounded-lg px-5 py-4 shadow-sm border-l-4 border-l-brand">
          <p className="text-xs font-bold text-brand uppercase tracking-wider mb-1">{d.customer.rodizio.badge}</p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {d.customer.rodizio.entryLine(formatEuro(entryPrice), headcount)}<span className="font-semibold text-foreground">{formatEuro(accountTotals.entry)}</span>.<br/>
            {d.customer.rodizio.includedNoticePrefix}<span className="text-brand font-semibold">{d.customer.rodizio.includedWord}</span>{d.customer.rodizio.includedNoticeSuffix}
          </p>
          {/* Só mostra gastos depois de haver pedidos enviados — o FAB já informa o carrinho */}
          {submittedOrders.length > 0 && (
            <dl className="mt-4 space-y-2 border-t border-border pt-3" aria-live="polite">
              <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
                <dt>{d.customer.rodizio.extraSpent}</dt>
                <dd className="font-semibold text-foreground tabular-nums">{formatEuro(accountTotals.submittedExtras)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 text-sm mt-1">
                <dt className="font-semibold text-foreground">{d.customer.rodizio.accountTotal}</dt>
                <dd className="text-lg font-bold text-brand tabular-nums">{formatEuro(accountTotals.total)}</dd>
              </div>
            </dl>
          )}
        </div>
      ) : (
        /* Painel "Conta Atual" só aparece com pedidos já enviados */
        submittedOrders.length > 0 && (
          <div className="bg-card border border-border rounded-lg px-5 py-4 shadow-sm border-l-4 border-l-border">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">{d.customer.account.title}</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {d.customer.account.description}
            </p>
            <dl className="mt-4 space-y-2 border-t border-border pt-3" aria-live="polite">
              <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
                <dt>{d.customer.account.alreadyOrdered}</dt>
                <dd className="font-semibold text-foreground tabular-nums">{formatEuro(accountTotals.submittedExtras)}</dd>
              </div>
              {accountTotals.cartExtras > 0 && (
                <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
                  <dt>{d.customer.account.inCart}</dt>
                  <dd className="font-semibold text-foreground tabular-nums">{formatEuro(accountTotals.cartExtras)}</dd>
                </div>
              )}
              <div className="flex items-center justify-between gap-4 text-sm mt-1 border-t border-border pt-2">
                <dt className="font-semibold text-foreground">{d.customer.account.estimatedTotal}</dt>
                <dd className="text-lg font-bold text-brand tabular-nums">{formatEuro(accountTotals.total)}</dd>
              </div>
            </dl>
          </div>
        )
      )}

      <MenuBrowser categories={categories} items={menuItems} onAdd={addToCart} quantities={plainQuantities} onRemove={(item) => decrementFromCart(item.id)} mode={sessionMode} loading={menuLoading} variant="cliente" />

      {/* Barra do carrinho (FAB). É sticky (não fixed): flutua junto ao fundo
          enquanto se faz scroll do menu, mas encosta logo acima do footer ao
          chegar ao fim da página — nunca o tapa nem desce abaixo dele. */}
      {cart.length > 0 && !isCartOpen && (
        <div className="sticky bottom-[calc(env(safe-area-inset-bottom)_+_1.5rem)] flex justify-center z-40 pointer-events-none">
          <button
            onClick={openCart}
            aria-label={d.customer.cart.openAria}
            className="pointer-events-auto flex items-center justify-between bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg rounded-lg px-6 py-4 w-full max-w-sm transition-colors active:scale-[0.98]"
          >
            <div className="flex items-center gap-3">
              <div className="bg-primary-foreground/15 p-2 rounded-md">
                <ShoppingCart className="size-5" />
              </div>
              <div className="text-left">
                <p className="font-semibold">{d.customer.cart.itemsCount(count)}</p>
                <p className="text-xs text-primary-foreground/80">{d.customer.cart.viewOrder}</p>
              </div>
            </div>
            <span className="font-bold text-lg">{formatEuro(total)}</span>
          </button>
        </div>
      )}

      {/* Modal do Carrinho */}
      {isCartOpen && (
        <Modal onClose={closeCart} maxWidth="max-w-2xl" aria-labelledby="cart-title">
          <div className="flex items-center justify-between mb-6">
            <h2 id="cart-title" className="text-xl font-bold text-foreground flex items-center gap-2">
              <ShoppingCart className="size-5 text-brand" />
              {d.customer.cart.modalTitle}
            </h2>
            <button
              onClick={closeCart}
              aria-label={d.customer.cart.closeAria}
              className="p-3 hover:bg-accent rounded-full transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <X className="size-5 text-muted-foreground" />
            </button>
          </div>

          <div className="space-y-4 mb-8 max-h-[50dvh] overflow-y-auto pr-2 custom-scrollbar">
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
                    onRemove={(uid) => setCart((prev) => prev.filter((ci) => ci.uid !== uid))}
                    mode={sessionMode}
                  />
                </div>
              </div>
            ))}
            {/* cartEntries (não cart): a mensagem de vazio só aparece depois de
                a última linha acabar a animação de saída. */}
            {cartEntries.length === 0 && (
              <p className="text-center text-muted-foreground py-8">{d.customer.cart.empty}</p>
            )}
          </div>

          <form onSubmit={handlePlaceOrder} className="flex flex-col gap-6 pt-6 border-t border-border">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{d.customer.tableWord}</span>
              <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground bg-secondary border border-border px-3 py-1.5 rounded-lg">
                <Lock className="size-3.5 text-brand" />
                {tableNumber}
              </span>
            </div>

            {sessionMode === 'rodizio' ? (
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center text-sm text-muted-foreground">
                  <span>{d.customer.rodizio.subtotalEntry}</span>
                  <span>{formatEuro(accountTotals.entry)}</span>
                </div>
                <div className="flex justify-between items-center text-sm text-muted-foreground">
                  <span>{d.customer.rodizio.extraSpent}</span>
                  <span>{formatEuro(accountTotals.extras)}</span>
                </div>
                <div className="flex justify-between items-center mt-2 pt-2 border-t border-border">
                  <span className="font-medium text-foreground">{d.customer.rodizio.accountTotal}</span>
                  <span className="text-2xl font-bold text-brand">{formatEuro(accountTotals.total)}</span>
                </div>
              </div>
            ) : (
              <div className="flex justify-between items-center">
                <span className="font-medium text-foreground">{d.customer.cart.total}</span>
                <span className="text-2xl font-bold text-brand">{formatEuro(total)}</span>
              </div>
            )}

            <Button
              type="submit"
              size="xl"
              disabled={submitting || cart.length === 0}
              className="w-full mt-2"
            >
              {submitting ? d.customer.cart.submitting : d.customer.cart.submitButton}
            </Button>
          </form>

          {error && <Alert variant="destructive" className="mt-4">{error}</Alert>}
        </Modal>
      )}

      {/* Modal de Sucesso Imersivo */}
      {showSuccessModal && (
        <Modal onClose={() => setShowSuccessModal(false)} maxWidth="max-w-sm" aria-labelledby="success-title">
          <div className="flex flex-col items-center text-center py-6">
            {/* Token de estado (success) já reage ao tema — nunca usar dark: aqui. */}
            <div className="w-16 h-16 bg-success/10 border border-success/30 rounded-full flex items-center justify-center mb-4 text-success">
              <Check className="size-8" strokeWidth={3} aria-hidden="true" />
            </div>

            <h3 id="success-title" className="text-xl font-bold text-foreground mb-2">{d.customer.successModal.title}</h3>

            <p className="text-sm text-muted-foreground mb-6 px-2">
              {d.customer.successModal.messagePrefix}
              <strong className="text-foreground">{d.customer.tableWord} {tableNumber}</strong>
              {d.customer.successModal.messageSuffix}
            </p>

            <Button
              type="button"
              variant="secondary"
              size="xl"
              onClick={() => setShowSuccessModal(false)}
              className="w-full"
            >
              {d.customer.successModal.backButton}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
