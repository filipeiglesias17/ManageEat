import { useState, type FormEvent } from 'react'
import { ShoppingCart, Lock } from 'lucide-react'
import { createOrder } from '../lib/db'
import { buildOrderItems, useCart, validateCartAgainstMenu } from '../hooks/use-cart'
import { useMenuData } from '../hooks/use-menu-data'
import { useOpenSession } from '../hooks/use-open-session'
import { useToast } from '../hooks/use-toast'
import { useAuth } from '../lib/auth-context'
import { randomUUID, formatEuro } from '../lib/helpers'
import { useDict } from '../lib/i18n'
import { MenuBrowser } from '../components/menu-browser'
import { CartRow } from '../components/cart-row'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { SessionMode } from '../@types/settings'

export function CustomerDashboard() {
  const d = useDict()
  // A mesa desta conta é fixa (tablet do restaurante) e vem do profile — o
  // cliente não a escolhe. A BD exige uma sessão aberta para essa mesa.
  const { profile } = useAuth()
  // Polling da sessão aberta da mesa fixa vive no hook (o empregado pode abrir a
  // mesa a qualquer momento). O hook trata do interval, cancelamento e erro.
  const { session, loading: sessionLoading, error: sessionError } = useOpenSession(profile?.tableNumber)

  const customerMode: SessionMode = session?.mode === 'rodizio' ? 'rodizio' : 'normal'
  const cartKey = session?.openedAt ? `${session.id}_${session.openedAt}` : session?.id
  const { cart, setCart, total, count, plainQuantities, addToCart, decrementFromCart, updateQty, updateNotes, toggleIngredient } = useCart(customerMode, cartKey)
  const { categories, menuItems, available, loading: menuLoading } = useMenuData()
  const [error, setError] = useState('')
  // Toast global em vez de flash local: o setCart([]) desmonta a section do
  // carrinho e escondia o feedback antes de o cliente o ver.
  const toast = useToast()
  const [submitting, setSubmitting] = useState(false)

  async function handlePlaceOrder(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (cart.length === 0) { setError(d.customer.errors.cartEmpty); return }
    if (!session) { setError(d.customer.dashboard.tableNotOpenForOrder); return }
    if (customerMode === 'rodizio' && (!session.entryPrice || !session.headcount)) {
      setError(d.customer.dashboard.rodizioMissingConfig)
      return
    }

    setSubmitting(true)
    try {
      const validation = validateCartAgainstMenu(cart, menuItems, customerMode)
      if (!validation.ok) {
        setCart(validation.cart)
        setError(d.customer.errors.fixCartMessage(validation.message))
        return
      }

      await createOrder({
        requestId: randomUUID(),
        tableNumber: session.tableNumber,
        source: 'cliente',
        sessionId: session.id,
        items: buildOrderItems(validation.cart, customerMode),
        status: 'pending',
        createdAt: new Date().toISOString(),
        ...(customerMode === 'rodizio' && {
          entryPrice: session.entryPrice ?? 0,
          headcount: session.headcount ?? 0,
          mode: 'rodizio',
        }),
      })

      setCart([])
      toast.success(d.customer.dashboard.orderSentSuccess)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(d.customer.errors.sendFailedGeneric(msg))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold">{d.customer.dashboard.title}</h1>
        {cart.length > 0 && (
          <Badge className="bg-primary/15 text-primary">
            {d.customer.dashboard.cartBadge(count)}
          </Badge>
        )}
      </div>

      {profile?.tableNumber == null ? (
        // role="status" (não "alert"): é um estado de espera, não uma interrupção.
        <Alert variant="warning" role="status">
          {d.customer.dashboard.noTableAssigned}
        </Alert>
      ) : sessionLoading ? (
        <p className="text-sm text-muted-foreground" role="status">{d.customer.dashboard.searchingSession}</p>
      ) : sessionError ? (
        <Alert variant="destructive">
          {d.customer.dashboard.sessionSearchError(sessionError)}
        </Alert>
      ) : !session ? (
        <Alert variant="warning" role="status">
          {d.customer.dashboard.tableNotOpen(profile.tableNumber)}
        </Alert>
      ) : (
        <MenuBrowser categories={categories} items={available} onAdd={addToCart} quantities={plainQuantities} onRemove={(item) => decrementFromCart(item.id)} mode={customerMode} loading={menuLoading} variant="cliente" />
      )}

      {cart.length > 0 && (
        <section className="border-t border-border pt-6">
          <h2 className="font-semibold text-foreground mb-4 flex items-center gap-2">
            <ShoppingCart className="size-4" />
            {d.customer.dashboard.cartSectionTitle}
          </h2>

          <div className="space-y-2 mb-6">
            {cart.map((c) => (
              <CartRow
                key={c.uid}
                item={c}
                onQty={updateQty}
                onNotes={updateNotes}
                onToggleIngredient={toggleIngredient}
                onRemove={(uid) => setCart((prev) => prev.filter((ci) => ci.uid !== uid))}
                mode={customerMode}
              />
            ))}
          </div>

          <form onSubmit={handlePlaceOrder} className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-sm text-muted-foreground">{d.customer.tableWord}</span>
              {/* Mesa fixa da conta (tablet). Bloqueada — vem do profile, não se edita. */}
              <div className="flex items-center gap-2 border border-input rounded-md px-3 py-2 bg-muted text-muted-foreground h-10">
                <Lock className="size-4" />
                <span className="font-medium text-foreground">{session?.tableNumber ?? profile?.tableNumber ?? '—'}</span>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-sm text-muted-foreground">{d.customer.cart.total}</span>
              <span className="text-lg font-bold text-primary">{formatEuro(total)}</span>
            </div>
            <Button
              type="submit"
              disabled={submitting}
              size="xl"
              className="sm:ml-auto w-full sm:w-auto"
            >
              {submitting ? d.customer.cart.submitting : d.customer.cart.submitButton}
            </Button>
          </form>

          {error && <Alert variant="destructive" className="mt-3">{error}</Alert>}
        </section>
      )}
    </div>
  )
}
