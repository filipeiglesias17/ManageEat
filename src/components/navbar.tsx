import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { useAuth } from '../lib/auth-context'
import { useMyShift } from '../lib/shift-context'
import { useDict } from '../lib/i18n'
import { Button } from '@/components/ui/button'
import { SettingsMenu } from './settings-menu'
import { LogoutShiftModal } from './logout-shift-modal'
import { Wordmark } from './wordmark'

export function Navbar() {
  const d = useDict()
  const { profile, logout } = useAuth()
  // D5: sair com o turno aberto merece um aviso (vale para qualquer role que
  // tenha picado — um admin que picou também é avisado).
  const { myShift } = useMyShift()
  const [confirmingLogout, setConfirmingLogout] = useState(false)

  // Acompanhar a largura do conteúdo: no dashboard do empregado (max-w-[110rem]
  // em layout.tsx) a navbar tem de alargar igual para o logo/Sair alinharem.
  const isWide = profile?.role === 'empregado'

  function handleLogoutClick() {
    if (myShift) {
      setConfirmingLogout(true)
      return
    }
    void logout()
  }

  return (
    // 85% de opacidade: no tema claro o 70% ficava leitoso sobre o conteúdo.
    <nav className="bg-card/85 backdrop-blur-md border-b border-border sticky top-0 z-40 pt-safe">
      <div className={`${isWide ? 'max-w-[110rem]' : 'max-w-7xl'} mx-auto px-4 sm:px-6 flex items-center h-16 gap-2`}>
        <Wordmark className="h-8 w-auto mr-1 sm:mr-6 shrink-0" />

        <div className="ml-auto flex items-center gap-2 shrink-0">
          {/* O relógio de ponto saiu daqui para uma barra no topo do conteúdo
              (ShiftStatusBar, montada no Layout) — tem mais espaço e é mais
              visível do que espremido na navbar. */}
          {/* Um só botão "Definições": idioma, tema e mudar password. Antes eram
              três botões soltos. O username passou para o cabeçalho do menu. */}
          <SettingsMenu />
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogoutClick}
            className="text-muted-foreground hover:text-foreground"
            aria-label={d.layout.navbar.logout}
            title={d.layout.navbar.logout}
          >
            <LogOut className="size-4" />
            {/* Só ícone em ecrã estreito — o texto de "Sair" faria a barra
                transbordar. */}
            <span className="hidden sm:inline">{d.layout.navbar.logout}</span>
          </Button>
        </div>
      </div>

      {confirmingLogout && myShift && profile && (
        <LogoutShiftModal
          shift={myShift}
          uid={profile.uid}
          onLogout={logout}
          onCancel={() => setConfirmingLogout(false)}
        />
      )}
    </nav>
  )
}
