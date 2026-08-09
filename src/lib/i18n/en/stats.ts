// Namespace 'stats' do dicionário EN — o tipo espelha o PT: uma chave a
// faltar aqui é erro de compilação (paridade garantida pelo gate).
// "Rodízio" mantém-se por extenso nos dois idiomas (termo de domínio).

import type { stats as pt } from '../pt/stats'

export const stats: typeof pt = {
  header: {
    title: 'Analytics',
    subtitle: 'Sales, products and closings for the restaurant',
  },

  tabs: {
    summary: 'Summary',
    sales: 'Sales',
    products: 'Products',
    closings: 'Closings & Shifts',
  },

  presets: {
    today: 'Today',
    '7d': '7 days',
    '30d': '30 days',
    '90d': '90 days',
    all: 'All',
  },

  weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],

  quadrants: {
    estrela: {
      label: 'Stars',
      hint: 'High order volume and high revenue — protect and highlight.',
    },
    popular: {
      label: 'Sell a lot, low revenue',
      hint: 'They sell a lot but earn little — raise the price or suggest add-ons.',
    },
    nicho: {
      label: 'Good revenue, few sales',
      hint: 'They earn well but sell little — give them more visibility on the menu.',
    },
    fraco: {
      label: 'Needs review',
      hint: 'Low sales and low revenue — revise the recipe or remove it from the menu.',
    },
  },

  quadrantChartLabel: {
    estrela: 'Stars',
    popular: 'Sells a lot',
    nicho: 'Earns well',
    fraco: 'Needs review',
  },

  dateRange: {
    from: 'From',
    to: 'To',
    custom: 'Custom',
    daysCount: (days: number) => `${days} days`,
  },

  compare: {
    button: 'Compare',
    vsLastWeek: 'vs last week',
    hintSameWeekday: 'Comparison with the same day last week',
    hintPreviousPeriod: 'Compare with the previous period of equal duration',
    noteSameWeekday: 'Comparison with the same day last week.',
    notePreviousPeriod: 'Comparison with the previous period of equal duration.',
  },

  ordersCount: (count: number) => `${count} order${count !== 1 ? 's' : ''}`,

  loadingLabel: 'Loading analytics',

  emptyPeriod: {
    title: 'No sales in this period',
    description: 'There are no orders recorded in the selected dates. Change the period or record new sales.',
  },

  limitedData: (error?: string) => `Could not load the full period${error ? ` (${error})` : ''}.`,

  export: {
    button: 'Export…',
    busy: 'Exporting…',
    error: (message: string) => `Could not export: ${message}`,
    reportButton: 'Export report (XLSX / PDF / CSV)',
  },

  kpis: {
    revenue: 'Total sales',
    orders: 'Orders',
    avgTicket: 'Average ticket',
    avgTicketSub: 'average per order',
    covers: 'Number of guests',
    coversSub: 'served in rodízio',
    alaCarteLabel: 'À la carte',
    rodizioEntriesLabel: 'Rodízio (entries)',
    rodizioLabel: 'Rodízio',
  },

  labels: {
    tableNumber: 'Table',
    sales: 'Sales',
    orders: 'Orders',
    covers: 'Guests',
    rate: 'Rate',
    base: 'Base',
    vat: 'VAT',
    total: 'Total',
    employee: 'Employee',
    accountsClosed: 'Accounts closed',
    totalCollected: 'Total collected',
    totalReceived: 'Total received',
    who: 'Who',
    checkIn: 'Check-in',
    checkOut: 'Check-out',
    duration: 'Duration',
  },

  tableRowLabel: (tableNumber: number) => `Table ${tableNumber}`,

  sections: {
    highlights: {
      title: 'Highlights',
      hint: 'What stands out in the selected period',
      bestDay: 'Best day',
      peakHour: 'Peak hour',
      topItem: 'Best-selling item',
      dominantSource: 'Dominant source',
    },
    trend: {
      title: 'Sales trend',
      compareHint: 'Dashed line = comparison period',
      views: { revenue: 'Sales', orders: 'Orders' },
    },
    topItems: {
      title: 'Best-selling items',
      empty: 'No item sales in this period.',
      viewAll: 'View all products',
    },
    paymentMethods: {
      title: 'Payment methods',
      hintSales: 'Breakdown of payments recorded when closing accounts (voided ones do not count).',
      empty: 'No payments recorded in this period.',
      viewAll: 'View closings and shifts',
    },
    peakHours: {
      title: 'Peak hours',
      hint: 'Orders by weekday and hour — darker cells mean more activity. Useful for scheduling staff.',
    },
    orderSource: {
      title: 'Order source',
      hint: 'Orders placed by the customer via the table QR vs entered by staff.',
    },
    tableSales: {
      title: 'Sales by table and guest',
      hint: 'Tables with the highest revenue in the period. The number of guests comes from rodízio (counted once per account).',
      coversLabel: 'Number of guests (rodízio): ',
      revenuePerCover: 'Sales per guest: ',
      empty: 'No sales in this period.',
    },
    vat: {
      title: 'VAT by rate',
      hint: 'Prices in Portugal include VAT: the base is calculated from the total. Same VAT breakdown used in exported reports.',
    },
    menuProfitability: {
      title: 'Menu profitability',
      hint: 'Each point is an item: how often it sells (width) vs how much it earns (height).',
      views: { matrix: 'Matrix', bars: 'Bars', cards: 'Cards' },
    },
    categorySales: {
      title: 'Sales by category',
      hint: 'Menu families/categories — where activity is concentrated.',
      views: { donut: 'Donut', bars: 'Bars' },
      metricQty: 'Quantity',
      metricRevenue: 'Sales',
    },
    combos: {
      title: 'Ordered together',
      hint: 'Whoever orders one usually orders the other — good for suggesting add-ons or combos.',
      emptyNoCategory: 'Select at least one category above.',
      emptyNoCombos: 'No combined orders in this period.',
    },
    neverOrdered: {
      title: 'Items with no sales',
      hint: 'Available on the menu but with no sales in the period — candidates for promotion or removal from the menu.',
    },
    dailyClosing: {
      titleDay: 'Day closing',
      titlePeriod: 'Period closing',
      hint: 'Summary in the style of the closing receipt: what came in, by which method, and what was voided.',
      ordersServed: (count: number) => `${count} order${count !== 1 ? 's' : ''} served`,
      voidedNote: 'voided payments do not count',
      cancellationsLabel: 'Cancellations',
      cancellationsBreakdown: (orders: number, payments: number) =>
        `${orders} order${orders !== 1 ? 's' : ''} · ${payments} payment${payments !== 1 ? 's' : ''}`,
    },
    employeeSales: {
      title: 'Sales by employee',
      hint: 'Who closed each account — revenue is linked to whoever collected it (clocked-in shift).',
      empty: 'No accounts closed in this period.',
    },
    shifts: {
      title: 'Shifts',
      hint: 'Clock-ins and clock-outs in the period (the 10 most recent). Full management is in the Shifts area.',
      empty: 'No shifts recorded in this period.',
      open: 'open',
      autoSuffix: '(auto)',
    },
    cancellations: {
      title: 'Cancellations and discounts',
      hint: 'Orders cancelled in the period, revenue lost and discounts granted — internal control at closing time.',
      cancelledOrders: 'Cancelled orders',
      cancelledRate: 'Cancellation rate',
      lostValue: 'Revenue lost',
      discountsGiven: 'Discounts granted',
      topReasons: 'Most common reasons',
    },
  },

  chart: {
    tooltipCurrent: 'Current',
    tooltipPrevious: 'Previous',
    matrixOrdersLabel: (count: number) => `${count} orders`,
    axisOrdersOut: 'Times ordered',
    axisSalesAccumulated: 'Accumulated sales',
    medianQty: 'Qty median',
    medianSales: 'Sales median',
    recommendedAction: 'Recommended action: ',
    heatmapLess: 'Less busy',
    heatmapMore: 'Busier',
    heatmapCellTitle: (dayLabel: string, hour: string, count: number) =>
      `${dayLabel} at ${hour}:00 · ${count} order${count !== 1 ? 's' : ''}`,
    tooWideTitle: 'Range too long',
    tooWideDescription: (days: number) =>
      `The selected period (${days} days) is too long for the daily trend (max. 92 days). Choose a shorter range.`,
  },

  productsChip: 'Items sold in period: ',

  exportModal: {
    title: 'Export analytics',
    subtitle: 'Choose the format, the period, and what to include in the file.',
    formatLegend: 'Format',
    formats: {
      xlsx: 'XLSX (Excel)',
      pdf: 'PDF',
      csv: 'CSV',
      saft: 'SAF-T',
    },
    saftWarningLabel: 'Warning:',
    saftWarningText: 'SAF-T (PT) is experimental. It generates a non-certified XML file, with no fiscal validity — for study purposes only, not for submission to the tax authority.',
    periodLegend: 'Period',
    presetAriaLabel: (label: string) => `Fill in the period: ${label}`,
    noDatesHint: 'With no dates filled in, the file includes the whole history.',
    sectionsLegend: 'Sections to include',
    sections: {
      resumo: 'Summary',
      vendasDia: 'Sales by day',
      categorias: 'Categories',
      itens: 'Items',
      pagamentos: 'Payment methods',
      iva: 'VAT',
      turnos: 'Shifts',
      rodizio: 'Rodízio',
      auditoria: 'Staff audit',
    },
    purposeLabel: 'Purpose (optional)',
    purposePlaceholder: 'E.g.: accounting, internal management',
    purposeHelp: 'Recorded in the file metadata and helps justify data use (GDPR).',
    invalidDateRange: 'The "From" date cannot be after the "To" date.',
    needsSection: 'Choose at least one section to include.',
    submit: 'Export file',
    submitBusy: 'Exporting…',
    legalTitle: 'Legal notice',
  },
}
