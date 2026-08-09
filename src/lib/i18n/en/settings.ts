// Namespace 'settings' do dicionário EN — o tipo espelha o PT: uma chave a
// faltar aqui é erro de compilação (paridade garantida pelo gate).

import type { settings as pt } from '../pt/settings'

export const settings: typeof pt = {
  betaFeatures: {
    saft: {
      name: 'SAF-T (PT) export',
      limitation:
        'Experimental XML for study only — no signature/Hash, ATCUD or XSD validation. Not valid for submission to the tax authority (AT).',
    },
    notifications: {
      name: 'Staff notifications',
      limitation:
        'Sound, vibration and native alerts work while the app is open. No push (APNs/FCM): nothing arrives with the screen locked or the app closed.',
    },
    offline: {
      name: 'Offline operation',
      limitation:
        'The app warns when the connection drops, but orders and service calls made offline fail — there is no retry queue.',
    },
    userManagement: {
      name: 'User management',
      limitation:
        '"Remove" deactivates the account (reversible); fully deleting the auth account is not yet possible from the app (changing someone else\'s password already is).',
    },
    scheduledBackup: {
      name: 'Daily automatic backup',
      limitation:
        'Automatic scheduling (launchd) is only available on macOS. Manual backup works everywhere.',
    },
    launcherWindowsLinux: {
      name: 'Launcher on Windows/Linux',
      limitation:
        'The one-click launcher is validated on macOS; Windows and Linux support is written but not yet validated on real machines.',
    },
    otaHttps: {
      name: 'OTA updates and staff HTTPS',
      limitation:
        'Functional, but they depend on local infrastructure: publishing a release on the LAN and installing the certificate once per staff device.',
    },
  },

  restaurant: {
    title: 'Settings',
    subtitle: 'Settings that change how the restaurant operates.',
    savedBadge: (modeLabel: string) => `Saved: ${modeLabel}`,
    modeLabels: {
      normal: 'À la carte',
      rodizio: 'All-you-can-eat',
      mixed: 'Mixed',
    },
    serviceType: {
      title: 'Service type',
      description: 'In all-you-can-eat mode, included items appear at €0 for customer and staff.',
      unlock: 'Unlock service type',
      lock: 'Lock service type',
      lockedStatus: 'Locked to prevent accidental changes.',
      unlockedStatus: 'Unlocked.',
      lockedError: 'Unlock the padlock next to it to change the service type.',
    },
    save: 'Save',
    saving: 'Saving...',
    reset: 'Reset',
    loadingSettings: 'Loading settings...',
    unsavedChanges: 'Unsaved changes.',
    resetDone: 'Changes reset.',
    saveDone: 'Settings saved.',
    changedElsewhere: 'There are changes on another device. Reset to see the saved version.',
    loadErrorPrefix: (msg: string) => `Could not read the settings: ${msg}`,
    saveErrorPrefix: (msg: string) => `Could not save: ${msg}`,
    entryPriceRequired: 'Set an entry price greater than 0.',
    vatRangeError: 'Default VAT must be a number between 0 and 100.',
    maxShiftHoursRangeError: 'Maximum shift hours must be a number between 0 and 24.',

    fiscal: {
      title: 'Fiscal details',
      description:
        'Used in the sales reports. Saved with the button above. Note: they do not make the documents fiscally valid — that requires software certified by the tax authority (AT).',
      nameLabel: 'Restaurant name',
      namePlaceholder: 'E.g.: Temple Sushi',
      nifLabel: 'Tax ID (NIF)',
      nifPlaceholder: 'E.g.: 500123456',
      addressLabel: 'Address',
      addressPlaceholder: 'Street, no., postal code, city',
      vatLabel: 'Default VAT (%)',
      vatPlaceholder: '13',
      vatHelp: 'Applied to items without their own rate. Restaurants: 13% food, 23% drinks.',
    },

    timeClock: {
      title: 'Time clock',
      description:
        'If someone forgets to clock out, their shift stays open counting hours. With a maximum set, the shift closes on its own once that time is reached and is marked "clock-out missed" in the shifts panel. Saved with the button above.',
      maxHoursLabel: 'Maximum shift hours',
      maxHoursPlaceholder: '12',
      maxHoursHelp: 'Empty = no auto-close. Maximum 24 hours.',
    },

    rodizio: {
      entryPriceLabel: 'Entry price per person',
      entryPriceHelp: 'Base amount of the bill per person.',
      includedItemsTitle: 'Items included in the all-you-can-eat menu',
      includedItemsSummary: (selected: number, total: number) =>
        `Selected: ${selected}/${total}. These items cost €0 in all-you-can-eat mode.`,
      needsCategories: 'Create categories and items in the menu before configuring the all-you-can-eat menu.',
      categorySelected: (selected: number, total: number) => `${selected}/${total} included`,
      wholeCategory: 'Whole category',
      noItemsInCategory: 'No items in this category.',
      uncategorizedLabel: 'No category',
      normalPrice: (price: string) => `Normal price: ${price}`,
      itemIncluded: 'Item included in the all-you-can-eat menu.',
      itemExcluded: 'Item removed from the all-you-can-eat menu.',
      categoryIncluded: (name: string) => `Category "${name}" included in the all-you-can-eat menu.`,
      categoryExcluded: (name: string) => `Category "${name}" removed from the all-you-can-eat menu.`,
      itemUpdateErrorPrefix: (msg: string) => `Could not update the item: ${msg}`,
      categoryUpdateErrorPrefix: (msg: string) => `Could not update the category: ${msg}`,
    },

    betaSection: {
      title: 'Beta features',
      description: 'These features exist and work, but have known limitations. They are marked with the Beta badge on the screens where they appear.',
    },
  },

  connection: {
    title: 'Connection settings',
    description: 'Set the restaurant server this device connects to. Use this when the app cannot connect automatically.',
    hostLabel: 'Server IP / host',
    hostPlaceholder: '192.168.1.50',
    portLabel: 'Port',
    portPlaceholder: '54321',
    urlLabel: 'Full URL',
    urlPlaceholder: 'http://192.168.1.50:54321',
    useSimple: 'Use IP and port',
    useAdvanced: 'Advanced mode (full URL)',
    invalidUrl: 'Invalid URL. Example: http://192.168.1.50:54321',
    invalidHostPort: 'Check the IP/host and the port (1 to 65535).',
    unreachable: 'Could not connect to that server. Check the IP, the port and the network.',
    submit: 'Test and connect',
    submitting: 'Testing connection...',
    resetToAuto: 'Back to automatic',
  },
}
