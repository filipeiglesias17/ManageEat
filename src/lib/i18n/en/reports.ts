// Namespace 'reports' do dicionário EN — o tipo espelha o PT: uma chave a
// faltar aqui é erro de compilação (paridade garantida pelo gate).
//
// "Rodízio"/"all-you-can-eat": segue a convenção já usada em admin.ts/
// settings.ts (traduzido), e não a de employee.ts (mantido literal) — os
// relatórios são um documento de back-office, tal como as definições do admin.

import type { reports as pt } from '../pt/reports'

export const reports: typeof pt = {
  meta: {
    exportedBy: 'Exported by',
    role: 'Role',
    dateTime: 'Date/time',
    period: 'Period',
    purpose: 'Purpose',
    establishment: 'Establishment',
    // "NIF" (Portuguese tax ID) is fiscal data — not translated.
    nif: 'NIF',
    fullHistory: 'Full history',
    periodRange: (from: string, to: string) => `${from} to ${to}`,
  },

  roleLabel: {
    admin: 'Administrator',
    gerente: 'Manager',
    empregado: 'Employee',
    cozinha: 'Kitchen',
    cliente: 'Customer',
  },

  paymentMethodLabel: {
    dinheiro: 'Cash',
    cartao: 'Card',
    outro: 'Other',
  },

  legal: {
    // Cuidado ao editar: o rodapé do PDF usa só a 1.ª frase (corta no 1.º
    // ponto) — mantém a 1.ª frase curta e sem abreviaturas com ponto.
    noFiscalNotice:
      'Internal management document, with no fiscal validity. It does not replace an invoice or receipt, which in Portugal must be issued by AT-certified software (with ATCUD, QR Code and digital signature).',
    confidentialRgpd:
      'Confidential document. Contains staff personal data protected under GDPR. Access is restricted to restaurant-management purposes; collect only the data you need and do not share or keep the file beyond what that purpose requires.',
  },

  cover: {
    sheetName: 'Cover',
    fieldColumn: 'Field',
    valueColumn: 'Value',
    noticeLabel: 'Notice',
    confidentialityLabel: 'Confidentiality',
  },

  summary: {
    sheetName: 'Summary',
    indicatorColumn: 'Indicator',
    valueColumn: 'Value',
    deltaColumn: 'vs previous period (%)',
    revenue: 'Total revenue',
    orders: 'No. of orders',
    avgTicket: 'Average ticket',
    items: 'Items sold',
    discount: 'Discounts granted',
    covers: 'People served (all-you-can-eat)',
  },

  dailySales: {
    sheetName: 'Daily sales',
    dayColumn: 'Day',
    revenueColumn: 'Revenue',
    ordersColumn: 'Orders',
    itemsColumn: 'Items',
  },

  categories: {
    sheetName: 'Categories',
    categoryColumn: 'Category',
    qtyColumn: 'Qty',
    revenueColumn: 'Revenue',
  },

  items: {
    sheetName: 'Items',
    itemColumn: 'Item',
    qtyColumn: 'Qty',
    revenueColumn: 'Revenue',
    quadrantColumn: 'Quadrant',
  },

  payments: {
    sheetName: 'Payments',
    methodColumn: 'Method',
    countColumn: 'No.',
    valueColumn: 'Value',
    shareColumn: '% of total',
    totalReceivedLabel: 'Total received',
  },

  vat: {
    sheetName: 'VAT',
    rateColumn: 'Rate',
    baseColumn: 'Taxable base',
    csvBaseColumn: 'Base',
    vatColumn: 'VAT',
    totalColumn: 'Total',
    totalRowLabel: 'Total',
  },

  shifts: {
    sheetName: 'Shifts',
    openedColumn: 'Clock-in',
    closedColumn: 'Clock-out',
    hoursColumn: 'Hours',
    openedByColumn: 'Opened by',
    closedByColumn: 'Closed by',
    paymentsCountColumn: 'No. of payments',
    revenueColumn: 'Revenue',
  },

  rodizio: {
    sheetName: 'All-you-can-eat',
    indicatorColumn: 'Indicator',
    tableColumn: 'Table',
    peopleColumn: 'People',
    revenueColumn: 'Revenue',
    revenuePerPersonLabel: 'Revenue per person',
    topTablesLabel: 'Top tables',
    tableLabel: (n: number) => `Table ${n}`,
  },

  audit: {
    sheetName: 'Audit',
    staffColumn: 'Staff',
    cancellationsColumn: 'Cancellations',
    paymentsColumn: 'Payments',
    valueColumn: 'Registered value',
    csvValueColumn: 'Value',
    voidsColumn: 'Voids',
    shiftsOpenedColumn: 'Shifts opened',
    shiftsClosedColumn: 'Shifts closed',
    hoursColumn: 'Hours',
  },

  pdf: {
    defaultTitle: 'Sales Report',
    issuedAt: 'Issued at',
    deltaColumnShort: 'vs prev.',
    vatSummaryTitle: 'VAT summary',
    categorySalesTitle: 'Sales by category',
    topItemsTitle: 'Top items',
    peopleServedLabel: 'People served',
    shiftsTitle: 'Shifts (time clock)',
    whoColumn: 'Who',
    openShiftLabel: 'Still open',
    paymentsTitle: 'Payment methods',
    noPaymentsRegistered: 'No payments registered',
    cancelDiscountTitle: 'Cancellations & discounts',
    cancelledOrdersLabel: 'Cancelled orders',
    cancelRateLabel: 'Cancellation rate',
    lostValueLabel: 'Value lost',
    footerFiscalNotice:
      'Management document — no fiscal validity. Does not replace an invoice/receipt certified by the Portuguese Tax Authority (AT).',
    pageLabel: (current: number, total: number) => `Page ${current}/${total}`,
  },

  download: {
    reinstallRequired:
      "Reinstall the app to export (this update needs the new native version — an automatic update isn't enough).",
    shareDialogTitle: 'Save or share',
    readFileError: 'Could not read the file to export.',
  },
}
