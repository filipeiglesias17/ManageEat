import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, createBrowserRouter, useParams } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { Loader2, RefreshCw, ServerCog, WifiOff } from 'lucide-react'
import type { UserRole } from './@types/user'
import { Layout } from './pages/layout'
import { Login } from './pages/login'
import { AuthProvider } from './lib/auth-provider'
import { useAuth } from './lib/auth-context'
import { useServerEpoch } from './lib/server-epoch'
import { systemNeedsSetup } from './lib/db/system'
import { useNetworkDiscovery, refreshConnection } from './lib/network-discovery'
import { checkForUpdate } from './lib/ota'
import { subscribeAppRelease } from './lib/db/releases'
import { Modal } from './components/modal'
import { ServerConnectionSettings } from './components/server-connection-settings'
import { Wordmark } from './components/wordmark'
import { ErrorBoundary } from './components/error-boundary'
import { Button } from './components/ui/button'
import { ToastProvider } from './components/ui/toast'

const AdminDashboard = lazy(() => import('./pages/admin-dashboard').then((module) => ({ default: module.AdminDashboard })))
const EmployeeDashboard = lazy(() => import('./pages/employee-dashboard').then((module) => ({ default: module.EmployeeDashboard })))
const CustomerDashboard = lazy(() => import('./pages/customer-dashboard').then((module) => ({ default: module.CustomerDashboard })))
const KitchenDashboard = lazy(() => import('./pages/kitchen-dashboard').then((module) => ({ default: module.KitchenDashboard })))
const CustomerSession = lazy(() => import('./pages/customer-session').then((module) => ({ default: module.CustomerSession })))
const FirstRunSetup = lazy(() => import('./pages/first-run-setup').then((module) => ({ default: module.FirstRunSetup })))

// Os roles da base de dados continuam em português; as rotas internas são em inglês.
const ROLE_ROUTE: Record<UserRole, string> = {
  admin: 'admin',
  gerente: 'manager',
  empregado: 'employee',
  cliente: 'customer',
  cozinha: 'kitchen',
}

function RoleRedirect() {
  const { profile } = useAuth()
  if (!profile) return <Navigate to="/" replace />
  return <Navigate to={`/${ROLE_ROUTE[profile.role]}`} replace />
}

function Guard({ role, children }: { role: UserRole; children: React.ReactNode }) {
  const { profile } = useAuth()
  if (!profile || profile.role !== role) return <Navigate to="/" replace />
  return <>{children}</>
}

function LegacyTableRedirect() {
  const { sessionId } = useParams()
  return <Navigate to={`/table/${sessionId}`} replace />
}

function LegacyManagerRedirect() {
  const { view = 'pedidos' } = useParams()
  return <Navigate to={`/manager/${view}`} replace />
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <RoleRedirect /> },
      { path: 'admin', element: <Navigate to="/admin/pedidos" replace /> },
      { path: 'admin/:view', element: <Guard role="admin"><AdminDashboard /></Guard> },
      { path: 'manager', element: <Navigate to="/manager/pedidos" replace /> },
      { path: 'manager/:view', element: <Guard role="gerente"><AdminDashboard /></Guard> },
      { path: 'gerente', element: <Navigate to="/manager/pedidos" replace /> },
      { path: 'gerente/:view', element: <LegacyManagerRedirect /> },
      { path: 'employee', element: <Guard role="empregado"><EmployeeDashboard /></Guard> },
      { path: 'empregado', element: <Navigate to="/employee" replace /> },
      { path: 'customer', element: <Guard role="cliente"><CustomerDashboard /></Guard> },
      { path: 'cliente', element: <Navigate to="/customer" replace /> },
      { path: 'kitchen', element: <Guard role="cozinha"><KitchenDashboard /></Guard> },
      { path: 'cozinha', element: <Navigate to="/kitchen" replace /> },
      { path: 'table/:sessionId', element: <CustomerSession /> },
      { path: 'mesa/:sessionId', element: <LegacyTableRedirect /> },
    ],
  },
])

function BootScreen({ status }: { status: 'loading' | 'searching' | 'offline' | 'unreachable' }) {
  const isCapacitor = typeof window !== 'undefined' && Boolean((window as Window & { Capacitor?: unknown }).Capacitor)
  const [showSettings, setShowSettings] = useState(false)
  const noConnection = status === 'offline' || status === 'unreachable'

  return (
    <div className="min-h-screen pt-[calc(env(safe-area-inset-top)+1rem)] px-4 pb-4 bg-background text-foreground flex flex-col items-center justify-center">
      <div className="w-full max-w-md bg-card border border-border p-8 rounded-2xl flex flex-col items-center gap-6 shadow-sm text-center">
        <Wordmark className="h-14 w-auto mb-2 animate-pulse" />

        {status === 'loading' && (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="size-8 text-brand animate-spin" />
            <p className="text-muted-foreground text-sm">A carregar a aplicação...</p>
          </div>
        )}

        {status === 'searching' && (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="size-8 text-brand animate-spin" />
            <p className="text-foreground text-sm font-medium">Ligação Automática ao Servidor</p>
            <p className="text-muted-foreground text-xs px-4">
              A procurar o servidor do restaurante na rede Wi-Fi local. Certifique-se de que está ligado à rede local do restaurante.
            </p>
          </div>
        )}

        {noConnection && (
          <div className="flex flex-col gap-4 w-full items-center">
            <div className="bg-destructive/10 p-3 rounded-full border border-destructive/20 text-destructive">
              {status === 'offline' ? <WifiOff className="size-8" /> : <ServerCog className="size-8" />}
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-foreground text-sm font-medium">
                {status === 'offline' ? 'Sem ligação à rede local' : 'Sem ligação ao servidor'}
              </p>
              <p className="text-muted-foreground text-xs px-4">
                {status === 'offline'
                  ? 'Não foi possível estabelecer ligação ao servidor local do restaurante. Verifique a sua ligação Wi-Fi.'
                  : 'Não foi possível ligar ao servidor configurado. Verifique o endereço nas definições de ligação.'}
              </p>
            </div>
            {isCapacitor && (
              <div className="flex flex-col gap-2 w-full">
                <Button variant="secondary" size="sm" className="w-full" onClick={() => { refreshConnection() }}>
                  <RefreshCw className="size-3.5" />
                  Tentar de Novo
                </Button>
                <Button variant="outline" size="sm" className="w-full" onClick={() => setShowSettings(true)}>
                  <ServerCog className="size-3.5" />
                  Definições de ligação
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {showSettings && (
        <Modal onClose={() => setShowSettings(false)} aria-labelledby="conn-settings-title">
          <ServerConnectionSettings onClose={() => setShowSettings(false)} />
        </Modal>
      )}
    </div>
  )
}

function Boot() {
  const { profile, loading } = useAuth()
  const discovery = useNetworkDiscovery()
  const path = typeof window !== 'undefined' ? window.location.pathname : ''
  const isTableRoute = path.startsWith('/table/') || path.startsWith('/mesa/')
  const isCapacitor = typeof window !== 'undefined' && Boolean((window as Window & { Capacitor?: unknown }).Capacitor)

  useEffect(() => {
    if (!isCapacitor) return
    const connected = discovery.status === 'connected_local' || discovery.status === 'connected_fallback'
    if (!connected) return
    return subscribeAppRelease(() => { checkForUpdate() })
  }, [isCapacitor, discovery.status])

  if (isCapacitor) {
    if (discovery.status === 'offline') return <BootScreen status="offline" />
    if (discovery.status === 'unreachable') return <BootScreen status="unreachable" />
    if (discovery.status === 'searching') return <BootScreen status="searching" />
  }

  if (loading) return <BootScreen status="loading" />
  if (isTableRoute) return <RouterProvider router={router} />
  if (!profile) return <SetupOrLogin />

  return <RouterProvider router={router} />
}

function SetupOrLogin() {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    systemNeedsSetup()
      .then((value) => { if (active) setNeedsSetup(value) })
      .catch(() => { if (active) setNeedsSetup(false) })
    return () => { active = false }
  }, [])

  if (needsSetup === null) return <BootScreen status="loading" />
  if (needsSetup) return <FirstRunSetup />
  if (window.location.pathname !== '/') window.history.replaceState(null, '', '/')
  return <Login />
}

export function AppRoot() {
  const serverEpoch = useServerEpoch()

  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider key={serverEpoch}>
          <Suspense fallback={<div className="min-h-screen bg-background" />}>
            <Boot />
          </Suspense>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  )
}
