import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

// Estado vazio único para toda a app (o visual é o padrão que já existia nas
// Análises: borda dashed + ícone em chip). `compact` é a versão baixa para
// colunas do kanban e painéis pequenos.
type EmptyStateProps = {
  icon: ReactNode
  title: string
  description?: string
  // Ação opcional (ex.: um <Button> "Criar o primeiro item").
  action?: ReactNode
  compact?: boolean
  className?: string
}

export function EmptyState({ icon, title, description, action, compact = false, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center border border-dashed border-border rounded-lg bg-card text-center animate-fade-in px-4',
        compact ? 'py-8' : 'py-20',
        className
      )}
    >
      <div className={cn('bg-muted border border-border rounded-lg text-muted-foreground [&>svg]:size-8', compact ? 'p-2.5 mb-2 [&>svg]:size-5' : 'p-4 mb-4 shadow-sm')}>
        {icon}
      </div>
      <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">{title}</h3>
      {description && (
        <p className="text-xs text-muted-foreground mt-2 max-w-xs leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
