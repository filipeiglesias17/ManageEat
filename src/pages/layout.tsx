import { Outlet, useLocation } from 'react-router'
import { Navbar } from '../components/navbar'
import { OfflineBanner } from '../components/offline-banner'
import { UpdateBanner } from '../components/update-banner'
import { ShiftStatusBar } from '../components/shift-status-bar'
import { ShiftProvider } from '../lib/shift-provider'
import { getRunningVersion } from '../lib/ota'
import { useDict } from '../lib/i18n'
import { Wordmark } from '../components/wordmark'

export function Layout() {
  const d = useDict()
  const { pathname } = useLocation()
  // /table/:id é a rota canónica do cliente; /mesa/:id é o alias antigo dos QR
  // impressos (redireciona). Sem o /table/ aqui, a navbar do staff aparecia na
  // página do cliente e o LanguageCorner fixo ficava sobreposto ao botão Sair.
  const isSession = pathname.startsWith('/mesa/') || pathname.startsWith('/table/')
  // O dashboard do empregado tem 3 setores (mapa + menu + carrinho) e ganha em
  // usar a largura toda em monitores grandes. As outras vistas ficam contidas
  // a 1280px (max-w-7xl) para não esticar formulários/tabelas.
  const isWide = pathname.startsWith('/empregado')

  return (
    // ShiftProvider: uma subscrição de turnos para a app toda — a navbar (aviso
    // no logout), a barra do ponto e o gating "fora de turno" leem daqui.
    <ShiftProvider>
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {!isSession && <Navbar />}
      <OfflineBanner />
      <UpdateBanner />
      {/* Em modo sessão (/mesa, sem navbar) o conteúdo começa no topo, por isso
          some-se a safe-area ao padding para não ficar sob o notch. Com navbar,
          é a navbar (pt-safe) que trata disso. */}
      <main
        className={`flex-1 ${isWide ? 'max-w-[110rem]' : 'max-w-7xl'} w-full mx-auto px-4 sm:px-6 pb-6 sm:pb-8 ${
          isSession ? 'pt-[calc(env(safe-area-inset-top)+1.5rem)]' : 'pt-6 sm:pt-8'
        }`}
      >
        {/* Relógio de ponto no topo do conteúdo (só staff; esconde-se sozinho
            no modo cliente/QR). Fica acima do dashboard de cada role. */}
        {!isSession && <ShiftStatusBar />}
        <Outlet />
      </main>
      <footer className="flex flex-col items-center justify-center gap-1 py-4">
        {/* Centrar o logótipo com o texto. Como o 'g' (Manage) tem descender, a
            massa legível das letras fica acima do centro da caixa; empurramos o
            logo ~1,5px para baixo (≈ metade do descender) para a parte legível
            ficar opticamente centrada, com o 'g' a ultrapassar em baixo. */}
        <div className="flex items-center gap-1.5 opacity-60">
          <span className="text-xs text-muted-foreground">{d.common.poweredBy}</span>
          <Wordmark className="h-3.5 w-auto opacity-40 translate-y-[1.5px]" />
        </div>
        {/* Versão do bundle a correr — útil para confirmar que o OTA aplicou. */}
        <span className="text-[10px] text-muted-foreground opacity-50">v{getRunningVersion()}</span>
      </footer>
    </div>
    </ShiftProvider>
  )
}
