// Namespace 'employee' do dicionário EN — o tipo espelha o PT: uma chave a
// faltar aqui é erro de compilação (paridade garantida pelo gate).

import type { employee as pt } from '../pt/employee'

export const employee: typeof pt = {
  title: 'Employee',

  connectionLostAlert:
    'Connection to the server lost — the table map may not be updating. Trying to reconnect…',

  tableLabel: (table) => `Table ${table}`,
  itemsCount: (n) => `${n} ${n === 1 ? 'item' : 'items'}`,
  itemsInCartBadge: (n) => `${n} ${n === 1 ? 'item' : 'items'} in cart`,
  personWord: (n) => (n === 1 ? 'person' : 'people'),
  orderCountLabel: (n) => `${n} ${n === 1 ? 'order' : 'orders'}`,
  invalidSessionError: 'Invalid session. Log in again.',

  // "À la carte" também é o termo corrente em inglês, e "Rodízio" fica
  // igual nos dois idiomas — é o termo de domínio.
  modeOption: {
    alaCarte: 'À la carte',
    rodizio: 'Rodízio',
  },

  tableActions: {
    orderAction: 'Order',
    expiredAction: 'Expired',
    accountAction: 'Bill',
    startAction: 'Start',
    orderForTableAria: (table) => `Order for table ${table}`,
    expiredSessionAria: (table) => `Table ${table} session expired`,
    closeBillAria: (table) => `Close bill for table ${table}`,
    cancelOrderAria: (table) => `Cancel order for table ${table}`,
    cancelOrderTitle: 'Cancel order',
    headcountRequired: 'Enter the number of people (>= 1).',
  },

  map: {
    title: 'Table map',
    newTableButton: 'New table + QR',
    emptyState: 'No active tables. Create a session or generate a permanent QR in the admin area.',
    stateLabel: {
      idle: 'Waiting',
      servida: 'Served',
      pronto: 'Ready to serve',
      aguardar: 'Preparing',
      atrasada_chamada: 'Needs attention',
    },
    accessCodeCreatedAria: 'Code created',
    fixedBadge: 'fixed',
    headcountUnit: (n) => `${n} people`,
    draftCount: (n) => `Draft: ${n} ${n === 1 ? 'item' : 'items'}`,
    tapToStart: 'Tap to start',
    openTableDetailsAria: (table) => `Open details for table ${table}`,
    invalidTableNumber: 'Invalid table number.',
    duplicateTableNumber: 'A table with that number already exists.',
    createSessionError: (message) => `Could not create the session: ${message}`,
    newSessionTitle: 'New table + QR Code',
    newSessionHint:
      'Generate a QR Code for the customer to scan and order at this table. We will then show the code for you to point the camera at.',
    tableNumberLabel: 'Table no.',
    headcountLabel: 'Number of people',
    entryPriceHint: (price) => `Entry fee ${price}/person.`,
    createAndShowQr: 'Create and show QR',
    creating: 'Creating…',
  },

  session: {
    openBadge: 'Open',
    startHint:
      'Start the session so the customer can order through this QR. Once started, the customer creates a 6-digit code to protect the bill.',
    headcountPlaceholder: 'E.g.: 2',
    entryPriceStartHint: (price) => `Entry fee ${price}/person (snapshot on start).`,
    startSession: 'Start session',
    startingSession: 'Starting…',
    startSessionError: (message) => `Could not start the session: ${message}`,
    accountTotal: 'Bill total',
    decreasePersonAria: 'Decrease by one person',
    increasePersonAria: 'Increase by one person',
    editHeadcountAria: 'Edit number of people',
    editHeadcountCurrentAria: (n) => `Edit number of people, currently ${n}`,
    headcountUpdateError: 'Error',
    headcountMinError: 'Minimum 1 person',
    accessCodeCreated: 'Customer already created the code',
    accessCodeWaiting: 'Waiting for the customer to create the code',
    resetCode: 'Reset code',
    resettingCode: 'Resetting…',
    resetCodeError: (message) => `Could not reset the code: ${message}`,
    ordersInAccount: 'Orders on the bill',
    noOrdersYet: 'No orders yet.',
  },

  history: {
    toggleLabel: 'Table history',
    emptyTitle: 'No orders',
    emptyDescription: 'This table has not had any orders yet.',
    currentAccount: 'Current bill',
    previousAccounts: 'Previous bills',
  },

  bill: {
    modalTitle: (table) => `Close bill — Table ${table}`,
    totalToPay: 'Total to pay',
    confirmingOrders: 'Confirming bill orders…',
    composition: 'Bill breakdown',
    entryRodizio: 'Rodízio entry fee',
    extrasAndOrders: 'Extras and orders',
    total: 'Total',
    ordersIncluded: 'Orders included',
    noPaidOrders: 'No billable orders on this bill.',
    orderWithStatus: (status) => `Order ${status}`,
    subtotalDiscountLine: (subtotal, discount) => `Subtotal ${subtotal} · discount ${discount}`,
    unfinishedTitle: 'There are unfinished orders',
    unfinishedDescription: 'Deliver or cancel these orders before closing the bill.',
    notInShiftTitle: 'You are not clocked in',
    notInShiftDescription: 'To close bills you need to clock in — the payment gets linked to your shift.',
    punchInNow: 'Clock in now',
    punchingIn: 'Clocking in…',
    paymentMethod: 'Payment method',
    confirmAndClose: 'Confirm and close',
    closing: 'Closing…',
    unfinishedOrdersError: 'There are still unfinished orders. Deliver or cancel them before closing the bill.',
    notInShiftError: 'You are not clocked in. Clock in to be able to close the bill.',
    ordersConfirmError: (message) => `Could not confirm the bill orders: ${message}`,
    paymentDoneCloseFailedError: (detail) =>
      `Payment recorded (it will not be charged again), but the bill has not been closed yet: ${detail}. Tap "Confirm and close" to try again.`,
    closeFailedError: (detail) => `Could not close the bill: ${detail}`,
    punchInFailedError: 'Could not clock in.',
  },

  order: {
    panelTitle: (table) => `Order for table ${table}`,
    panelHint: 'This menu is linked only to this table’s draft.',
    closeOrder: 'Close order',
    emptyTitleWithTable: (table) => `Table ${table} has no active order`,
    emptyTitleNoTable: 'Choose a table to order',
    emptyHintWithTable:
      'This table no longer has an open session to receive orders. Open a new session on the map before continuing.',
    emptyHintNoTable:
      'Tap Order on an open table’s card. The cart stays saved as that table’s draft until you send or clear the items.',
    noOpenSessionError: 'This table has no open session to receive orders.',
    offShiftError: 'You are off shift. Clock in on the time clock bar to send orders.',
    emptyCartError: 'The cart is empty',
    noTableSelectedError: 'First choose an open table on the map. Orders must be linked to a sessionId.',
    sessionExpiredError: 'The table session expired meanwhile. Open a new session on the map.',
    discountPercentTooHighError: 'The % discount cannot be higher than 100',
    discountEurosTooHighError: 'The € discount cannot be higher than the order total',
    offlineError: 'No internet connection. Check the Wi-Fi and try again.',
    invalidCartSuffix: (message) => `${message} Fix the cart before sending.`,
    networkSendError: 'Could not send the order: no connection to the server. Try again once the Wi-Fi is back.',
    sendErrorWithMessage: (message) => `Could not send the order. Fix the cart before trying again: ${message}`,
    sentSuccess: 'Order sent to the kitchen',
  },

  discount: {
    globalLabel: 'Global discount',
    percentAria: 'Use global discount as a percentage',
    eurosAria: 'Use global discount in euros',
  },

  cart: {
    title: (count) => `Cart (${count})`,
    closeAria: 'Close cart',
    notesPlaceholder: 'Notes (optional)',
    viewForTable: (table) => `View order for table ${table}`,
    submit: 'Send order',
    submitting: 'Sending...',
    total: 'Total',
  },

  calls: {
    heading: (count) => `Table calls (${count})`,
    typeLabel: {
      waiter: 'Called the waiter',
      bill: 'Asked for the bill',
    },
    acknowledgedSuffix: ' · Acknowledged',
    acknowledge: 'Acknowledge',
    resolve: 'Resolve',
    updateError: (message) => `Could not update the call: ${message}`,
  },

  menu: {
    searchPlaceholder: 'Search items...',
    searchAria: 'Search menu items',
    allCategories: 'All',
    loadingAria: 'Loading menu…',
    noItemsFound: 'No items found with these filters.',
    included: 'Included',
    soldOut: 'Sold out',
    quantityAria: (name) => `Quantity of ${name}`,
    removeOneAria: (name) => `Remove one unit of ${name}`,
    addOneAria: (name) => `Add one unit of ${name}`,
    addItemAria: (name) => `Add ${name}`,
    add: 'Add',
  },

  notifications: {
    nativeTitle: (table) => `Table ${table}`,
  },
}
