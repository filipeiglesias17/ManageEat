import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// Indicador de carregamento reutilizável. Centraliza o `Loader2 animate-spin`
// que estava espalhado por vários ecrãs.
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin', className)} aria-hidden />
}
