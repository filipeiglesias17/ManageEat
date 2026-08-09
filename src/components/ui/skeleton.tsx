import { cn } from '@/lib/utils'

// Placeholder de carregamento (bloco cinzento a pulsar). Dimensiona-se por
// className (ex.: <Skeleton className="h-24 w-full" />). aria-hidden: os
// leitores de ecrã anunciam o estado de loading no contentor, não bloco a bloco.
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-muted', className)} />
}
