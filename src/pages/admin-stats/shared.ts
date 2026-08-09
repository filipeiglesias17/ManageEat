// Tipos partilhados entre o shell das Análises (index.tsx) e os separadores.

import type { Order } from '../../@types/order'
import type { Payment } from '../../@types/payment'
import type { Shift } from '../../@types/shift'
import type { MenuItem } from '../../@types/menu-item'
import type { Category } from '../../@types/category'
import type { DayPoint, summarize } from '../../lib/stats'

export type TabKey = 'summary' | 'sales' | 'products' | 'closings'

export type KpiDeltas = {
  revenue: number | null
  orders: number | null
  avgTicket: number | null
  items: number | null
  covers: number | null
}

// Dados base do período, calculados uma vez no shell e lidos pelos separadores.
// Cada separador deriva os seus próprios agregados (itemStats, heatmap, …) via
// useMemo — assim só se paga o cálculo do separador que está aberto.
export type StatsShared = {
  filtered: Order[]
  periodPayments: Payment[]
  shifts: Shift[]
  prevFiltered: Order[]
  prevPayments: Payment[]
  summary: ReturnType<typeof summarize>
  prevSummary: ReturnType<typeof summarize>
  deltas: KpiDeltas
  covers: number
  compareActive: boolean
  // true quando a comparação é homóloga (mesmo dia da semana passada).
  homologous: boolean
  curSeries: DayPoint[]
  prevSeries: DayPoint[]
  fromDate: string
  toDate: string
  rangeDays: number | null
  menuItems: MenuItem[]
  categories: Category[]
  onNavigate: (tab: TabKey) => void
  onExport: () => void
}
