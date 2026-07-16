// Peças partilhadas dos gráficos das Análises: tema do "chrome" dos Recharts,
// mapa de calor (grid CSS à mão) e tooltip da matriz de rentabilidade.
// Movidas do antigo admin-stats.tsx quando a página foi dividida em separadores.

import {
  ResponsiveContainer, ComposedChart, Area, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import type { Heatmap, MatrixPoint, ComparePoint } from '../../lib/stats'
import { QUADRANT_META, WEEKDAYS } from '../../lib/stats'
import { BRAND, euro } from '../../lib/stats-theme'
import { readVar, chartTooltipTheme, QUADRANT_LABELS_UI } from './chart-theme'

// ── Evolução das vendas (partilhado por Resumo e Vendas) ───────────

export type TrendMetric = 'revenue' | 'orders'

export function TrendChart({ data, metric, compareActive, height = 220, gradientId }: {
  data: ComparePoint[]
  metric: TrendMetric
  compareActive: boolean
  height?: number
  // ids de gradiente têm de ser únicos por instância montada (SVG global).
  gradientId: string
}) {
  const TTP = chartTooltipTheme()
  const gridColor = readVar('--border', '#27272a')
  const tickColor = readVar('--muted-foreground', '#71717a')
  const axisLabelColor = readVar('--muted-foreground', '#52525b')
  const cursorColor = readVar('--border', '#3f3f46')
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={BRAND} stopOpacity={0.3} />
            <stop offset="95%" stopColor={BRAND} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={gridColor} />
        <XAxis
          dataKey="label"
          tick={{ fill: tickColor, fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          // preserveStartEnd + minTickGap: o recharts salta labels que se
          // sobreporiam, ajustando-se à largura. Em telemóvel (~390px) deixa
          // de empilhar as datas umas em cima das outras.
          interval="preserveStartEnd"
          minTickGap={28}
        />
        <YAxis
          tick={{ fill: axisLabelColor, fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={metric === 'revenue' ? 46 : 28}
          // Formato COMPACTO no eixo (sem cêntimos, "k" para milhares): "800 €",
          // "1,2 k€". Sem isto, "1 234,00 €" fica largo demais e o dígito da
          // esquerda era cortado pela margem do gráfico em ecrãs estreitos.
          tickFormatter={v => {
            if (metric !== 'revenue') return String(v)
            const n = Number(v)
            return n >= 1000
              ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1).replace('.', ',')} k€`
              : `${Math.round(n)} €`
          }}
        />
        <Tooltip
          {...TTP}
          cursor={{ stroke: cursorColor }}
          formatter={(v, name) => {
            const label = name === 'previous' ? 'Anterior' : 'Atual'
            const text = metric === 'revenue' ? euro(Number(v)) : String(v)
            return [text, label]
          }}
        />
        {compareActive && (
          <Line type="monotone" dataKey="previous" stroke={tickColor} strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
        )}
        <Area type="monotone" dataKey="current" stroke={BRAND} strokeWidth={2} fill={`url(#${gradientId})`} dot={false} activeDot={{ r: 4, fill: BRAND, stroke: readVar('--card', '#18181b'), strokeWidth: 2 }} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// ── Mapa de calor: dia da semana × hora ────────────────────────────

function intensity(count: number, max: number): string {
  // Célula vazia: cor neutra subtil que funciona em claro e escuro.
  if (count === 0) return 'var(--muted)'
  // Mínimo de 12% para uma célula com 1 pedido não ficar invisível.
  // color-mix com var(--brand): a escala do heatmap usa a cor da marca do tema
  // ativo em vez de um hex fixo (reage ao toggle e a rebrandings).
  const pct = Math.round((0.12 + (count / max) * 0.8) * 100)
  return `color-mix(in srgb, var(--brand) ${pct}%, transparent)`
}

export function HeatmapGrid({ heat }: { heat: Heatmap }) {
  const hours = Array.from({ length: 24 }, (_, h) => h)
  return (
    <div className="overflow-x-auto custom-scrollbar -mx-1 px-1">
      <div className="min-w-[680px] pb-2">
        {/* Régua das horas */}
        <div className="grid items-center mb-2" style={{ gridTemplateColumns: '3.5rem repeat(24, minmax(0,1fr)) 3.5rem' }}>
          <span />
          {hours.map(h => (
            <span key={h} className="text-[10px] text-muted-foreground font-bold text-center tabular-nums">
              {String(h).padStart(2, '0')}
            </span>
          ))}
          <span className="text-[10px] text-muted-foreground font-bold text-right pr-2">Total</span>
        </div>

        {/* Uma linha por dia da semana */}
        {WEEKDAYS.map((dayLabel, d) => (
          <div key={dayLabel} className="grid items-center gap-1 mb-1" style={{ gridTemplateColumns: '3.5rem repeat(24, minmax(0,1fr)) 3.5rem' }}>
            <span className="text-xs text-muted-foreground font-semibold">{dayLabel}</span>
            {hours.map(h => {
              const count = heat.grid[d][h]
              return (
                <div
                  key={h}
                  className="h-7 rounded-md border border-border hover:scale-[1.2] hover:z-20 hover:ring-2 hover:ring-brand/50 cursor-help transition-all duration-200"
                  style={{ background: intensity(count, heat.max) }}
                  title={`${dayLabel} às ${String(h).padStart(2, '0')}:00 · ${count} pedido${count !== 1 ? 's' : ''}`}
                />
              )
            })}
            <span className="text-xs text-muted-foreground text-right font-semibold tabular-nums pr-2">{heat.dayTotals[d]}</span>
          </div>
        ))}

        {/* Legenda explicativa no fundo */}
        <div className="flex items-center justify-end gap-3 mt-4 text-[10px] text-muted-foreground pr-2">
          <span>Menos movimento</span>
          <div className="flex gap-0.5">
            <div className="w-4 h-3 rounded-[2px]" style={{ background: intensity(0, 100) }} />
            <div className="w-4 h-3 rounded-[2px]" style={{ background: intensity(25, 100) }} />
            <div className="w-4 h-3 rounded-[2px]" style={{ background: intensity(50, 100) }} />
            <div className="w-4 h-3 rounded-[2px]" style={{ background: intensity(75, 100) }} />
            <div className="w-4 h-3 rounded-[2px]" style={{ background: intensity(100, 100) }} />
          </div>
          <span>Mais movimento</span>
        </div>
      </div>
    </div>
  )
}

// ── Tooltip da matriz de rentabilidade do menu ─────────────────────

type MatrixTipProps = { active?: boolean; payload?: { payload: MatrixPoint }[] }

export function MatrixTooltip({ active, payload }: MatrixTipProps) {
  if (!active || !payload || payload.length === 0) return null
  const p = payload[0].payload
  const meta = QUADRANT_META[p.quadrant]
  return (
    <div className="bg-popover border border-border rounded-lg p-3 shadow-lg max-w-xs animate-fade-in">
      <p className="text-foreground font-bold text-xs">{p.name}</p>
      <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground/80">{p.qty} pedidos</span>
        <span className="text-muted-foreground">•</span>
        <span className="font-semibold text-foreground">{euro(p.revenue)}</span>
      </div>
      <div className="mt-2 pt-2 border-t border-border flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: meta.color }} />
        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: meta.color }}>{QUADRANT_LABELS_UI[p.quadrant]}</p>
      </div>
    </div>
  )
}
