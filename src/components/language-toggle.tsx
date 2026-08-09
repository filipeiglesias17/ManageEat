// Botão PT/EN — clone do padrão do theme-toggle: troca em runtime, escolha
// guardada por dispositivo (localStorage), sem tocar na BD. Mostra a bandeira
// do idioma ativo (Portugal para PT, Reino Unido para EN); o aria-label diz
// para onde a troca leva.

import { Button } from '@/components/ui/button'
import { useDict, useLang, toggleLang } from '../lib/i18n'
import { FlagPT, FlagGB } from './flag-icons'

export function LanguageToggle() {
  const d = useDict()
  const lang = useLang()
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => toggleLang()}
      aria-label={d.common.languageToggleLabel}
      title={d.common.languageToggleLabel}
    >
      {lang === 'pt' ? <FlagPT className="h-4 w-[22px]" /> : <FlagGB className="h-4 w-[22px]" />}
      <span className="sr-only">{d.common.languageName}</span>
    </Button>
  )
}
