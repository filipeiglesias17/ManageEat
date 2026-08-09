// Separador "Resumo"  a resposta rápida a "como está o negócio?".
// É o primeiro ecrã (padrão dos POS PT: o dia corrente sem configurar nada) e
// funciona como índice: tocar num KPI ou num "ver tudo" abre o separador certo.

import { useMemo, useState } from 'react'
import { Trophy, Flame, TrendingUp, Tag, BarChart2, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PAYMENT_METHOD_LABEL } from '../../@types/payment'
import {
  type DayPoint,
  alignSeries,
  itemStats,
  sourceStats,
  weekdayHourHeatmap,
  paymentStats,
  paymentEntryRevenue,
} from '../../lib/stats'
import { euro } from '../../lib/stats-theme'
import { useDict } from '../../lib/i18n'
import { KpiCard, InsightChip, SectionHeader } from '../../components/stats-cards'
import { TrendChart, type TrendMetric } from './charts'
import type { StatsShared } from './shared'

export function SummaryTab({ shared }: { shared: StatsShared }) {
  const d = useDict()
  const {
    filtered, periodPayments, summary, deltas, covers,
    compareActive, homologous, curSeries, prevSeries, onNavigate,
  } = shared

  const [trendMetric, setTrendMetric] = useState<TrendMetric>('revenue')

  //  Agregados deste separador

  const items = useMemo(() => itemStats(filtered), [filtered])
  const sources = useMemo(() => sourceStats(filtered), [filtered])
  const heat = useMemo(() => weekdayHourHeatmap(filtered), [filtered])
  const paymentBreakdown = useMemo(() => paymentStats(periodPayments), [periodPayments])
  const paymentsTotal = useMemo(() => paymentBreakdown.reduce((s, p) => s + p.amount, 0), [paymentBreakdown])

  // Decomposição do total: entradas de rodízio (dos pagamentos) vs o resto
  // (pedidos à la carte + extras)  abre a "caixa preta" da receita.
  const entryRevenue = useMemo(
    () => periodPayments.reduce((s, p) => s + paymentEntryRevenue(p), 0),
    [periodPayments],
  )
  const itemsRevenue = Math.max(summary.revenue - entryRevenue, 0)

  const trendData = useMemo(
    () => alignSeries(curSeries, prevSeries, trendMetric),
    [curSeries, prevSeries, trendMetric],
  )

  const sparks = useMemo(() => ({
    revenue: curSeries.map(p => p.revenue),
    orders: curSeries.map(p => p.orders),
    avg: curSeries.map(p => (p.orders > 0 ? p.revenue / p.orders : 0)),
  }), [curSeries])

  const bestDay = useMemo<DayPoint | null>(() => {
    if (curSeries.length === 0) return null
    return curSeries.reduce((best, p) => (p.revenue > best.revenue ? p : best), curSeries[0])
  }, [curSeries])

  const dominantSource = useMemo(() => {
    const total = sources.reduce((s, x) => s + x.orders, 0)
    if (total === 0) return null
    const top = sources[0].orders >= sources[1].orders ? sources[0] : sources[1]
    return { label: top.label, pct: Math.round((top.orders / total) * 100) }
  }, [sources])

  const showTrend = curSeries.length >= 2 && curSeries.length <= 92
  const top5 = items.slice(0, 5)
  const maxTopQty = top5[0]?.qty ?? 1

  return (
    <div className="space-y-6">

      {/*  KPIs do período
          Em telemóveis pequenos (<380px) fica 1 coluna: um cartão a meia largura
          não chega para o número grande (ex.: "12 205,57 €") sem o cortar. */}
      <div className="grid grid-cols-1 min-[380px]:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 animate-slide-up">
        <KpiCard
          label={d.stats.kpis.revenue}
          value={euro(summary.revenue)}
          delta={deltas.revenue}
          spark={sparks.revenue}
          accent
          sub={entryRevenue > 0
            ? <span>{d.stats.kpis.alaCarteLabel} {euro(itemsRevenue)} · {d.stats.kpis.rodizioEntriesLabel} {euro(entryRevenue)}</span>
            : undefined}
          onClick={() => onNavigate('sales')}
        />
        <KpiCard
          label={d.stats.kpis.orders}
          value={String(summary.orders)}
          delta={deltas.orders}
          spark={sparks.orders}
          onClick={() => onNavigate('sales')}
        />
        <KpiCard
          label={d.stats.kpis.avgTicket}
          value={summary.orders > 0 ? euro(summary.avgTicket) : '—'}
          delta={deltas.avgTicket}
          spark={sparks.avg}
          sub={<span>{d.stats.kpis.avgTicketSub}</span>}
          onClick={() => onNavigate('sales')}
        />
        <KpiCard
          label={d.stats.kpis.covers}
          value={covers > 0 ? String(covers) : '—'}
          delta={covers > 0 ? deltas.covers : null}
          spark={[]}
          sub={<span>{d.stats.kpis.coversSub}</span>}
          onClick={() => onNavigate('sales')}
        />
      </div>

      {compareActive && (
        <p className="text-[11px] text-muted-foreground -mt-3">
          {homologous
            ? d.stats.compare.noteSameWeekday
            : d.stats.compare.notePreviousPeriod}
        </p>
      )}

      {/*  Destaques*/}
      {(bestDay || heat.busiest || items[0] || dominantSource) && (
        <div className="bg-card border border-border rounded-lg p-6 shadow-sm animate-slide-up">
          <SectionHeader title={d.stats.sections.highlights.title} hint={d.stats.sections.highlights.hint} />
          {/* Chips com ícone + texto: 1 coluna no telemóvel (2 colunas espremiam
              o valor a "s…"), 2 no tablet, 4 no desktop. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
            {bestDay && bestDay.revenue > 0 && (
              <InsightChip icon={<Trophy className="size-4" />} label={d.stats.sections.highlights.bestDay} value={`${bestDay.label} · ${euro(bestDay.revenue)}`} />
            )}
            {heat.busiest && (
              <InsightChip icon={<Flame className="size-4" />} label={d.stats.sections.highlights.peakHour} value={`${d.stats.weekdays[heat.busiest.day]} ${String(heat.busiest.hour).padStart(2, '0')}h`} />
            )}
            {items[0] && (
              <InsightChip icon={<TrendingUp className="size-4" />} label={d.stats.sections.highlights.topItem} value={`${items[0].name} ×${items[0].qty}`} />
            )}
            {dominantSource && (
              <InsightChip icon={<Tag className="size-4" />} label={d.stats.sections.highlights.dominantSource} value={`${dominantSource.label} · ${dominantSource.pct}%`} />
            )}
          </div>
        </div>
      )}

      {/*  Evolução das vendas*/}
      {showTrend && (
        <div className="bg-card border border-border rounded-lg p-6 shadow-sm hover:shadow-lg transition-all duration-300 animate-slide-up">
          <SectionHeader
            title={d.stats.sections.trend.title}
            hint={compareActive ? d.stats.sections.trend.compareHint : undefined}
            current={trendMetric}
            onChange={v => setTrendMetric(v as TrendMetric)}
            views={[
              { key: 'revenue', icon: <span className="text-xs font-bold px-1">€</span>, label: d.stats.sections.trend.views.revenue },
              { key: 'orders', icon: <BarChart2 className="size-3.5" />, label: d.stats.sections.trend.views.orders },
            ]}
          />
          <TrendChart data={trendData} metric={trendMetric} compareActive={compareActive} gradientId="trendGradSummary" />
        </div>
      )}

      {/*  Minis: top artigos + meios de pagamento*/}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-lg p-6 shadow-sm animate-slide-up">
          <SectionHeader title={d.stats.sections.topItems.title} />
          {top5.length === 0 ? (
            <p className="text-sm text-muted-foreground pt-1">{d.stats.sections.topItems.empty}</p>
          ) : (
            <div className="space-y-2.5 pt-1">
              {top5.map((item, i) => (
                <div key={item.name} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-muted-foreground w-4 text-right shrink-0">{i + 1}</span>
                  <span className="text-xs font-bold text-foreground/80 truncate w-40 shrink-0">{item.name}</span>
                  <div className="flex-1 bg-muted rounded-full h-2 border border-border overflow-hidden">
                    <div className="bg-brand h-full transition-all duration-700 ease-out" style={{ width: `${(item.qty / maxTopQty) * 100}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-muted-foreground tabular-nums shrink-0">×{item.qty}</span>
                </div>
              ))}
            </div>
          )}
          <Button variant="ghost" size="sm" className="mt-4 text-muted-foreground" onClick={() => onNavigate('products')}>
            <span>{d.stats.sections.topItems.viewAll}</span>
            <ArrowRight className="size-3.5" />
          </Button>
        </div>

        <div className="bg-card border border-border rounded-lg p-6 shadow-sm animate-slide-up">
          <SectionHeader title={d.stats.sections.paymentMethods.title} />
          {paymentsTotal === 0 ? (
            <p className="text-sm text-muted-foreground pt-1">{d.stats.sections.paymentMethods.empty}</p>
          ) : (
            <div className="space-y-3 pt-1">
              {paymentBreakdown.map(p => {
                const pct = paymentsTotal > 0 ? (p.amount / paymentsTotal) * 100 : 0
                return (
                  <div key={p.method}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-foreground/80 font-medium">{PAYMENT_METHOD_LABEL[p.method]}</span>
                      <span className="text-muted-foreground tabular-nums">{euro(p.amount)} · {pct.toFixed(0)}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-brand rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <Button variant="ghost" size="sm" className="mt-4 text-muted-foreground" onClick={() => onNavigate('closings')}>
            <span>{d.stats.sections.paymentMethods.viewAll}</span>
            <ArrowRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
