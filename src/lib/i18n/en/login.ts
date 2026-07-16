// Namespace 'login' do dicionário EN — o tipo espelha o PT: uma chave a
// faltar aqui é erro de compilação (paridade garantida pelo gate).

import type { login as pt } from '../pt/login'

export const login: typeof pt = {
  title: 'Sign in',
  subtitle: 'Access your workspace.',
  usernameLabel: 'Username',
  passwordLabel: 'Password',
  rememberMe: 'Remember me',
  submit: 'Sign in',
  submitting: 'Signing in…',
  connectionSettings: 'Connection settings',

  errors: {
    fillBothFields: 'Enter your username and password.',
    invalidCredentials: 'Incorrect username or password.',
    tooManyAttempts: 'Too many attempts. Wait a moment and try again.',
    serverUnreachable: 'Could not reach the server.',
    generic: 'Could not sign in.',
  },

  setup: {
    title: 'Set up the restaurant',
    subtitle: 'First run: create the administrator account to get started.',
    usernameLabel: 'Administrator username',
    usernameTooShort: (min: number) => `The username must be at least ${min} characters long.`,
    usernameTaken: 'An account with that name already exists. Choose another username.',
    alreadyConfigured: 'This restaurant has already been set up. Refresh the page to sign in.',
    setupFailed: 'Could not complete the setup. Please try again.',
    createFailed: 'Could not create the administrator account.',
    submit: 'Create administrator',
    submitting: 'Creating…',
    footnote: 'The password is stored on this server only. You can change it later in “My account”.',
  },
}
