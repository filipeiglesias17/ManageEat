// Separador "Fechos & Turnos" — o dia/turno fechou bem?
// É a camada operacional que os POS portugueses têm (apuramento de dia,
// fecho de sessão) e que faltava à página: fecho do período à imagem do
// talão, vendas por empregado, turnos e anulações — tudo com os dados que
// já existiam (payments + shifts + cancelamentos).

import { useEffect, useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PAYMENT_METHOD_LABEL } from '../../@types/payment'
import type { AppProfile } from '../../@types/user'
import {
  cancellationStats,
  paymentStats,
  paymentEntryRevenue,
} from '../../lib/stats'
import { getProfiles } from '../../lib/db'
import { formatDateTime, formatDuration } from '../../lib/helpers'
import { euro } from '../../lib/stats-theme'
import { useDict } from '../../lib/i18n'
import { SectionHeader } from '../../components/stats-cards'
import type { StatsShared } from './shared'

export function ClosingsTab({ shared }: { shared: StatsShared }) {
  const d = useDict()
  const { filtered, periodPayments, shifts, summary, rangeDays, onExport } = shared

  // Nomes de quem fechou contas/turnos. Perfis mudam raramente — busca única.
  const [profiles, setProfiles] = useState<AppProfile[]>([])
  useEffect(() => {
    let active = true
    getProfiles()
      .then(p => { if (active) setProfiles(p) })
      .catch(() => { /* sem nomes: as linhas mostram o id encurtado */ })
    return () => { active = false }
  }, [])

  const nameOf = useMemo(() => {
    const map = new Map(profiles.map(p => [p.uid, p.username]))
    return (id: string | null | undefined) => (id ? map.get(id) ?? id.slice(0, 8) : '—')
  }, [profiles])

  // ── Agregados deste separador ────────────────────────────────────

  const validPayments = useMemo(() => periodPayments.filter(p => !p.voidedAt), [periodPayments])
  const voidedPayments = useMemo(() => periodPayments.filter(p => p.voidedAt), [periodPayments])
  const paymentBreakdown = useMemo(() => paymentStats(periodPayments), [periodPayments])
  const paymentsTotal = useMemo(() => paymentBreakdown.reduce((s, p) => s + p.amount, 0), [paymentBreakdown])
  const cancellations = useMemo(() => cancellationStats(filtered), [filtered])

  // Split rodízio (entradas) vs à la carte, derivado dos pagamentos.
  const entryRevenue = useMemo(
    () => validPayments.reduce((s, p) => s + paymentEntryRevenue(p), 0),
    [validPayments],
  )
  const itemsRevenue = Math.max(summary.revenue - entryRevenue, 0)

  // Vendas por empregado: agrupa os pagamentos válidos por quem cobrou.
  const byEmployee = useMemo(() => {
    const map = new Map<string, { accounts: number; amount: number }>()
    for (const p of validPayments) {
      const entry = map.get(p.createdBy) ?? { accounts: 0, amount: 0 }
      entry.accounts += 1
      entry.amount += p.amount
      map.set(p.createdBy, entry)
    }
    return [...map.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.amount - a.amount)
  }, [validPayments])

  // Turnos do período, mais recentes primeiro (mostramos os últimos 10).
  const recentShifts = useMemo(
    () => [...shifts].sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1)).slice(0, 10),
    [shifts],
  )

  const closingTitle = rangeDays === 1 ? d.stats.sections.dailyClosing.titleDay : d.stats.sections.dailyClosing.titlePeriod

  return (
    <div className="space-y-6">

      {/* ── Fecho do dia/período — o talão de fecho no ecrã ── */}
      <div className="bg-card border border-border rounded-lg p-6 shadow-sm animate-slide-up">
        <SectionHeader
          title={closingTitle}
          hint={d.stats.sections.dailyClosing.hint}
        />
        <div className="grid grid-cols-1 min-[380px]:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
          <div className="bg-muted/40 border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground">{d.stats.kpis.revenue}</p>
            <p className="text-xl sm:text-2xl font-black text-brand mt-1">{euro(summary.revenue)}</p>
            {entryRevenue > 0 && (
              <p className="text-[11px] text-muted-foreground mt-1">
                {d.stats.kpis.alaCarteLabel} {euro(itemsRevenue)} · {d.stats.kpis.rodizioLabel} {euro(entryRevenue)}
              </p>
            )}
          </div>
          <div className="bg-muted/40 border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground">{d.stats.labels.accountsClosed}</p>
            <p className="text-xl sm:text-2xl font-black text-foreground mt-1">{validPayments.length}</p>
            <p className="text-[11px] text-muted-foreground mt-1">{d.stats.sections.dailyClosing.ordersServed(summary.orders)}</p>
          </div>
          <div className="bg-muted/40 border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground">{d.stats.labels.totalReceived}</p>
            <p className="text-xl sm:text-2xl font-black text-foreground mt-1">{euro(paymentsTotal)}</p>
            <p className="text-[11px] text-muted-foreground mt-1">{d.stats.sections.dailyClosing.voidedNote}</p>
          </div>
          <div className="bg-muted/40 border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground">{d.stats.sections.dailyClosing.cancellationsLabel}</p>
            <p className="text-xl sm:text-2xl font-black text-foreground mt-1">
              {cancellations.cancelled + voidedPayments.length}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {d.stats.sections.dailyClosing.cancellationsBreakdown(cancellations.cancelled, voidedPayments.length)}
            </p>
          </div>
        </div>

        {/* Por meio de pagamento, como no talão */}
        {paymentsTotal > 0 && (
          <div className="mt-4 pt-4 border-t border-border space-y-1.5">
            {paymentBreakdown.map(p => (
              <div key={p.method} className="flex items-center justify-between text-sm">
                <span className="text-foreground/80">{PAYMENT_METHOD_LABEL[p.method]}</span>
                <span className="text-muted-foreground tabular-nums">{p.count} · {euro(p.amount)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 pt-4 border-t border-border">
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download className="size-3.5" />
            <span>{d.stats.export.reportButton}</span>
          </Button>
        </div>
      </div>

      {/* ── Vendas por empregado ── */}
      <div className="bg-card border border-border rounded-lg p-6 shadow-sm animate-slide-up">
        <SectionHeader title={d.stats.sections.employeeSales.title} hint={d.stats.sections.employeeSales.hint} />
        {byEmployee.length === 0 ? (
          <p className="text-sm text-muted-foreground pt-1">{d.stats.sections.employeeSales.empty}</p>
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-sm min-w-[420px]">
              <thead>
                <tr className="text-left text-muted-foreground text-xs uppercase tracking-wider">
                  <th className="py-2 pr-4 font-semibold">{d.stats.labels.employee}</th>
                  <th className="py-2 pr-4 font-semibold">{d.stats.labels.accountsClosed}</th>
                  <th className="py-2 font-semibold">{d.stats.labels.totalCollected}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {byEmployee.map(e => (
                  <tr key={e.id} className="text-foreground/80">
                    <td className="py-2 pr-4 font-semibold text-foreground">{nameOf(e.id)}</td>
                    <td className="py-2 pr-4 tabular-nums text-muted-foreground">{e.accounts}</td>
                    <td className="py-2 tabular-nums">{euro(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Turnos do período ── */}
      <div className="bg-card border border-border rounded-lg p-6 shadow-sm animate-slide-up">
        <SectionHeader title={d.stats.sections.shifts.title} hint={d.stats.sections.shifts.hint} />
        {recentShifts.length === 0 ? (
          <p className="text-sm text-muted-foreground pt-1">{d.stats.sections.shifts.empty}</p>
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left text-muted-foreground text-xs uppercase tracking-wider">
                  <th className="py-2 pr-4 font-semibold">{d.stats.labels.who}</th>
                  <th className="py-2 pr-4 font-semibold">{d.stats.labels.checkIn}</th>
                  <th className="py-2 pr-4 font-semibold">{d.stats.labels.checkOut}</th>
                  <th className="py-2 font-semibold">{d.stats.labels.duration}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recentShifts.map(s => {
                  const openedMs = new Date(s.openedAt).getTime()
                  const closedMs = s.closedAt ? new Date(s.closedAt).getTime() : null
                  return (
                    <tr key={s.id} className="text-foreground/80">
                      <td className="py-2 pr-4 font-semibold text-foreground">{nameOf(s.openedBy)}</td>
                      <td className="py-2 pr-4 tabular-nums text-muted-foreground">{formatDateTime(s.openedAt)}</td>
                      <td className="py-2 pr-4 tabular-nums text-muted-foreground">
                        {s.closedAt ? formatDateTime(s.closedAt) : <span className="text-brand font-semibold">{d.stats.sections.shifts.open}</span>}
                        {s.autoClosed && <span className="text-[10px] text-amber-600 dark:text-amber-400 ml-1.5">{d.stats.sections.shifts.autoSuffix}</span>}
                      </td>
                      <td className="py-2 tabular-nums text-muted-foreground">
                        {closedMs ? formatDuration(closedMs - openedMs) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Anulações e descontos ── */}
      <div className="bg-card border border-border rounded-lg p-6 shadow-sm animate-slide-up">
        <SectionHeader title={d.stats.sections.cancellations.title} hint={d.stats.sections.cancellations.hint} />
        <div className="grid grid-cols-1 min-[380px]:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
          <div className="bg-muted/40 border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground">{d.stats.sections.cancellations.cancelledOrders}</p>
            <p className="text-xl sm:text-2xl font-black text-foreground mt-1">{cancellations.cancelled}<span className="text-sm font-medium text-muted-foreground"> / {cancellations.total}</span></p>
          </div>
          <div className="bg-muted/40 border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground">{d.stats.sections.cancellations.cancelledRate}</p>
            <p className="text-xl sm:text-2xl font-black text-foreground mt-1">{cancellations.rate.toFixed(1)}%</p>
          </div>
          <div className="bg-muted/40 border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground">{d.stats.sections.cancellations.lostValue}</p>
            <p className="text-xl sm:text-2xl font-black text-red-600 dark:text-red-400 mt-1">{euro(cancellations.lostValue)}</p>
          </div>
          <div className="bg-muted/40 border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground">{d.stats.sections.cancellations.discountsGiven}</p>
            <p className="text-xl sm:text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">{euro(summary.discount)}</p>
          </div>
        </div>
        {cancellations.reasons.length > 0 && (
          <div className="pt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Motivos mais frequentes</p>
            <div className="space-y-1.5">
              {cancellations.reasons.slice(0, 5).map(r => (
                <div key={r.reason} className="flex items-center justify-between text-sm">
                  <span className="text-foreground/80 truncate pr-3">{r.reason}</span>
                  <span className="text-muted-foreground tabular-nums shrink-0">{r.count}×</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
