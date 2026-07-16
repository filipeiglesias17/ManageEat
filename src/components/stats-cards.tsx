// Cartões e cabeçalhos de apresentação das Análises do admin. Saíram de
// `pages/admin-stats.tsx` (que ficou enorme) para aqui; são componentes puros,
// sem lógica de negócio (essa vive em `lib/stats.ts`).

import { useId } from 'react'
import type { ReactNode } from 'react'
import { ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { BRAND, euro } from '../lib/stats-theme'

// ── Sparkline (mini-gráfico dentro do KPI) ─────────────────────────
//
// Polilinha SVG simples, sem dependências nem eixos: serve só para dar a forma
// da evolução no período dentro do cartão com um degradê suave de preenchimento.

export function Sparkline({ values, color }: { values: number[]; color: string }) {
  const uid = useId()
  if (values.length < 2) return null
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const stepX = 100 / (values.length - 1)
  const points = values
    .map((v, i) => `${(i * stepX).toFixed(2)},${(100 - ((v - min) / span) * 100).toFixed(2)}`)
    .join(' ')
  const fillPoints = `0,100 ${points} 100,100`
  const last = values[values.length - 1]
  const lastX = 100
  const lastY = 100 - ((last - min) / span) * 100

  // Identificador único para o gradiente de preenchimento da sparkline
  const gradId = 'sparkGrad-' + uid.replace(/:/g, '')

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-8 opacity-80" aria-hidden>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.2} />
          <stop offset="100%" stopColor={color} stopOpacity={0.0} />
        </linearGradient>
      </defs>
      <polygon points={fillPoints} fill={`url(#${gradId})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={3} fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

// ── Selo de variação vs período anterior ───────────────────────────

export function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) {
    return <span className="text-[11px] text-muted-foreground font-medium tabular-nums">—</span>
  }
  const up = delta >= 0
  const Icon = up ? ArrowUpRight : ArrowDownRight
  const tone = up
    ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
    : 'text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/20'
  return (
    <span className={`flex items-center gap-0.5 text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-lg border ${tone}`}>
      <Icon className="size-3 shrink-0" />
      {Math.abs(delta).toFixed(1)}%
    </span>
  )
}

// ── Cartão de KPI ──────────────────────────────────────────────────

export function KpiCard({ label, value, delta, spark, accent, sub, onClick }: {
  label: string
  value: string
  delta: number | null
  spark: number[]
  accent?: boolean
  // Linha extra por baixo do valor (ex.: decomposição "À la carte / Rodízio").
  sub?: ReactNode
  // Com onClick o cartão vira botão (padrão dos POS: o resumo é um índice —
  // tocar num KPI abre o separador com o detalhe).
  onClick?: () => void
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={`relative overflow-hidden bg-card border border-border rounded-lg p-4 sm:p-5 flex flex-col gap-2 transition-all duration-300 group text-left w-full ${onClick ? 'cursor-pointer focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none' : 'cursor-default'} hover:-translate-y-0.5 hover:shadow-md ${accent ? 'border-l-[3px] border-l-brand' : 'hover:border-ring/40'}`}
    >
      {/* items-start + line-clamp: em ecrã estreito a etiqueta pode ocupar 2
          linhas sem empurrar/cortar o selo de variação, que fica shrink-0. */}
      <div className="flex items-start justify-between gap-2 relative z-10">
        <p className={`text-xs font-semibold leading-tight line-clamp-2 min-w-0 transition-colors ${accent ? 'text-brand/80 group-hover:text-brand' : 'text-muted-foreground group-hover:text-foreground'}`}>{label}</p>
        <span className="shrink-0"><DeltaBadge delta={delta} /></span>
      </div>
      {/* Valor responsivo: mais pequeno no telemóvel para o número (ex.:
          "12 205,57 €") caber no cartão estreito sem ser cortado. */}
      <p className={`font-bold tracking-tight tabular-nums relative z-10 ${accent ? 'text-2xl sm:text-3xl text-brand' : 'text-xl sm:text-2xl text-foreground'}`}>{value}</p>
      {sub && <div className="text-[11px] text-muted-foreground relative z-10">{sub}</div>}
      <div className="mt-1 relative z-10">
        <Sparkline values={spark} color={accent ? BRAND : 'var(--muted-foreground)'} />
      </div>
    </Tag>
  )
}

// ── Chip de insight automático ─────────────────────────────────────

export function InsightChip({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 bg-card border border-border rounded-lg p-4 min-w-0 hover:border-ring/40 hover:-translate-y-0.5 hover:shadow-md transition-all duration-300 group cursor-default">
      <span className="text-brand shrink-0 p-2.5 bg-brand/10 border border-brand/20 rounded-lg group-hover:bg-brand/20 transition-colors">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold leading-tight mb-0.5">{label}</p>
        <p className="text-sm text-foreground font-bold truncate">{value}</p>
      </div>
    </div>
  )
}

// ── Cabeçalho de secção com toggle de vista ────────────────────────

export function SectionHeader({ title, hint, views, current, onChange }: {
  title: string
  hint?: string
  views?: { key: string; icon: ReactNode; label: string }[]
  current?: string
  onChange?: (key: string) => void
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
      <div>
        <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{hint}</p>}
      </div>
      {views && views.length > 0 && (
        <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg border border-border shrink-0 self-start sm:self-auto">
          {views.map(v => (
            <button
              key={v.key}
              type="button"
              onClick={() => onChange?.(v.key)}
              title={v.label}
              className={`p-2 rounded-md transition-all duration-200 ${
                current === v.key
                  ? 'text-foreground bg-background shadow-sm font-semibold scale-[1.02]'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {v.icon}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Cards dos itens mais pedidos ───────────────────────────────────

export function ItemCards({ items }: { items: { name: string; qty: number; revenue: number }[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {items.map((item, i) => (
        <div key={item.name} className="bg-card border border-border rounded-lg p-4 flex flex-col gap-1 hover:border-ring/40 hover:scale-[1.01] hover:shadow-md transition-all duration-355 group cursor-default">
          <div className="flex items-start justify-between gap-1">
            <span className="text-2xl font-extrabold tabular-nums text-foreground leading-none group-hover:text-brand transition-colors">{item.qty}</span>
            <span className="text-[10px] font-bold text-muted-foreground mt-0.5 bg-muted px-2 py-0.5 rounded-lg border border-border">#{i + 1}</span>
          </div>
          <span className="text-xs font-semibold text-muted-foreground truncate leading-snug mt-2">{item.name}</span>
          <span className="text-xs text-muted-foreground font-semibold tabular-nums mt-0.5">{euro(item.revenue)}</span>
        </div>
      ))}
    </div>
  )
}
