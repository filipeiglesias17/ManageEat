// Badge "Beta" reutilizável. Sinaliza funcionalidades que existem mas têm
// limitações conhecidas (fonte única: src/lib/beta-features.ts).
//
// Com `hint`, o badge vira botão e abre um popover com a explicação — Popover
// (e não Tooltip) de propósito: o Tooltip do radix não abre por toque, e a
// app corre em tablets/telemóveis. Sem `hint` é um span estático.

import { Popover } from 'radix-ui'
import { Info } from 'lucide-react'
import { Badge } from './badge'

export function BetaBadge({ hint, className }: { hint?: string; className?: string }) {
  const base = (
    <Badge
      variant="warning"
      className={`shrink-0 whitespace-nowrap align-middle text-[10px] font-bold uppercase tracking-wider ${className ?? ''}`}
    >
      Beta
    </Badge>
  )

  if (!hint) return base

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`Funcionalidade em beta: ${hint}`}
          className="inline-flex shrink-0 align-middle rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 cursor-help"
        >
          <Badge
            variant="warning"
            className={`shrink-0 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider ${className ?? ''}`}
          >
            Beta
            <Info className="size-2.5" />
          </Badge>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 max-w-72 rounded-lg border border-border bg-popover p-3 text-xs leading-relaxed text-popover-foreground shadow-lg animate-fade-in outline-none"
        >
          {hint}
          <Popover.Arrow className="fill-border" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
