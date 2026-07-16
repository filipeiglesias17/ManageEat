import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// Junta classes condicionais (clsx) e resolve conflitos de classes Tailwind
// (tailwind-merge). Ex.: cn('px-2', condicao && 'px-4') -> 'px-4'. É o helper
// que os componentes do shadcn/ui usam para deixar sobrepor classes por chamada.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
