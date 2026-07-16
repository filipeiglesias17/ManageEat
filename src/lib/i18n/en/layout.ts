// Namespace 'layout' do dicionário EN — o tipo espelha o PT: uma chave a
// faltar aqui é erro de compilação (paridade garantida pelo gate).

import type { layout as pt } from '../pt/layout'

export const layout: typeof pt = {
  myAccountLabel: 'My account',

  navbar: {
    myAccountShort: 'Account',
    logout: 'Sign out',
  },

  settingsMenu: {
    label: 'Settings',
    signedInAs: (username: string) => `Signed in as ${username}`,
    languageLabel: 'Language',
    themeLabel: 'Theme',
    themeLight: 'Light',
    themeDark: 'Dark',
    changePassword: 'Change password',
  },

  offlineBanner: {
    message:
      'No connection — new orders or service calls will fail until the network comes back (offline mode is in beta, no retry queue).',
  },

  updateBanner: {
    fetchFailed: 'Could not get the update',
    available: 'Update available',
    applyNow: 'Update now',
  },

  shiftStatusBar: {
    onShift: 'On shift',
    sinceTime: (time: string) => `since ${time} ·`,
    timeAgo: (duration: string) => `${duration} ago`,
    offShift: 'Off shift',
    offShiftHint: 'Clock in so the manager can record your start time.',
    punchInButton: 'Clock in',
    punchOutButton: 'Clock out',
    confirmPunchOut: 'Confirm clock out',
    punchInError: 'Could not clock in.',
    punchOutError: 'Could not clock out.',
  },

  // Aviso laranja "fora de turno" (regra D1) por cima do mapa de mesas.
  shiftGateBanner: {
    title: 'Off shift',
    description: 'Clock in on the bar above to open tables, send orders and close bills.',
  },

  logoutShiftModal: {
    title: "You're still on shift",
    body: (time: string) =>
      `You clocked in at ${time} and the shift is still open. If you're leaving, clock out first; if this is just a break or a device swap, you can sign out without closing the shift.`,
    logoutOnly: 'Sign out anyway',
    punchOutAndLogout: 'Clock out and sign out',
    loggingOut: 'Signing out…',
  },

  changePasswordModal: {
    newPasswordLabel: 'New password',
    submit: 'Change password',
    success: "Password changed. You'll use it next time you sign in.",
    samePasswordError: 'The new password must be different from the current one.',
    genericError: 'Could not change the password.',
  },

  errorBoundary: {
    title: 'Something went wrong.',
    description: 'Reload the page to continue.',
    reloadButton: 'Reload',
  },
}
