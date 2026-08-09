// Separador "Produtos"  o que vender mais e o que cortar: rentabilidade do
// menu (matriz), vendas por família, pedidos em conjunto e artigos sem vendas.

import { useMemo, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  PieChart, Pie, Cell, ScatterChart, Scatter, ReferenceLine, ReferenceArea, CartesianGrid,
} from 'recharts'
import {
  BarChart2, LayoutGrid, Grid2x2, PieChart as LuPieChart, X, Info, Target,
} from 'lucide-react'
import {
  QUADRANT_META,
  itemStats,
  menuMatrix,
  categoryStats,
  combinations,
  neverOrdered,
} from '../../lib/stats'
import { BRAND, euro } from '../../lib/stats-theme'
import { useDict } from '../../lib/i18n'
import { SectionHeader, ItemCards } from '../../components/stats-cards'
import { MatrixTooltip } from './charts'
import { readVar, chartTooltipTheme } from './chart-theme'
import type { StatsShared } from './shared'

type ItemsView = 'matrix' | 'bars' | 'cards'
type CatView = 'donut' | 'bars'
type CatMetric = 'qty' | 'revenue'

export function ProductsTab({ shared }: { shared: StatsShared }) {
  const d = useDict()
  const { filtered, summary, menuItems, categories } = shared

  const [itemsView, setItemsView] = useState<ItemsView>('matrix')
  const [catView, setCatView] = useState<CatView>('donut')
  const [catMetric, setCatMetric] = useState<CatMetric>('qty')
  const [deselectedCats, setDeselectedCats] = useState<Set<string>>(new Set())
  const [selectedItemName, setSelectedItemName] = useState<string | null>(null)

  function toggleCat(id: string) {
    setDeselectedCats(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedCats = useMemo(
    () => new Set(categories.filter(c => !deselectedCats.has(c.id)).map(c => c.id)),
    [categories, deselectedCats],
  )

  //  Agregados deste separador

  const items = useMemo(() => itemStats(filtered), [filtered])
  const topItems = useMemo(() => items.slice(0, 8), [items])
  const matrix = useMemo(() => menuMatrix(items), [items])
  const selectedItem = useMemo(() => {
    if (!selectedItemName) return null
    return matrix.points.find(p => p.name === selectedItemName) || null
  }, [selectedItemName, matrix])
  const cats = useMemo(() => categoryStats(filtered, menuItems, categories), [filtered, menuItems, categories])
  const catTotal = useMemo(() => cats.reduce((s, c) => s + c[catMetric], 0), [cats, catMetric])
  const combos = useMemo(() => combinations(filtered, menuItems, selectedCats), [filtered, menuItems, selectedCats])
  const maxPairCount = combos[0]?.count ?? 1
  // Artigos disponíveis que não saíram no período selecionado.
  const never = useMemo(() => neverOrdered(filtered, menuItems), [filtered, menuItems])

  const maxQty = useMemo(() => {
    const q = Math.max(...matrix.points.map(p => p.qty), 0)
    return q > 0 ? q * 1.15 : 10
  }, [matrix])

  const maxRevenue = useMemo(() => {
    const r = Math.max(...matrix.points.map(p => p.revenue), 0)
    return r > 0 ? r * 1.15 : 100
  }, [matrix])

  const iconSize = 'size-3.5'
  const TTP = chartTooltipTheme()
  const gridColor = readVar('--border', '#27272a')
  const tickColor = readVar('--muted-foreground', '#71717a')
  const axisLabelColor = readVar('--muted-foreground', '#52525b')
  const cursorColor = readVar('--border', '#3f3f46')
  const barCursorFill = 'color-mix(in srgb, var(--muted-foreground) 8%, transparent)'

  return (
    <div className="space-y-6">

      {/*  Chip de contexto*/}
      <div className="flex flex-wrap gap-3">
        <div className="bg-muted/40 border border-border rounded-lg px-4 py-2.5">
          <span className="text-xs text-muted-foreground">{d.stats.productsChip}</span>
          <span className="text-sm font-bold text-foreground">{summary.items}</span>
        </div>
      </div>

      {/*  Rentabilidade do menu*/}
      <div className="bg-card border border-border rounded-lg p-6 shadow-sm hover:shadow-lg transition-all duration-300 animate-slide-up">
        <SectionHeader
          title={d.stats.sections.menuProfitability.title}
          hint={itemsView === 'matrix' ? d.stats.sections.menuProfitability.hint : undefined}
          current={itemsView}
          onChange={v => setItemsView(v as ItemsView)}
          views={[
            { key: 'matrix', icon: <Grid2x2 className={iconSize} />, label: d.stats.sections.menuProfitability.views.matrix },
            { key: 'bars', icon: <BarChart2 className={iconSize} />, label: d.stats.sections.menuProfitability.views.bars },
            { key: 'cards', icon: <LayoutGrid className={iconSize} />, label: d.stats.sections.menuProfitability.views.cards },
          ]}
        />

        {itemsView === 'matrix' && (
          <div className="space-y-6">
            <div className="overflow-x-auto custom-scrollbar -mx-1 px-1">
              <div className="min-w-[500px]">
                <ResponsiveContainer width="100%" height={320}>
                  <ScatterChart margin={{ top: 12, right: 16, bottom: 20, left: 8 }}>
                    <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
                    <XAxis
                      type="number"
                      dataKey="qty"
                      name={d.stats.labels.orders}
                      tick={{ fill: tickColor, fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      label={{ value: d.stats.chart.axisOrdersOut, position: 'bottom', offset: 0, fill: axisLabelColor, fontSize: 10, fontWeight: 500 }}
                    />
                    <YAxis
                      type="number"
                      dataKey="revenue"
                      name={d.stats.labels.sales}
                      tick={{ fill: tickColor, fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      width={48}
                      tickFormatter={v => euro(Number(v))}
                      label={{ value: d.stats.chart.axisSalesAccumulated, angle: -90, position: 'insideLeft', offset: -10, fill: axisLabelColor, fontSize: 10, fontWeight: 500 }}
                    />
                    {/* Áreas dos quadrantes (nomes curtos dentro do gráfico;
                        a explicação completa está na legenda por baixo) */}
                    <ReferenceArea x1={matrix.medianQty} x2={maxQty} y1={matrix.medianRevenue} y2={maxRevenue} fill="var(--brand)" fillOpacity={0.03} label={{ value: d.stats.quadrantChartLabel.estrela, fill: 'var(--brand)', fontSize: 10, position: 'insideTopRight', offset: 10, opacity: 0.5, fontWeight: 'bold' }} />
                    <ReferenceArea x1={matrix.medianQty} x2={maxQty} y1={0} y2={matrix.medianRevenue} fill="#60a5fa" fillOpacity={0.03} label={{ value: d.stats.quadrantChartLabel.popular, fill: '#60a5fa', fontSize: 10, position: 'insideBottomRight', offset: 10, opacity: 0.5, fontWeight: 'bold' }} />
                    <ReferenceArea x1={0} x2={matrix.medianQty} y1={matrix.medianRevenue} y2={maxRevenue} fill="#a78bfa" fillOpacity={0.03} label={{ value: d.stats.quadrantChartLabel.nicho, fill: '#a78bfa', fontSize: 10, position: 'insideTopLeft', offset: 10, opacity: 0.5, fontWeight: 'bold' }} />
                    <ReferenceArea x1={0} x2={matrix.medianQty} y1={0} y2={matrix.medianRevenue} fill="var(--muted-foreground)" fillOpacity={0.03} label={{ value: d.stats.quadrantChartLabel.fraco, fill: 'var(--muted-foreground)', fontSize: 10, position: 'insideBottomLeft', offset: 10, opacity: 0.5, fontWeight: 'bold' }} />

                    <ReferenceLine x={matrix.medianQty} stroke={axisLabelColor} strokeDasharray="3 3" label={{ value: d.stats.chart.medianQty, fill: tickColor, fontSize: 9, position: 'insideBottomLeft', offset: 15 }} />
                    <ReferenceLine y={matrix.medianRevenue} stroke={axisLabelColor} strokeDasharray="3 3" label={{ value: d.stats.chart.medianSales, fill: tickColor, fontSize: 9, position: 'insideLeft', offset: 15 }} />
                    <Tooltip content={<MatrixTooltip />} cursor={{ stroke: cursorColor, strokeDasharray: '3 3' }} />
                    <Scatter data={matrix.points} line={false}>
                      {matrix.points.map((p, i) => (
                        <Cell
                          key={i}
                          fill={QUADRANT_META[p.quadrant].color}
                          fillOpacity={selectedItem && selectedItem.name !== p.name ? 0.3 : 0.9}
                          className="hover:scale-125 transition-all origin-center duration-300 cursor-pointer outline-none"
                          onClick={() => setSelectedItemName(selectedItemName === p.name ? null : p.name)}
                        />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </div>
            {selectedItem && (
              <div className="mt-4 bg-muted/40 border border-border rounded-lg p-5 relative overflow-hidden animate-slide-up group shadow-sm">
                <button
                  onClick={() => setSelectedItemName(null)}
                  className="absolute top-4 right-4 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  <X className="size-4" />
                </button>

                <div className="flex items-start gap-4">
                  <div className="shrink-0 p-3 rounded-lg border" style={{ borderColor: QUADRANT_META[selectedItem.quadrant].color, backgroundColor: `${QUADRANT_META[selectedItem.quadrant].color}15` }}>
                    <Target className="size-6" style={{ color: QUADRANT_META[selectedItem.quadrant].color }} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="text-lg font-black text-foreground truncate">{selectedItem.name}</h4>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-widest border shrink-0" style={{ color: QUADRANT_META[selectedItem.quadrant].color, borderColor: `${QUADRANT_META[selectedItem.quadrant].color}40`, backgroundColor: `${QUADRANT_META[selectedItem.quadrant].color}10` }}>
                        {d.stats.quadrants[selectedItem.quadrant].label}
                      </span>
                    </div>

                    <div className="flex items-center gap-4 text-sm mt-3">
                      <div className="flex flex-col">
                        <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">{d.stats.labels.orders}</span>
                        <span className="font-bold text-foreground">{selectedItem.qty} un</span>
                      </div>
                      <div className="w-px h-6 bg-border" />
                      <div className="flex flex-col">
                        <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">{d.stats.labels.sales}</span>
                        <span className="font-bold text-brand">{euro(selectedItem.revenue)}</span>
                      </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-border text-xs text-muted-foreground">
                      <div className="flex items-start gap-2">
                        <Info className="size-4 text-muted-foreground shrink-0" />
                        <p className="leading-relaxed">
                          <strong>{d.stats.chart.recommendedAction}</strong>
                          {d.stats.quadrants[selectedItem.quadrant].hint}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-4 border-t border-border">
              {(Object.keys(QUADRANT_META) as (keyof typeof QUADRANT_META)[]).map(key => {
                const meta = QUADRANT_META[key]
                return (
                  <div key={key} className="flex items-start gap-2.5 bg-muted/40 p-3 rounded-lg border border-border">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-1" style={{ background: meta.color }} />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-foreground">{d.stats.quadrants[key].label}</p>
                      <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{d.stats.quadrants[key].hint}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {itemsView === 'bars' && (
          <div className="pt-2">
            <ResponsiveContainer width="100%" height={topItems.length * 36 + 16}>
              <BarChart data={topItems} layout="vertical" margin={{ top: 0, right: 32, bottom: 0, left: 0 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={130} tick={{ fill: tickColor, fontSize: 11, fontWeight: 500 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={v => [Number(v), d.stats.labels.orders]} {...TTP} cursor={{ fill: barCursorFill }} />
                <Bar dataKey="qty" fill={BRAND} radius={[0, 6, 6, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {itemsView === 'cards' && <ItemCards items={topItems} />}
      </div>

      {/*  Vendas por família*/}
      <div className="bg-card border border-border rounded-lg p-6 shadow-sm hover:shadow-lg transition-all duration-300 animate-slide-up">
        <SectionHeader
          title={d.stats.sections.categorySales.title}
          hint={d.stats.sections.categorySales.hint}
          current={catView}
          onChange={v => setCatView(v as CatView)}
          views={[
            { key: 'donut', icon: <LuPieChart className={iconSize} />, label: d.stats.sections.categorySales.views.donut },
            { key: 'bars', icon: <BarChart2 className={iconSize} />, label: d.stats.sections.categorySales.views.bars },
          ]}
        />
        {/* Toggle quantidade vs vendas*/}
        <div className="flex gap-1 bg-muted/40 p-1 rounded-lg border border-border w-fit mb-6">
          {(['qty', 'revenue'] as CatMetric[]).map(m => (
            <button
              key={m}
              onClick={() => setCatMetric(m)}
              className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg transition-all duration-200 ${
                catMetric === m ? 'bg-secondary text-secondary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {m === 'qty' ? d.stats.sections.categorySales.metricQty : d.stats.sections.categorySales.metricRevenue}
            </button>
          ))}
        </div>
        {catView === 'donut' ? (
          <div className="flex gap-8 items-center flex-wrap">
            <div className="relative mx-auto sm:mx-0">
              {/* margin 0: sem isto o Recharts aplica 5px de margem e o donut
                  (cx/cy absolutos) sai 5px para a direita/baixo — desalinha o
                  rótulo "Total" do centro e transborda ligeiramente a caixa. */}
              <PieChart width={140} height={140} margin={{ top: 0, right: 0, bottom: 0, left: 0 }} style={{ flexShrink: 0 }}>
                <Pie data={cats} dataKey={catMetric} nameKey="name" cx={70} cy={70} innerRadius={50} outerRadius={70} paddingAngle={3} strokeWidth={0}>
                  {cats.map((cat, i) => <Cell key={i} fill={cat.color} />)}
                </Pie>
                <Tooltip formatter={v => [catMetric === 'revenue' ? euro(Number(v)) : Number(v), catMetric === 'revenue' ? d.stats.labels.sales : d.stats.labels.orders]} {...TTP} />
              </PieChart>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">{d.stats.labels.total}</span>
                <span className="text-sm font-black text-foreground">{catMetric === 'revenue' ? euro(catTotal) : catTotal}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 flex-1 min-w-[200px] content-start">
              {cats.map(cat => (
                <div key={cat.name} className="flex items-center gap-2 bg-muted/40 px-3 py-1.5 rounded-full border border-border">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: cat.color }} />
                  <span className="text-xs font-bold text-foreground/80">{cat.name}</span>
                  <span className="text-xs font-semibold text-muted-foreground pl-1 tabular-nums">
                    {catTotal > 0 ? Math.round((cat[catMetric] / catTotal) * 100) : 0}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="pt-2">
            <ResponsiveContainer width="100%" height={cats.length * 36 + 16}>
              <BarChart data={cats} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={100} tick={{ fill: tickColor, fontSize: 11, fontWeight: 500 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={v => [catMetric === 'revenue' ? euro(Number(v)) : Number(v), catMetric === 'revenue' ? d.stats.labels.sales : d.stats.labels.orders]} {...TTP} cursor={{ fill: barCursorFill }} />
                <Bar dataKey={catMetric} radius={[0, 6, 6, 0]} barSize={14}>
                  {cats.map((cat, i) => <Cell key={i} fill={cat.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/*  Pedidos em conjunto*/}
      <div className="bg-card border border-border rounded-lg p-6 shadow-sm hover:shadow-lg transition-all duration-300 animate-slide-up">
        <SectionHeader title={d.stats.sections.combos.title} hint={d.stats.sections.combos.hint} />

        {categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-6 bg-muted/40 p-1.5 rounded-lg border border-border w-fit">
            {categories.map(cat => {
              const isSelected = selectedCats.has(cat.id)
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => toggleCat(cat.id)}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-all duration-200 font-semibold ${
                    isSelected
                      ? 'bg-secondary border-border text-secondary-foreground shadow-sm scale-[1.02]'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent'
                  }`}
                >
                  {cat.name}
                </button>
              )
            })}
          </div>
        )}

        {combos.length === 0 ? (
          <div className="flex flex-col items-center justify-center border border-dashed border-border rounded-lg p-8 text-center animate-fade-in">
            <p className="text-xs font-semibold text-muted-foreground">
              {selectedCats.size === 0 ? d.stats.sections.combos.emptyNoCategory : d.stats.sections.combos.emptyNoCombos}
            </p>
          </div>
        ) : (
          <div className="space-y-3 pt-2">
            {combos.map((pair, i) => (
              <div key={i} className="flex items-center gap-4 group">
                <span className="text-xs font-bold text-muted-foreground w-5 text-right shrink-0">#{i + 1}</span>
                <div className="flex flex-wrap items-center gap-1.5 w-80 shrink-0 min-w-0">
                  <span className="text-xs font-bold text-foreground/80 truncate group-hover:text-brand transition-colors">{pair.a}</span>
                  <span className="text-muted-foreground shrink-0 text-xs font-bold font-mono">+</span>
                  <span className="text-xs font-bold text-foreground/80 truncate group-hover:text-brand transition-colors">{pair.b}</span>
                </div>
                <div className="flex-1 bg-muted rounded-full h-2 min-w-[100px] border border-border overflow-hidden">
                  <div className="bg-brand h-full transition-all duration-1000 ease-out" style={{ width: `${(pair.count / maxPairCount) * 100}%` }} />
                </div>
                <span className="text-xs font-extrabold text-foreground/80 w-12 text-right shrink-0 tabular-nums bg-muted border border-border px-2 py-1 rounded-lg shadow-inner">
                  {pair.count} ×
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/*  Artigos sem vendas*/}
      {never.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-6 shadow-sm hover:shadow-lg transition-all duration-300 animate-slide-up">
          <SectionHeader title={d.stats.sections.neverOrdered.title} hint={d.stats.sections.neverOrdered.hint} />
          <div className="flex flex-wrap gap-2 pt-1">
            {never.map(item => (
              <span key={item.id} className="text-xs font-medium bg-muted border border-border text-muted-foreground px-3 py-1.5 rounded-lg hover:text-foreground transition-colors">
                {item.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
