// Namespace 'customer' do dicionário EN — o tipo espelha o PT: uma chave a
// faltar aqui é erro de compilação (paridade garantida pelo gate).
//
// "Rodízio" mantém-se igual nos dois idiomas — é o termo do domínio (ver
// employee.ts). "Incluído" → "Included" e "conta" → "bill", como no resto
// da app (employee.bill.*).

import type { customer as pt } from '../pt/customer'

export const customer: typeof pt = {
  loadingSession: 'Loading session…',
  connectionLost: {
    title: 'No connection to the server',
    description: 'Trying to reconnect automatically. Check the table’s Wi-Fi.',
  },
  sessionExpired: {
    title: 'Session expired or invalid',
    description: 'Ask the waiter for a new QR code.',
  },
  waiting: {
    title: 'Waiting for the session to start',
    tablePrefix: (table) => `Table ${table}. `,
    description: 'The waiter will open your table in a moment — this page updates itself.',
  },

  tableWord: 'Table',

  menuTitle: 'Menu',
  ordersStaleNotice: 'The order list may be out of date. Trying to refresh…',

  accessCode: {
    tableSuffix: (table) => ` (Table ${table})`,
    invalidLength: (length) => `Use exactly ${length} digits.`,
    create: {
      title: (length) => `Create a ${length}-digit code`,
      descriptionPrefix: 'Keep your session secure',
      descriptionSuffix: '. Only someone who knows the code can use this QR to order.',
      ariaLabel: (length) => `Create the ${length}-digit code`,
      submit: 'Create code',
      submitting: 'Creating…',
    },
    enter: {
      title: 'Enter the code',
      descriptionPrefix: 'This table',
      descriptionSuffix: (length) => ` is protected by a ${length}-digit code.`,
      ariaLabel: (length) => `Enter the ${length}-digit code`,
      locked: 'Code temporarily locked. Ask the waiter for help.',
      submit: 'Enter',
      submitting: 'Entering…',
    },
    errors: {
      tooManyAttempts: 'Too many attempts. Ask the waiter for help or try again in a few minutes.',
      incorrect: 'Incorrect code.',
      generic: 'Could not validate the code. Ask the waiter for help.',
    },
  },

  callWaiterButton: 'Call waiter',
  callingWaiterButton: 'Calling…',
  requestBillButton: 'Request bill',
  waiterCalledSuccess: 'The waiter has been notified!',
  billRequestedSuccess: 'Bill request sent!',
  serviceCallError: (message) => `Could not send the request: ${message}`,

  rodizio: {
    badge: 'Rodízio Active',
    entryLine: (entryPriceLabel, headcount) =>
      `Entry ${entryPriceLabel} × ${headcount} ${headcount === 1 ? 'person' : 'people'} = `,
    includedNoticePrefix: 'Items marked as ',
    includedWord: 'Included',
    includedNoticeSuffix: ' are free; everything else is added to the bill.',
    extraSpent: 'Extra spending',
    accountTotal: 'Bill total',
    subtotalEntry: 'Entry subtotal',
  },

  account: {
    title: 'Current Bill',
    description: 'Below you can track your table’s accumulated spending.',
    alreadyOrdered: 'Already ordered',
    inCart: 'In cart',
    estimatedTotal: 'Estimated total',
  },

  cart: {
    openAria: 'Open cart',
    itemsCount: (count) => `${count} ${count === 1 ? 'item' : 'items'}`,
    viewOrder: 'View order',
    modalTitle: 'Your Order',
    closeAria: 'Close cart',
    empty: 'You have no items in your cart.',
    total: 'Total',
    submitButton: 'Order',
    submitting: 'Sending…',
  },

  successModal: {
    title: 'Order Received!',
    messagePrefix: 'Your order for ',
    messageSuffix: ' has been sent to the kitchen and is being prepared.',
    backButton: 'Back to Menu',
  },

  errors: {
    cartEmpty: 'The cart is empty',
    invalidSession: 'Invalid session',
    codeRequiredBeforeOrder: 'Enter the table code before ordering.',
    offline: 'No internet connection. Check the table’s Wi-Fi and try again.',
    sessionClosed: 'The session has been closed. Ask the waiter to reopen it.',
    fixCartMessage: (message) => `${message} Fix the cart before sending.`,
    networkSendFailed: 'Could not send the order: no connection to the server. Try again once the Wi-Fi is back.',
    sendFailedGeneric: (message) => `Could not send the order. Fix the cart before trying again: ${message}`,
  },

  dashboard: {
    title: 'Customer',
    cartBadge: (count) => `${count} ${count === 1 ? 'item' : 'items'} in cart`,
    noTableAssigned: 'This account doesn’t have a table assigned yet. Ask the admin to set the table.',
    searchingSession: 'Looking for an open session for the table…',
    sessionSearchError: (message) => `Could not look up the session: ${message}`,
    tableNotOpen: (table) => `Table ${table} is not open yet. Ask the waiter to open the table on the map.`,
    cartSectionTitle: 'Your Cart',
    tableNotOpenForOrder: 'The table doesn’t have an open session yet. Ask the waiter to open the table.',
    rodizioMissingConfig: 'The rodízio session doesn’t have a valid entry fee and headcount yet.',
    orderSentSuccess: 'Your order has been sent to the kitchen!',
  },
}
