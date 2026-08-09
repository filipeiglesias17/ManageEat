// Análises  shell da página: período global, separadores e exportação.
//
// Reorganizada em 4 separadores por pergunta de negócio, à imagem dos POS
// portugueses (Zone Soft, WinREST, XD, Vendus): abre no "hoje" sem configurar
// nada, e o detalhe vive em Resumo / Vendas / Produtos / Fechos & Turnos.
// Os cálculos continuam todos em src/lib/stats.ts; os dados vêm COMPLETOS do
// intervalo via use-stats-data (fix do teto de 200 das subscrições realtime).

import { useMemo, useState } from 'react'
import { Download, CalendarDays, ChevronDown, TrendingUp, Inbox, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import type { Order } from '../../@types/order'
import type { MenuItem } from '../../@types/menu-item'
import type { Category } from '../../@types/category'
import type { Payment } from '../../@types/payment'
import { useDict, getLocale } from '../../lib/i18n'
import {
  type Preset,
  presetRange,
  previousRange,
  filterByRange,
  daysBetween,
  isoToday,
  summarize,
  pctDelta,
  dailySeries,
  totalCovers,
  filterPaymentsByRange,
  ordersWithoutVoidedOnlyPayments,
} from '../../lib/stats'
import {
  getRestaurantSettings,
  getProfiles,
  getOrdersInRange,
  getPaymentsInRange,
  getShiftsInRange,
} from '../../lib/db'
import { buildSalesWorkbook } from '../../lib/report-xlsx'
import { buildSalesReportPdf } from '../../lib/report-pdf'
import { buildCsvFiles } from '../../lib/report-csv'
import { downloadSaftXml } from '../../lib/saft'
import { downloadFiles, textToBlob } from '../../lib/export-download'
import { buildExportMeta } from '../../lib/export-meta'
import { useAuth } from '../../lib/auth-context'
import { OrdersLimitNotice } from '../../components/orders-limit-notice'
import { ExportModal, type ExportOptions } from '../../components/export-modal'
import { useStatsData } from './use-stats-data'
import { SummaryTab } from './summary-tab'
import { SalesTab } from './sales-tab'
import { ProductsTab } from './products-tab'
import { ClosingsTab } from './closings-tab'
import type { StatsShared, TabKey } from './shared'

// Soma um nº de dias a um ISO (YYYY-MM-DD). T12:00 evita saltos de fuso.
function shiftIso(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

interface Props {
  orders: Order[]
  payments: Payment[]
  menuItems: MenuItem[]
  categories: Category[]
}

export function AdminStats({ orders, payments, menuItems, categories }: Props) {
  const d = useDict()

  // Quem exporta  vai para os metadados RGPD do ficheiro.
  const { profile } = useAuth()

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'summary', label: d.stats.tabs.summary },
    { key: 'sales', label: d.stats.tabs.sales },
    { key: 'products', label: d.stats.tabs.products },
    { key: 'closings', label: d.stats.tabs.closings },
  ]

  // Intervalo de datas  controla todos os separadores. Abre no "hoje", como
  // os POS portugueses (o dono quer saber primeiro como está o dia).
  const [fromDate, setFromDate] = useState<string>(() => isoToday())
  const [toDate, setToDate] = useState<string>(() => isoToday())
  const [activePreset, setActivePreset] = useState<Preset | null>('today')
  const [showCustom, setShowCustom] = useState(false)
  const [compare, setCompare] = useState(true)
  const [tab, setTab] = useState<TabKey>('summary')

  // Exportação de relatórios.
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [showExportModal, setShowExportModal] = useState(false)

  //  Dados completos do intervalo (fix do teto de 200)
  const data = useStatsData(fromDate, toDate, orders, payments)

  //  Handlers do intervalo

  function applyPreset(p: Preset) {
    setActivePreset(p)
    setShowCustom(false)
    const range = presetRange(p)
    if (range) {
      setFromDate(range.from)
      setToDate(range.to)
    } else {
      setFromDate('')
      setToDate('')
    }
  }

  function openCustom() {
    if (activePreset !== null) {
      setActivePreset(null)
      setShowCustom(true)
    } else {
      setShowCustom(v => !v)
    }
  }

  function handleFromChange(val: string) {
    setFromDate(val)
    if (val && toDate && val > toDate) setToDate(val)
  }

  function handleToChange(val: string) {
    setToDate(val)
    if (val && fromDate && val < fromDate) setFromDate(val)
  }

  //  Período atual e anterior

  const hasRange = Boolean(fromDate && toDate)
  const rangeDays = hasRange ? daysBetween(fromDate, toDate) : null

  const rawFiltered = useMemo(() => filterByRange(data.orders, fromDate, toDate), [data.orders, fromDate, toDate])
  const periodPayments = useMemo(
    () => filterPaymentsByRange(data.payments, fromDate, toDate),
    [data.payments, fromDate, toDate],
  )
  const filtered = useMemo(
    () => ordersWithoutVoidedOnlyPayments(rawFiltered, periodPayments),
    [rawFiltered, periodPayments],
  )
  const summary = useMemo(() => summarize(filtered, periodPayments), [filtered, periodPayments])

  // Comparação só faz sentido com um intervalo fechado (não em "Tudo").
  const compareActive = compare && hasRange

  // Num único dia comparamos com o MESMO dia da semana anterior (comparar
  // terça com segunda engana  padrão dos POS/dashboards de restauração);
  // em períodos maiores, com o período imediatamente anterior de igual duração.
  const homologous = compareActive && rangeDays === 1
  const prev = useMemo(() => {
    if (!compareActive) return null
    if (rangeDays === 1) return { from: shiftIso(fromDate, -7), to: shiftIso(toDate, -7) }
    return previousRange(fromDate, toDate)
  }, [compareActive, rangeDays, fromDate, toDate])

  // Nota honesta: o período anterior é calculado sobre as listas realtime
  // (limitadas a 200). Para deltas é aproximação aceitável em períodos curtos;
  // o período ATUAL  os números grandes  vem sempre completo do hook.
  const prevPayments = useMemo(
    () => (prev ? filterPaymentsByRange(payments, prev.from, prev.to) : []),
    [payments, prev],
  )
  const prevFiltered = useMemo(() => {
    if (!prev) return []
    return ordersWithoutVoidedOnlyPayments(filterByRange(orders, prev.from, prev.to), prevPayments)
  }, [orders, prev, prevPayments])
  const prevSummary = useMemo(() => summarize(prevFiltered, prevPayments), [prevFiltered, prevPayments])

  //  Séries diárias (atual + anterior)

  const curSeries = useMemo(() => dailySeries(filtered, fromDate, toDate), [filtered, fromDate, toDate])
  const prevSeries = useMemo(
    () => (prev ? dailySeries(prevFiltered, prev.from, prev.to) : []),
    [prevFiltered, prev],
  )

  //  Deltas dos KPIs

  const covers = useMemo(() => totalCovers(filtered), [filtered])
  const prevCovers = useMemo(() => totalCovers(prevFiltered), [prevFiltered])

  const deltas = compareActive ? {
    revenue: pctDelta(summary.revenue, prevSummary.revenue),
    orders: pctDelta(summary.orders, prevSummary.orders),
    avgTicket: pctDelta(summary.avgTicket, prevSummary.avgTicket),
    items: pctDelta(summary.items, prevSummary.items),
    covers: pctDelta(covers, prevCovers),
  } : { revenue: null, orders: null, avgTicket: null, items: null, covers: null }

  // Label do botão "Personalizado". Depende de d.stats.dateRange.custom para
  // recalcular quando o idioma muda (getLocale() lê o idioma ativo).
  const customButtonLabel = useMemo(() => {
    if (activePreset !== null) return d.stats.dateRange.custom
    const fmt = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString(getLocale(), { day: 'numeric', month: 'short' })
    if (!fromDate && !toDate) return d.stats.dateRange.custom
    if (fromDate === toDate) return fmt(fromDate)
    return `${fromDate ? fmt(fromDate) : '…'} – ${toDate ? fmt(toDate) : '…'}`
  }, [activePreset, fromDate, toDate, d.stats.dateRange.custom])

  //  Exportação

  // Gera o ficheiro no formato escolhido no modal. IMPORTANTE: busca os dados
  // COMPLETOS do período via getOrdersInRange/getPaymentsInRange/getShiftsInRange
  //  o modal tem o seu próprio intervalo, que pode diferir do da página.
  async function handleExport(opts: ExportOptions) {
    setExporting(true)
    setExportError('')
    try {
      const settings = await getRestaurantSettings()
      const profiles = await getProfiles()
      const exportOrders = await getOrdersInRange(opts.from, opts.to)
      const exportPayments = await getPaymentsInRange(opts.from, opts.to)
      const shifts = await getShiftsInRange(opts.from, opts.to)

      // Parâmetros comuns aos formatos por dataset (XLSX e CSV).
      const common = {
        settings,
        profile,
        orders: exportOrders,
        payments: exportPayments,
        shifts,
        menuItems,
        categories,
        profiles,
        from: opts.from,
        to: opts.to,
        purpose: opts.purpose,
        sections: opts.sections,
      }

      if (opts.format === 'xlsx') {
        await buildSalesWorkbook(common)
      } else if (opts.format === 'pdf') {
        await buildSalesReportPdf({
          settings,
          orders: exportOrders,
          payments: exportPayments,
          menuItems,
          categories,
          from: opts.from,
          to: opts.to,
          profile,
          shifts,
          profiles,
          purpose: opts.purpose,
        })
      } else if (opts.format === 'csv') {
        const files = buildCsvFiles(common)
        await downloadFiles(
          files.map(f => ({ blob: textToBlob(f.text, 'text/csv;charset=utf-8;', true), filename: f.filename })),
        )
      } else {
        // SAF-T (PT) experimental  XML não certificado, só base de estudo.
        const meta = buildExportMeta(profile, settings, opts.from, opts.to, opts.purpose)
        await downloadSaftXml({
          settings,
          orders: exportOrders,
          payments: exportPayments,
          menuItems,
          from: opts.from,
          to: opts.to,
          meta,
        })
      }

      setShowExportModal(false)
    } catch (err) {
      setExportError(d.stats.export.error(err instanceof Error ? err.message : String(err)))
    } finally {
      setExporting(false)
    }
  }

  // Pacote de dados partilhado pelos separadores.
  const shared: StatsShared = {
    filtered,
    periodPayments,
    shifts: data.shifts,
    prevFiltered,
    prevPayments,
    summary,
    prevSummary,
    deltas,
    covers,
    compareActive,
    homologous,
    curSeries,
    prevSeries,
    fromDate,
    toDate,
    rangeDays,
    menuItems,
    categories,
    onNavigate: setTab,
    onExport: () => setShowExportModal(true),
  }

  //  Render

  return (
    <div className="space-y-6 animate-fade-in pb-8">

      {/*  Cabeçalho*/}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground">{d.stats.header.title}</h1>
          <p className="text-xs text-muted-foreground mt-1">{d.stats.header.subtitle}</p>
        </div>
        <div className="flex flex-col items-stretch sm:items-end gap-1.5">
          <Button onClick={() => setShowExportModal(true)} disabled={exporting}>
            <Download className="size-4" />
            <span>{exporting ? d.stats.export.busy : d.stats.export.button}</span>
          </Button>
          {/* O erro também aparece dentro do modal; mostramo-lo aqui caso o
              modal já tenha fechado quando algo correu mal. */}
          {exportError && !showExportModal && (
            <span className="text-xs text-destructive" role="alert">{exportError}</span>
          )}
        </div>
      </div>

      {showExportModal && (
        <ExportModal
          defaultFrom={fromDate}
          defaultTo={toDate}
          busy={exporting}
          error={exportError}
          onExport={handleExport}
          onClose={() => setShowExportModal(false)}
        />
      )}

      {/*  Filtro de período*/}
      <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1 bg-muted/40 p-1 rounded-lg border border-border shadow-inner">
            {(['today', '7d', '30d', '90d', 'all'] as Preset[]).map(p => {
              const isActive = activePreset === p
              return (
                <Button
                  key={p}
                  variant="ghost"
                  size="sm"
                  onClick={() => applyPreset(p)}
                  className={isActive
                    ? 'bg-brand/15 text-brand shadow-sm hover:bg-brand/15 hover:text-brand'
                    : 'text-muted-foreground'}
                >
                  {d.stats.presets[p]}
                </Button>
              )
            })}
          </div>

          {/* variant ghost + borda manual: o outline traz overrides dark: de
              fundo que esconderiam o realce bg-brand/15 do estado ativo. */}
          <Button
            variant="ghost"
            size="sm"
            onClick={openCustom}
            className={`border ${
              activePreset === null
                ? 'border-brand/20 bg-brand/15 text-brand shadow-sm hover:bg-brand/15 hover:text-brand'
                : 'border-border text-muted-foreground'
            }`}
          >
            <CalendarDays className="size-3.5 shrink-0" />
            <span>{customButtonLabel}</span>
            <ChevronDown className={`size-3 shrink-0 transition-transform duration-250 ${showCustom ? 'rotate-180' : ''}`} />
          </Button>

          {/* Comparar com período anterior (homólogo quando é um só dia)*/}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCompare(v => !v)}
            disabled={!hasRange}
            className={`border ${
              compareActive
                ? 'border-brand/20 bg-brand/10 text-brand hover:bg-brand/15 hover:text-brand'
                : 'border-border text-muted-foreground'
            }`}
            title={homologous
              ? d.stats.compare.hintSameWeekday
              : d.stats.compare.hintPreviousPeriod}
          >
            <TrendingUp className="size-3.5 shrink-0" />
            <span>{homologous ? d.stats.compare.vsLastWeek : d.stats.compare.button}</span>
          </Button>

          <span className="ml-auto text-xs text-muted-foreground font-medium tabular-nums pr-1">
            {d.stats.ordersCount(filtered.length)}
          </span>
        </div>

        {showCustom && (
          <div className="flex flex-wrap items-end gap-4 mt-4 pt-4 border-t border-border animate-fade-in">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">{d.stats.dateRange.from}</label>
              <input
                type="date"
                value={fromDate}
                max={toDate || isoToday()}
                onChange={e => handleFromChange(e.target.value)}
                className="bg-background border border-input rounded-lg px-3 py-2 text-base sm:text-xs text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-colors w-full sm:w-40"
              />
            </div>
            <span className="text-muted-foreground pb-2.5 text-xs">—</span>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">{d.stats.dateRange.to}</label>
              <input
                type="date"
                value={toDate}
                min={fromDate || undefined}
                max={isoToday()}
                onChange={e => handleToChange(e.target.value)}
                className="bg-background border border-input rounded-lg px-3 py-2 text-base sm:text-xs text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-colors w-full sm:w-40"
              />
            </div>
            {rangeDays !== null && (
              <span className="text-xs text-muted-foreground pb-2.5 font-medium">
                {rangeDays === 1
                  ? new Date(fromDate + 'T12:00:00').toLocaleDateString(getLocale(), { weekday: 'long', day: 'numeric', month: 'long' })
                  : d.stats.dateRange.daysCount(rangeDays)}
              </span>
            )}
          </div>
        )}
      </div>

      {/*  Aviso de dados truncados (fallback quando a busca completa falha)*/}
      {data.limited && (
        <div className="space-y-2">
          <OrdersLimitNotice count={filtered.length} />
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{d.stats.limitedData(data.error ?? undefined)}</span>
            <Button variant="outline" size="sm" onClick={data.refetch}>
              <RefreshCw className="size-3" />
              <span>{d.common.retry}</span>
            </Button>
          </div>
        </div>
      )}

      {/*  Separadores*/}
      <div className="flex flex-wrap gap-1 bg-muted/40 p-1 rounded-lg border border-border shadow-inner w-fit" role="tablist">
        {TABS.map(t => {
          const isActive = tab === t.key
          return (
            <Button
              key={t.key}
              role="tab"
              aria-selected={isActive}
              variant="ghost"
              size="sm"
              onClick={() => setTab(t.key)}
              className={isActive
                ? 'bg-card text-foreground shadow-sm hover:bg-card border border-border font-bold'
                : 'text-muted-foreground'}
            >
              {t.label}
            </Button>
          )
        })}
      </div>

      {/*  Conteúdo do separador ativo*/}
      {data.loading ? (
        <div className="space-y-6" aria-busy="true" aria-label={d.stats.loadingLabel}>
          <div className="grid grid-cols-1 min-[380px]:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28 rounded-lg" />)}
          </div>
          <Skeleton className="h-64 rounded-lg" />
          <Skeleton className="h-40 rounded-lg" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Inbox className="size-8" />}
          title={d.stats.emptyPeriod.title}
          description={d.stats.emptyPeriod.description}
        />
      ) : (
        <>
          {tab === 'summary' && <SummaryTab shared={shared} />}
          {tab === 'sales' && <SalesTab shared={shared} />}
          {tab === 'products' && <ProductsTab shared={shared} />}
          {tab === 'closings' && <ClosingsTab shared={shared} />}
        </>
      )}
    </div>
  )
}
