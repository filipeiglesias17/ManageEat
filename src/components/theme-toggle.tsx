import { useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isDarkActive, toggleTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

// Botão para alternar entre tema claro e escuro. O estado vem do DOM (classe
// .dark no <html>), por isso o ícone reflete sempre o tema realmente aplicado.
export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState(() => isDarkActive())

  function handleToggle() {
    const next = toggleTheme()
    setDark(next === 'dark')
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={handleToggle}
      aria-label={dark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
      className={cn('text-muted-foreground hover:text-foreground', className)}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  )
}
