import { lazy, StrictMode, Suspense, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
// Fonte Inter empacotada ANTES do CSS: o índice de tokens (--font-sans) já a
// referencia, e importá-la aqui garante que o Vite a inclui no bundle (OTA).
import '@fontsource-variable/inter'
import './index.css'
import { createBrowserRouter, Navigate, useParams } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { Layout } from './pages/layout'
import { Login } from './pages/login'
import type { UserRole } from './@types/user'
import { AuthProvider } from './lib/auth-provider'
import { useAuth } from './lib/auth-context'
import { useServerEpoch } from './lib/server-epoch'
import { systemNeedsSetup } from './lib/db/system'

// Páginas de rota carregadas só quando a rota é visitada (code splitting).
// Cada uma vira o seu próprio chunk — quem abre o QR (/mesa) deixa de
// descarregar o admin (recharts) e os outros dashboards. As páginas são
// named exports, daí o adaptador `.then(m => ({ default: m.X }))`.
const AdminDashboard = lazy(() => import('./pages/admin-dashboard').then(m => ({ default: m.AdminDashboard })))
const EmployeeDashboard = lazy(() => import('./pages/employee-dashboard').then(m => ({ default: m.EmployeeDashboard })))
const CustomerDashboard = lazy(() => import('./pages/customer-dashboard').then(m => ({ default: m.CustomerDashboard })))
const KitchenDashboard = lazy(() => import('./pages/kitchen-dashboard').then(m => ({ default: m.KitchenDashboard })))
const CustomerSession = lazy(() => import('./pages/customer-session').then(m => ({ default: m.CustomerSession })))
// Ecrã de primeira instalação (só aparece quando o restaurante ainda não tem
// admin). Lazy para não pesar no bundle do login/QR do dia-a-dia.
const FirstRunSetup = lazy(() => import('./pages/first-run-setup').then(m => ({ default: m.FirstRunSetup })))

// As rotas são em inglês. Os VALORES de role na BD continuam em português
// (contrato com a RLS/triggers), por isso este mapa liga role → caminho EN.
// Alterar aqui e a RLS ao mesmo tempo seria uma migração de dados deliberada,
// fora do âmbito desta tradução de UI.
const ROLE_ROUTE: Record<UserRole, string> = {
  admin: 'admin',
  gerente: 'manager',
  empregado: 'employee',
  cliente: 'customer',
  cozinha: 'kitchen',
}

// A "/" não tem conteúdo próprio — manda o utilizador para a página do seu role.
function RoleRedirect() {
  const { profile } = useAuth()
  if (!profile) return <Navigate to="/" replace />
  return <Navigate to={`/${ROLE_ROUTE[profile.role]}`} replace />
}

// Só deixa entrar quem tem o role certo. Caso contrário manda para "/".
function Guard({ role, children }: { role: UserRole; children: React.ReactNode }) {
  const { profile } = useAuth()
  if (!profile || profile.role !== role) return <Navigate to="/" replace />
  return <>{children}</>
}

// Redirect das rotas PT antigas para as canónicas EN, preservando o parâmetro.
// Os QR codes IMPRESSOS apontam para /mesa/:id — este redirect garante que
// continuam a funcionar para sempre, mesmo depois de a rota canónica passar a
// /table/:id.
function LegacyTableRedirect() {
  const { sessionId } = useParams()
  return <Navigate to={`/table/${sessionId}`} replace />
}

// O router é estático (não depende de estado), por isso é criado uma única vez,
// fora do componente. Evita ter de usar useMemo com lista de dependências vazia.
const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <RoleRedirect /> },
      { path: 'admin',     element: <Navigate to="/admin/pedidos" replace /> },
      { path: 'admin/:view', element: <Guard role="admin">    <AdminDashboard />    </Guard> },
      // O gerente reutiliza o painel do admin (ciente do role): vê um subconjunto
      // de áreas e os writes são limitados pela RLS. A rota EN é /manager; a PT
      // antiga (/gerente) mantém-se como redirect.
      { path: 'manager',       element: <Navigate to="/manager/pedidos" replace /> },
      { path: 'manager/:view', element: <Guard role="gerente">  <AdminDashboard />    </Guard> },
      { path: 'gerente',       element: <Navigate to="/manager/pedidos" replace /> },
      { path: 'gerente/:view', element: <Guard role="gerente">  <AdminDashboard />    </Guard> },
      // Painéis dos restantes roles: rota EN canónica + redirect da PT antiga.
      { path: 'employee',  element: <Guard role="empregado"><EmployeeDashboard /></Guard> },
      { path: 'empregado', element: <Navigate to="/employee" replace /> },
      { path: 'customer',  element: <Guard role="cliente">  <CustomerDashboard />  </Guard> },
      { path: 'cliente',   element: <Navigate to="/customer" replace /> },
      { path: 'kitchen',   element: <Guard role="cozinha">  <KitchenDashboard />  </Guard> },
      { path: 'cozinha',   element: <Navigate to="/kitchen" replace /> },
      // Cliente via QR: /table/:sessionId é a rota pública; /mesa/:id (QR
      // impresso) redireciona preservando o id.
      { path: 'table/:sessionId', element: <CustomerSession /> },
      { path: 'mesa/:sessionId', element: <LegacyTableRedirect /> },
    ],
  },
])

import { WifiOff, Loader2, RefreshCw, ServerCog } from 'lucide-react'
import { initNetworkDiscovery, useNetworkDiscovery, refreshConnection } from './lib/network-discovery'
import { Capacitor } from '@capacitor/core'
import { StatusBar } from '@capacitor/status-bar'
import { SplashScreen } from '@capacitor/splash-screen'
import { App as CapApp } from '@capacitor/app'
import { Modal } from './components/modal'
import { ServerConnectionSettings } from './components/server-connection-settings'
import { Wordmark } from './components/wordmark'
import { ErrorBoundary } from './components/error-boundary'
import { Button } from './components/ui/button'
import { ToastProvider } from './components/ui/toast'
import { isDarkActive } from './lib/theme'
import { syncStatusBarWithTheme } from './lib/native-chrome'
import { initKeyboardScrollIntoView } from './lib/keyboard'
import { checkForUpdate, notifyReady, clearPendingIfApplied } from './lib/ota'
import { subscribeAppRelease } from './lib/db/releases'

function BootScreen({ status }: { status: 'loading' | 'searching' | 'offline' | 'unreachable' }) {
  const isCapacitor = typeof window !== 'undefined' && !!(window as Window & { Capacitor?: unknown }).Capacitor
  const [showSettings, setShowSettings] = useState(false)

  // 'offline' (sem Wi-Fi) e 'unreachable' (servidor não responde) partilham o
  // mesmo painel: avisar + deixar reconfigurar a ligação.
  const noConnection = status === 'offline' || status === 'unreachable'

  return (
    <div className="min-h-screen pt-[calc(env(safe-area-inset-top)+1rem)] px-4 pb-4 bg-background text-foreground flex flex-col items-center justify-center">
      <div className="w-full max-w-md bg-card border border-border p-8 rounded-2xl flex flex-col items-center gap-6 shadow-sm text-center">
        {/* O logótipo segue o tema (o script inline do index.html decide o tema
            antes do primeiro paint, por isso não há flash da versão errada). */}
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
          <div className="flex flex-col items-center gap-4 w-full">
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

// Decide entre login screen e router, dependendo do estado do AuthContext.
// Vive dentro do AuthProvider para poder usar useAuth.
function Boot() {
  const { profile, loading } = useAuth()
  const discovery = useNetworkDiscovery()
  // Rota pública do cliente: /table/:id (canónica) ou /mesa/:id (QR impresso
  // antigo, que o router redireciona). Ambas montam o router sem exigir login.
  const path = typeof window !== 'undefined' ? window.location.pathname : ''
  const isTableRoute = path.startsWith('/table/') || path.startsWith('/mesa/')
  const isCapacitor = typeof window !== 'undefined' && !!(window as Window & { Capacitor?: unknown }).Capacitor

  // OTA: assim que a ligação ao servidor do restaurante está OK, procura uma
  // nova versão da app e fica à escuta de publicações (Realtime). Só em nativo.
  // Subscrevemos só depois de ligado para o cliente Supabase já estar estável.
  useEffect(() => {
    if (!isCapacitor) return
    const connected = discovery.status === 'connected_local' || discovery.status === 'connected_fallback'
    if (!connected) return
    return subscribeAppRelease(() => { checkForUpdate() })
  }, [isCapacitor, discovery.status])

  // Se estiver no Capacitor, avalia o estado da ligação antes do loading de auth
  if (isCapacitor) {
    if (discovery.status === 'offline') {
      return <BootScreen status="offline" />
    }
    if (discovery.status === 'unreachable') {
      return <BootScreen status="unreachable" />
    }
    if (discovery.status === 'searching') {
      return <BootScreen status="searching" />
    }
  }

  // Enquanto o Supabase não respondeu com o estado inicial de auth, não
  // renderizamos nada útil — isto evita um flash do Login antes do listener.
  if (loading) {
    return <BootScreen status="loading" />
  }

  // /mesa/:sessionId é público (cliente via QR). O CustomerSession trata
  // de fazer signInAnonymously para termos um uid para referenciar pedidos.
  if (isTableRoute) {
    return <RouterProvider router={router} />
  }

  // Fluxo staff: sem profile autenticado, decidir entre primeira instalação
  // (ainda não há admin) e o login normal. Não redirecionamos "/" para um QR
  // guardado, porque isso bloqueava staff que usou este browser para testar uma
  // mesa.
  if (!profile) {
    return <SetupOrLogin />
  }

  return <RouterProvider router={router} />
}

// Antes do Login: se o restaurante ainda não tem nenhum admin, mostrar o ecrã
// de primeira instalação. A verificação (systemNeedsSetup) corre uma vez; até
// responder, mostramos o mesmo placeholder de arranque para não piscar o Login.
function SetupOrLogin() {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    systemNeedsSetup()
      .then((value) => { if (active) setNeedsSetup(value) })
      // Se a verificação falhar (servidor em baixo), assumimos o login normal —
      // não queremos mostrar o setup por engano quando pode já existir admin.
      .catch(() => { if (active) setNeedsSetup(false) })
    return () => { active = false }
  }, [])

  if (needsSetup === null) {
    return <BootScreen status="loading" />
  }
  if (needsSetup) {
    return <FirstRunSetup />
  }
  if (window.location.pathname !== '/') {
    window.history.replaceState(null, '', '/')
  }
  return <Login />
}

// Em nativo: a status bar fica em overlay (edge-to-edge) e a safe-area no CSS
// trata do espaçamento. O estilo segue o tema ativo (e volta a sincronizar a
// cada toggle, em theme.ts). O teclado ganha scroll-até-ao-input focado.
if (Capacitor.isNativePlatform()) {
  StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {})
  void syncStatusBarWithTheme(isDarkActive())
  void initKeyboardScrollIntoView()
}

// Inicializar a descoberta de rede local + verificação de ligação ao servidor.
initNetworkDiscovery()

// Remonta a app inteira quando o servidor Supabase muda em runtime (a "época"
// sobe — ver server-epoch.ts). A troca recria o cliente Supabase por baixo e
// orfaniza as subscrições Realtime presas ao cliente antigo (auth, profile,
// orders, sessions, service_calls, OTA). Usar a época como `key` no AuthProvider
// força o React a desmontar e voltar a montar tudo, o que faz cada useEffect de
// subscrição correr de novo e religar-se ao cliente novo — sem relogin nem
// reload manual. Acontece, por exemplo, no 'resume' se o IP do Mac mudou.
function AppRoot() {
  const serverEpoch = useServerEpoch()
  return (
    // ErrorBoundary por FORA de tudo: apanha erros de render tanto do
    // ToastProvider/AuthProvider como do resto da árvore (incl. falha ao
    // fazer import() de um chunk lazy — provável com OTA a trocar hashes).
    // ToastProvider por FORA do AuthProvider: o remount por época de servidor
    // não apaga toasts em curso, e o fluxo público /mesa também os tem.
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider key={serverEpoch}>
          {/* Suspense único: enquanto o chunk de uma rota lazy carrega na primeira
              visita, mostra um placeholder com o fundo do tema (sem flash de cor). */}
          <Suspense fallback={<div className="min-h-screen bg-background" />}>
            <Boot />
          </Suspense>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppRoot />
  </StrictMode>,
)

// Em nativo, depois de a app pintar: esconder o splash escuro (sem flash) e
// revalidar a ligação ao servidor sempre que a app volta do background.
if (Capacitor.isNativePlatform()) {
  const hideSplash = () => SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {})
  // Esconder no 2.º frame (já pintou o Boot); setTimeout é a rede de segurança
  // para a app nunca ficar presa no splash se algo correr mal.
  requestAnimationFrame(() => requestAnimationFrame(hideSplash))
  setTimeout(hideSplash, 2500)
  CapApp.addListener('resume', () => { refreshConnection(); checkForUpdate() })

  // OTA: confirmar que a app arrancou bem (ativa o rollback do capgo) e limpar
  // o aviso se o bundle pendente já foi aplicado neste arranque.
  notifyReady()
  clearPendingIfApplied()
}
