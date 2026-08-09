// Menu único "Definições" na navbar. Junta o que antes eram três botões soltos
// — idioma (PT/EN), tema (claro/escuro) e mudar password — num só popover. O
// "Sair" fica de fora de propósito: é uma ação frequente do staff (troca de
// aparelho) e merece continuar a um toque de distância.
//
// Popover (radix) e não um Dropdown de menu porque idioma/tema são seletores
// (segmented controls), não itens de navegação; e Popover, ao contrário do
// Tooltip, abre por toque — a app corre em tablets/telemóveis.

import { useState } from 'react'
import { Popover } from 'radix-ui'
import { Settings, Sun, Moon, KeyRound, ChevronRight } from 'lucide-react'
import { useAuth } from '../lib/auth-context'
import { useDict, useLang, setLang } from '../lib/i18n'
import { isDarkActive, setTheme } from '@/lib/theme'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ChangePasswordModal } from './change-password-modal'
import { FlagPT, FlagGB } from './flag-icons'

// Uma opção de um seletor segmentado (idioma/tema). A ativa fica com a "pílula"
// clara por cima do carril; as inativas são texto esbatido.
function SegmentedOption({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean
  onClick: () => void
  label: string
  icon?: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-[5px] px-2.5 py-1.5 text-xs font-semibold transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active
          ? 'bg-card text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

export function SettingsMenu() {
  const d = useDict()
  const { profile } = useAuth()
  const lang = useLang()
  // O tema vive no DOM (classe .dark no <html>); guardamos uma cópia local só
  // para o seletor re-renderizar ao trocar.
  const [dark, setDark] = useState(() => isDarkActive())
  const [open, setOpen] = useState(false)
  // "A minha conta": mudar a própria password. Fica encapsulado aqui — a navbar
  // só monta <SettingsMenu />.
  const [showAccount, setShowAccount] = useState(false)

  const s = d.layout.settingsMenu

  function applyTheme(next: 'light' | 'dark') {
    setTheme(next)
    setDark(next === 'dark')
  }

  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            aria-label={s.label}
            title={s.label}
          >
            <Settings className="size-4" />
            <span className="hidden sm:inline">{s.label}</span>
          </Button>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            side="bottom"
            align="end"
            sideOffset={8}
            collisionPadding={12}
            className="z-50 w-64 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-lg animate-fade-in outline-none"
          >
            {/* Cabeçalho: quem tem a sessão iniciada */}
            {profile?.username && (
              <p className="truncate px-2 pb-2 pt-1 text-[11px] font-medium text-muted-foreground">
                {s.signedInAs(profile.username)}
              </p>
            )}

            {/* Idioma e tema: etiqueta pequena por cima de um seletor segmentado
                que ocupa toda a largura — assim as opções ("Escuro"/"Dark") nunca
                ficam espremidas nem cortadas, seja qual for o ecrã ou o idioma. */}
            <div className="space-y-2.5 px-1">
              <div>
                <p className="mb-1 px-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  {s.languageLabel}
                </p>
                <div className="flex gap-0.5 rounded-md bg-muted/70 p-0.5">
                  <SegmentedOption
                    active={lang === 'pt'}
                    onClick={() => setLang('pt')}
                    label="PT"
                    icon={<FlagPT />}
                  />
                  <SegmentedOption
                    active={lang === 'en'}
                    onClick={() => setLang('en')}
                    label="EN"
                    icon={<FlagGB />}
                  />
                </div>
              </div>

              <div>
                <p className="mb-1 px-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  {s.themeLabel}
                </p>
                <div className="flex gap-0.5 rounded-md bg-muted/70 p-0.5">
                  <SegmentedOption
                    active={!dark}
                    onClick={() => applyTheme('light')}
                    label={s.themeLight}
                    icon={<Sun className="size-3.5" />}
                  />
                  <SegmentedOption
                    active={dark}
                    onClick={() => applyTheme('dark')}
                    label={s.themeDark}
                    icon={<Moon className="size-3.5" />}
                  />
                </div>
              </div>
            </div>

            {/* "Mudar password" só faz sentido com sessão iniciada. No Login
                (profile null) o menu mostra apenas idioma e tema. */}
            {profile && (
              <>
                <div className="my-1.5 border-t border-border" />
                {/* Mudar a própria password: fecha o popover e abre o modal */}
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    setShowAccount(true)
                  }}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <KeyRound className="size-4 text-muted-foreground" />
                  <span className="flex-1 text-left">{s.changePassword}</span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
              </>
            )}

            <Popover.Arrow className="fill-border" />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {showAccount && <ChangePasswordModal onClose={() => setShowAccount(false)} />}
    </>
  )
}
