// Namespace 'common' do dicionário EN — o tipo espelha o PT.

import type { common as pt } from '../pt/common'

export const common: typeof pt = {
  languageName: 'English',
  languageToggleLabel: 'Mudar para Português',
  cancel: 'Cancel',
  save: 'Save',
  close: 'Close',
  confirm: 'Confirm',
  retry: 'Try again',
  loading: 'Loading…',
  saving: 'Saving…',
  poweredBy: 'Powered by',

  cancelAction: (action: string) => `Cancel ${action}`,

  password: {
    show: 'Show password',
    hide: 'Hide password',
    confirmLabel: 'Confirm password',
    minHint: (min: number) => `At least ${min} characters.`,
    tooShort: (min: number) => `The password must be at least ${min} characters long.`,
    mismatch: 'The passwords do not match.',
  },

  orderStatus: {
    pending: 'Pending',
    preparing: 'Preparing',
    ready: 'Ready',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
  },
  orderStatusNext: {
    pending: 'Start',
    preparing: 'Ready',
    ready: 'Deliver',
  },
  orderStatusPrev: {
    preparing: 'Back to Pending',
    ready: 'Back to Preparing',
    delivered: 'Back to Ready',
  },
  kanbanColumns: {
    pending: 'Pending',
    preparing: 'Preparing',
    ready: 'Ready',
  },
}
