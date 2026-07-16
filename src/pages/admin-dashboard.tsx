import { useEffect, useState, lazy, Suspense } from 'react'
import { formatEuro } from '../lib/helpers'
import { useParams, Link, Navigate } from 'react-router'
import { ClipboardList, UtensilsCrossed, Tag, QrCode, Users, BarChart3, Settings, Clock, WifiOff } from 'lucide-react'
import { useDict } from '../lib/i18n'
import type { Translation } from '../lib/i18n'
import type { MenuItem } from '../@types/menu-item'
import type { Category } from '../@types/category'
import type { Order } from '../@types/order'
import type { AppProfile, UserRole } from '../@types/user'
import {
  getCategories,
  getMenuItems,
  subscribeOrders, subscribePayments, subscribeSessions,
  getProfiles,
} from '../lib/db'
import type { QrSession } from '../lib/db'
import type { Payment } from '../@types/payment'
import { orderSubtotal, safeQuantity, safeItemName } from '../lib/order-utils'
import { orderDiscountAmount, orderItemsRevenue } from '../lib/account'
import { useAuth } from '../lib/auth-context'
import { useConnectionAlert } from '../hooks/use-connection-alert'
import { statusColor, statusLabel } from '../lib/order-status-ui'
import { OrdersLimitNotice } from '../components/orders-limit-notice'
import { AdminPermanentSessions } from '../components/admin-permanent-sessions'
import { AdminRestaurantSettings } from '../components/admin-restaurant-settings'
import { AdminShifts } from '../components/admin-shifts'

// Componentes das abas modularizados
import { CategoriesTab } from '../components/admin/categories-tab'
import { MenuTab } from '../components/admin/menu-tab'
import { UsersTab } from '../components/admin/users-tab'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const AdminStats = lazy(() => import('./admin-stats').then((m) => ({ default: m.AdminStats })))

const MANAGED_ROLES: UserRole[] = ['empregado', 'cliente', 'cozinha']
type AdminView = 'pedidos' | 'menu' | 'categorias' | 'mesas' | 'turnos' | 'utilizadores' | 'analises' | 'settings'

// Ordem fixa das abas (não depende do idioma) — os rótulos vêm do dicionário
// em buildAdminViews, chamada dentro do componente (useDict re-renderiza ao
// trocar de idioma).
const ADMIN_VIEW_ORDER: AdminView[] = ['pedidos', 'menu', 'categorias', 'mesas', 'turnos', 'utilizadores', 'analises', 'settings']

const ADMIN_VIEW_ICONS: Record<AdminView, React.ComponentType<{ className?: string }>> = {
  pedidos: ClipboardList,
  menu: UtensilsCrossed,
  categorias: Tag,
  mesas: QrCode,
  turnos: Clock,
  utilizadores: Users,
  analises: BarChart3,
  settings: Settings,
}

function buildAdminViews(d: Translation): Array<{ id: AdminView; label: string; icon: React.ComponentType<{ className?: string }> }> {
  const labelById: Record<AdminView, string> = {
    pedidos: d.admin.nav.orders,
    menu: d.admin.nav.menu,
    categorias: d.admin.nav.categories,
    mesas: d.admin.nav.tables,
    turnos: d.admin.nav.shifts,
    utilizadores: d.admin.nav.users,
    analises: d.admin.nav.stats,
    settings: d.admin.nav.settings,
  }
  return ADMIN_VIEW_ORDER.map((id) => ({ id, label: labelById[id], icon: ADMIN_VIEW_ICONS[id] }))
}

function isValidAdminView(view: string): view is AdminView {
  return (ADMIN_VIEW_ORDER as string[]).includes(view)
}

// ── Apresentação de um pedido (partilhada pela tabela e pelos cartões) ──
// Extraída para não duplicar a lógica de descontos/estado nas duas vistas.

function orderItemsSummary(order: Order): string {
  return order.items.map((i) => `${safeQuantity(i.quantity)}× ${safeItemName(i.menuItemName)}`).join(', ')
}

function orderHasDiscounts(order: Order): boolean {
  return !!order.discountValue || order.items.some((i) => i.itemDiscountValue)
}

// Total do pedido: risca o subtotal quando há desconto ou cancelamento.
function OrderTotal({ order }: { order: Order }) {
  const subtotal = orderSubtotal(order)
  if (order.status === 'cancelled') {
    return (
      <span className="flex flex-col">
        <span className="text-muted-foreground line-through text-xs">{formatEuro(subtotal)}</span>
        <span className="text-destructive">{formatEuro(0)}</span>
      </span>
    )
  }
  if (orderDiscountAmount(order) <= 0) return <span>{formatEuro(subtotal)}</span>
  return (
    <span className="flex flex-col">
      <span className="text-muted-foreground line-through text-xs">{formatEuro(subtotal)}</span>
      <span>{formatEuro(orderItemsRevenue(order))}</span>
    </span>
  )
}

// Badges dos descontos por item e do pedido inteiro. Devolve null sem
// descontos — o chamador decide o placeholder ("—" na tabela, nada no cartão).
function OrderDiscountBadges({ order }: { order: Order }) {
  const d = useDict()
  if (!orderHasDiscounts(order)) return null
  const itemDiscounts = order.items.filter((i) => i.itemDiscountValue)
  return (
    <div className="flex flex-col gap-1 items-start">
      {itemDiscounts.map((i, idx) => (
        <Badge key={idx} variant="secondary">
          {i.menuItemName}: {i.itemDiscountType === 'percent'
            ? `-${i.itemDiscountValue}%`
            : `-${formatEuro(i.itemDiscountValue ?? 0)}`}
        </Badge>
      ))}
      {!!order.discountValue && (
        <Badge variant="warning">
          {d.admin.orders.orderDiscountLabel(
            order.discountType === 'percent'
              ? `-${order.discountValue}%`
              : `-${formatEuro(order.discountValue ?? 0)}`,
          )}
        </Badge>
      )}
    </div>
  )
}

function OrderStatusInfo({ order }: { order: Order }) {
  return (
    <div className="flex flex-col gap-1 items-start">
      <Badge variant="outline" className={statusColor[order.status]}>
        {statusLabel[order.status]}
      </Badge>
      {order.status === 'cancelled' && order.cancelReason && (
        <span className="text-xs text-destructive">{order.cancelReason}</span>
      )}
    </div>
  )
}

// Cartão de pedido para ecrãs pequenos — os mesmos dados essenciais da tabela
// sem obrigar a scroll horizontal.
function OrderCard({ order }: { order: Order }) {
  const d = useDict()
  return (
    <li className="bg-card border border-border rounded-lg p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium">
          {d.admin.orders.tableLabel(order.tableNumber)}
          <span className="ml-2 text-xs font-normal capitalize text-muted-foreground">{order.source}</span>
        </span>
        <OrderStatusInfo order={order} />
      </div>
      <p className="text-xs text-muted-foreground">{orderItemsSummary(order)}</p>
      <div className="flex items-end justify-between gap-2">
        <OrderDiscountBadges order={order} />
        <div className="ml-auto text-right text-sm font-medium">
          <OrderTotal order={order} />
        </div>
      </div>
    </li>
  )
}

export function AdminDashboard() {
  const d = useDict()
  const [categories, setCategories] = useState<Category[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [sessions, setSessions] = useState<QrSession[]>([])
  // Aviso de ligação perdida (só aparece se o erro persistir — ver useConnectionAlert).
  const { visible: connLost, markOk: feedOk, markError: feedFail } = useConnectionAlert()

  const [users, setUsers] = useState<AppProfile[]>([])
  const [allProfiles, setAllProfiles] = useState<AppProfile[]>([])
  // Aviso separado do `connLost` (Realtime): este cobre o fetch inicial
  // (categorias/menu/utilizadores), que não tem subscrição em tempo real e
  // por isso pode falhar em silêncio (RLS, timeout, Supabase em baixo) sem
  // nunca disparar feedFail. Sem isto as abas ficavam vazias sem explicação,
  // indistinguíveis de "não há dados".
  const { visible: initialLoadFailed, markOk: initialLoadOk, markError: initialLoadFail } = useConnectionAlert()

  const { view = 'pedidos' } = useParams<{ view: string }>()
  const validView = isValidAdminView(view)

  const { profile } = useAuth()
  const isManager = profile?.role === 'gerente'
  const basePath = isManager ? '/gerente' : '/admin'
  const managedRoles: UserRole[] = isManager ? MANAGED_ROLES : [...MANAGED_ROLES, 'gerente']
  const adminViews = buildAdminViews(d)
  const visibleAdminViews = isManager
    ? adminViews.filter((item) => item.id !== 'settings')
    : adminViews

  async function fetchCategories() {
    setCategories(await getCategories())
  }

  async function fetchMenuItems() {
    setMenuItems(await getMenuItems())
  }

  async function fetchUsers() {
    const all = await getProfiles()
    setAllProfiles(all)
    setUsers(all.filter((u) => managedRoles.includes(u.role)))
  }

  useEffect(() => {
    // Corre os três em paralelo mas cada um com o seu próprio try/catch —
    // se um falhar (ex: RLS nega utilizadores) os outros continuam a
    // popular a UI na mesma, em vez de um Promise.all rejeitar tudo junto.
    async function loadCategories() {
      try {
        await fetchCategories()
        initialLoadOk()
      } catch {
        initialLoadFail()
      }
    }
    async function loadMenuItems() {
      try {
        await fetchMenuItems()
        initialLoadOk()
      } catch {
        initialLoadFail()
      }
    }
    async function loadUsers() {
      try {
        await fetchUsers()
        initialLoadOk()
      } catch {
        initialLoadFail()
      }
    }
    loadCategories()
    loadMenuItems()
    loadUsers()
    // Carregamentos iniciais só ao montar: recriar quando os fetchers mudam
    // repetiria os fetches sem motivo (padrão aceite no protótipo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return subscribeOrders(
      (list) => { feedOk(); setOrders(list) },
      feedFail,
    )
  }, [feedOk, feedFail])

  useEffect(() => {
    return subscribePayments(
      (list) => { feedOk(); setPayments(list) },
      feedFail,
    )
  }, [feedOk, feedFail])

  useEffect(() => {
    return subscribeSessions(
      (list) => { feedOk(); setSessions(list) },
      feedFail,
    )
  }, [feedOk, feedFail])

  if (isManager && view === 'settings') {
    return <Navigate to="/gerente/pedidos" replace />
  }

  // Pedidos mais recentes primeiro — a mesma ordem na tabela e nos cartões.
  const sortedOrders = [...orders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return (
    <>
      {connLost && (
        <Alert variant="destructive" icon={<WifiOff />} className="mb-6">
          {d.admin.connectionLost}
        </Alert>
      )}
      {initialLoadFailed && (
        <Alert variant="destructive" icon={<WifiOff />} className="mb-6">
          {d.admin.initialLoadFailed}
        </Alert>
      )}
    <div className="flex flex-col md:flex-row gap-6 md:gap-8">
      {/* Sidebar navigation */}
      <aside className="w-full md:w-64 shrink-0 bg-card border border-border rounded-lg p-4 flex flex-col gap-1 md:sticky md:top-24 h-auto md:h-[calc(100vh-8rem)]">
        <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest px-3 mb-3 hidden md:block">{d.admin.nav.sectionLabel}</p>
        {/* Em telemóvel as abas ficam numa grelha de 2 colunas (todas visíveis,
            alinhadas) em vez de um wrap onde cada item tinha largura própria e os
            lados não batiam certo. No desktop mantém-se a coluna vertical. */}
        <div className="grid grid-cols-2 md:flex md:flex-col gap-1 pb-2 md:pb-0">
          {visibleAdminViews.map((item) => {
            const Icon = item.icon
            const active = view === item.id
            return (
              <Link
                key={item.id}
                to={`${basePath}/${item.id}`}
                className={`flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium rounded-lg transition-all whitespace-nowrap ${
                  active
                    ? 'bg-primary/10 border border-primary/20 text-primary font-semibold'
                    : 'border border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                <Icon className={`size-4 shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                {item.label}
              </Link>
            )
          })}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0">
        {!validView && (
          <section className="flex flex-col items-center justify-center text-center py-20 gap-4">
            <h1 className="text-2xl font-bold">{d.admin.notFound.title}</h1>
            <p className="text-muted-foreground text-sm max-w-sm">
              {d.admin.notFound.description}
            </p>
            <Button asChild>
              <Link to="/admin/pedidos">{d.admin.notFound.backToOrders}</Link>
            </Button>
          </section>
        )}

        {view === 'analises' && (
          <Suspense fallback={<p className="text-muted-foreground text-sm">{d.admin.statsLoading}</p>}>
            <AdminStats orders={orders} payments={payments} menuItems={menuItems} categories={categories} />
          </Suspense>
        )}

        {view === 'categorias' && (
          <CategoriesTab
            categories={categories}
            menuItems={menuItems}
            setCategories={setCategories}
          />
        )}

        {view === 'menu' && (
          <MenuTab
            menuItems={menuItems}
            categories={categories}
            setMenuItems={setMenuItems}
          />
        )}

        {view === 'pedidos' && (
          <section className="space-y-6">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-xl font-bold">{d.admin.orders.title}</h1>
              <span className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
                <span className="size-1.5 rounded-full bg-green-500 inline-block animate-pulse" />
                {d.admin.orders.live}
              </span>
              {/* ⓘ do limite de pedidos: encostado ao canto direito da linha do título. */}
              <span className="ml-auto">
                <OrdersLimitNotice count={orders.length} />
              </span>
            </div>

            {orders.length === 0 ? (
              <EmptyState
                icon={<ClipboardList />}
                title={d.admin.orders.emptyTitle}
                description={d.admin.orders.emptyDescription}
              />
            ) : (
              <>
                {/* Tabela só em ecrã largo; no telemóvel a lista de cartões
                    abaixo mostra os mesmos dados sem scroll horizontal. */}
                <div className="hidden sm:block bg-card border border-border rounded-lg overflow-hidden shadow-sm mb-4">
                  <Table className="min-w-[480px]">
                    <TableHeader>
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                        <TableHead className="px-5">{d.admin.orders.columns.table}</TableHead>
                        <TableHead className="px-5">{d.admin.orders.columns.source}</TableHead>
                        <TableHead className="px-5">{d.admin.orders.columns.items}</TableHead>
                        <TableHead className="px-5">{d.admin.orders.columns.total}</TableHead>
                        <TableHead className="px-5">{d.admin.orders.columns.discount}</TableHead>
                        <TableHead className="px-5">{d.admin.orders.columns.status}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedOrders.map((order) => (
                        <TableRow key={order.id}>
                          <TableCell className="px-5 py-3">{d.admin.orders.tableLabel(order.tableNumber)}</TableCell>
                          <TableCell className="px-5 py-3 capitalize text-muted-foreground">{order.source}</TableCell>
                          <TableCell className="px-5 py-3 text-muted-foreground whitespace-normal">
                            {orderItemsSummary(order)}
                          </TableCell>
                          <TableCell className="px-5 py-3">
                            <OrderTotal order={order} />
                          </TableCell>
                          <TableCell className="px-5 py-3">
                            {orderHasDiscounts(order)
                              ? <OrderDiscountBadges order={order} />
                              : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="px-5 py-3">
                            <OrderStatusInfo order={order} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <ul className="sm:hidden space-y-2">
                  {sortedOrders.map((order) => (
                    <OrderCard key={order.id} order={order} />
                  ))}
                </ul>
              </>
            )}
          </section>
        )}

        {view === 'mesas' && (
          <section className="space-y-6">
            <AdminPermanentSessions />
          </section>
        )}

        {view === 'turnos' && (
          <section className="space-y-6">
            <AdminShifts orders={orders} profiles={allProfiles} payments={payments} sessions={sessions} />
          </section>
        )}

        {view === 'utilizadores' && (
          <UsersTab
            users={users}
            setUsers={setUsers}
            managedRoles={managedRoles}
          />
        )}

        {view === 'settings' && (
          <div className="space-y-12">
            <AdminRestaurantSettings
              categories={categories}
              menuItems={menuItems}
              onMenuItemsChange={setMenuItems}
            />
          </div>
        )}
      </div>
    </div>
    </>
  )
}
