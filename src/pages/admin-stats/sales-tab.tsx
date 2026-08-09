// Separador "Vendas"  quando e como entra o dinheiro: evolução, horas de
// ponta, origem dos pedidos (QR vs staff), meios de pagamento, mesas e IVA.

import { useEffect, useMemo, useState } from 'react'
import { PieChart, Pie, Cell, Tooltip } from 'recharts'
import { BarChart2 } from 'lucide-react'
import { PAYMENT_METHOD_LABEL } from '../../@types/payment'
import type { RestaurantSettings } from '../../@types/settings'
import {
  alignSeries,
  sourceStats,
  weekdayHourHeatmap,
  paymentStats,
  tableStats,
  vatBreakdown,
} from '../../lib/stats'
import { getRestaurantSettings } from '../../lib/db'
import { euro } from '../../lib/stats-theme'
import { useDict } from '../../lib/i18n'
import { SectionHeader } from '../../components/stats-cards'
import { TrendChart, HeatmapGrid, type TrendMetric } from './charts'
import { chartTooltipTheme } from './chart-theme'
import type { StatsShared } from './shared'

export function SalesTab({ shared }: { shared: StatsShared }) {
  const d = useDict()
  const {
    filtered, periodPayments, summary, covers,
    compareActive, curSeries, prevSeries,
  } = shared

  const [trendMetric, setTrendMetric] = useState<TrendMetric>('revenue')

  // Taxa de IVA por omissão das definições  precisa para itens sem taxa própria.
  const [settings, setSettings] = useState<RestaurantSettings | null>(null)
  useEffect(() => {
    let active = true
    getRestaurantSettings()
      .then(s => { if (active) setSettings(s) })
      .catch(() => { /* sem definições: a secção de IVA fica escondida */ })
    return () => { active = false }
  }, [])

  //  Agregados deste separador

  const trendData = useMemo(
    () => alignSeries(curSeries, prevSeries, trendMetric),
    [curSeries, prevSeries, trendMetric],
  )
  const sources = useMemo(() => sourceStats(filtered), [filtered])
  const heat = useMemo(() => weekdayHourHeatmap(filtered), [filtered])
  const paymentBreakdown = useMemo(() => paymentStats(periodPayments), [periodPayments])
  const paymentsTotal = useMemo(() => paymentBreakdown.reduce((s, p) => s + p.amount, 0), [paymentBreakdown])
  const tables = useMemo(() => tableStats(filtered), [filtered])
  const topTables = useMemo(() => tables.slice(0, 8), [tables])
  const vat = useMemo(
    () => (settings ? vatBreakdown(filtered, periodPayments, settings.defaultVatRate ?? 13) : []),
    [filtered, periodPayments, settings],
  )

  const showTrend = curSeries.length >= 2 && curSeries.length <= 92
  const trendTooWide = curSeries.length > 92
  const TTP = chartTooltipTheme()

  return (
    <div className="space-y-6">

      {/*  Evolução das vendas*/}
      {trendTooWide && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 text-amber-700 dark:text-amber-300 text-xs animate-fade-in">
          <p className="font-semibold">{d.stats.chart.tooWideTitle}</p>
          <p className="text-amber-700/80 dark:text-amber-300/80 mt-0.5">{d.stats.chart.tooWideDescription(curSeries.length)}</p>
        </div>
      )}
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
          <TrendChart data={trendData} metric={trendMetric} compareActive={compareActive} height={260} gradientId="trendGradSales" />
        </div>
      )}

      {/*  Horas de ponta*/}
      {heat.busiest && (
        <div className="bg-card border border-border rounded-lg p-6 shadow-sm hover:shadow-lg transition-all duration-300 animate-slide-up">
          <SectionHeader title={d.stats.sections.peakHours.title} hint={d.stats.sections.peakHours.hint} />
          <HeatmapGrid heat={heat} />
        </div>
      )}

      {/*  Origem + meios de pagamento*/}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-lg p-6 shadow-sm hover:shadow-lg transition-all duration-300 animate-slide-up">
          <SectionHeader title={d.stats.sections.orderSource.title} hint={d.stats.sections.orderSource.hint} />
          <div className="flex gap-8 items-center flex-wrap pt-2">
            <PieChart width={128} height={128} margin={{ top: 0, right: 0, bottom: 0, left: 0 }} style={{ flexShrink: 0 }} className="mx-auto sm:mx-0">
              <Pie data={sources} dataKey="orders" nameKey="label" cx={64} cy={64} innerRadius={42} outerRadius={60} paddingAngle={3} strokeWidth={0}>
                {sources.map((s, i) => <Cell key={i} fill={s.color} />)}
              </Pie>
              <Tooltip formatter={v => [Number(v), d.stats.labels.orders]} {...TTP} />
            </PieChart>
            <div className="flex flex-col gap-3 flex-1 min-w-[200px]">
              {sources.map(s => (
                <div key={s.key} className="flex flex-col gap-1 bg-muted/40 px-3 py-2 rounded-lg border border-border">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                    <span className="text-xs font-bold text-foreground/80">{s.label}</span>
                  </div>
                  <span className="text-xs font-semibold text-muted-foreground pl-4 tabular-nums">
                    {d.stats.ordersCount(s.orders)} <span className="text-muted-foreground">•</span> {euro(s.revenue)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-6 shadow-sm hover:shadow-lg transition-all duration-300 animate-slide-up">
          <SectionHeader title={d.stats.sections.paymentMethods.title} hint={d.stats.sections.paymentMethods.hintSales} />
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
                      <span className="text-muted-foreground tabular-nums">
                        {euro(p.amount)} <span className="text-muted-foreground">·</span> {p.count} <span className="text-muted-foreground">·</span> {pct.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-brand rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
              <div className="flex items-center justify-between text-sm pt-2 border-t border-border">
                <span className="text-muted-foreground font-semibold">{d.stats.labels.totalReceived}</span>
                <span className="text-foreground font-bold tabular-nums">{euro(paymentsTotal)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/*  Vendas por mesa & pessoas*/}
      <div className="bg-card border border-border rounded-lg p-6 shadow-sm hover:shadow-lg transition-all duration-300 animate-slide-up">
        <SectionHeader title={d.stats.sections.tableSales.title} hint={d.stats.sections.tableSales.hint} />
        <div className="flex flex-wrap gap-3 pt-1 pb-4">
          <div className="bg-muted/40 border border-border rounded-lg px-4 py-2.5">
            <span className="text-xs text-muted-foreground">{d.stats.sections.tableSales.coversLabel}</span>
            <span className="text-sm font-bold text-foreground">{covers}</span>
          </div>
          {covers > 0 && (
            <div className="bg-muted/40 border border-border rounded-lg px-4 py-2.5">
              <span className="text-xs text-muted-foreground">{d.stats.sections.tableSales.revenuePerCover}</span>
              <span className="text-sm font-bold text-foreground">{euro(summary.revenue / covers)}</span>
            </div>
          )}
        </div>
        {topTables.length === 0 ? (
          <p className="text-sm text-muted-foreground">{d.stats.sections.tableSales.empty}</p>
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-sm min-w-[420px]">
              <thead>
                <tr className="text-left text-muted-foreground text-xs uppercase tracking-wider">
                  <th className="py-2 pr-4 font-semibold">{d.stats.labels.tableNumber}</th>
                  <th className="py-2 pr-4 font-semibold">{d.stats.labels.sales}</th>
                  <th className="py-2 pr-4 font-semibold">{d.stats.labels.orders}</th>
                  <th className="py-2 font-semibold">{d.stats.labels.covers}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {topTables.map(t => (
                  <tr key={t.tableNumber} className="text-foreground/80">
                    <td className="py-2 pr-4 font-semibold text-foreground">{d.stats.tableRowLabel(t.tableNumber)}</td>
                    <td className="py-2 pr-4 tabular-nums">{euro(t.revenue)}</td>
                    <td className="py-2 pr-4 tabular-nums text-muted-foreground">{t.orders}</td>
                    <td className="py-2 tabular-nums text-muted-foreground">{t.covers || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/*  IVA por taxa*/}
      {vat.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-6 shadow-sm hover:shadow-lg transition-all duration-300 animate-slide-up">
          <SectionHeader title={d.stats.sections.vat.title} hint={d.stats.sections.vat.hint} />
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-sm min-w-[420px]">
              <thead>
                <tr className="text-left text-muted-foreground text-xs uppercase tracking-wider">
                  <th className="py-2 pr-4 font-semibold">{d.stats.labels.rate}</th>
                  <th className="py-2 pr-4 font-semibold">{d.stats.labels.base}</th>
                  <th className="py-2 pr-4 font-semibold">{d.stats.labels.vat}</th>
                  <th className="py-2 font-semibold">{d.stats.labels.total}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {vat.map(line => (
                  <tr key={line.rate} className="text-foreground/80">
                    <td className="py-2 pr-4 font-semibold text-foreground">{line.rate}%</td>
                    <td className="py-2 pr-4 tabular-nums">{euro(line.base)}</td>
                    <td className="py-2 pr-4 tabular-nums">{euro(line.vat)}</td>
                    <td className="py-2 tabular-nums">{euro(line.gross)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
