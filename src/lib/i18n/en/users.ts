// Namespace 'users' do dicionário EN — o tipo espelha o PT: uma chave a
// faltar aqui é erro de compilação (paridade garantida pelo gate).

import type { users as pt } from '../pt/users'

export const users: typeof pt = {
  title: 'Users',
  createButton: 'Create user',

  roleLabel: {
    gerente: 'Manager',
    empregado: 'Waiter',
    cliente: 'Customer',
    cozinha: 'Kitchen',
  },

  tableLabel: (n: number) => `Table ${n}`,
  status: {
    active: 'Active',
    inactive: 'Inactive',
  },

  empty: {
    title: 'No users yet',
    description: 'Create the first account with the button above.',
  },

  columns: {
    user: 'User',
    role: 'Role',
    status: 'Status',
    actions: 'Actions',
  },

  actions: {
    edit: 'Edit',
    editOf: (username: string) => `Edit ${username}`,
    deactivate: 'Deactivate',
    deactivateOf: (username: string) => `Deactivate ${username}`,
    deactivateConfirmTitle: (username: string) => `Deactivate ${username}? The account will no longer be able to log in.`,
    reactivate: 'Reactivate',
    reactivateOf: (username: string) => `Reactivate ${username}`,
    setPassword: 'Change password',
    setPasswordOf: (username: string) => `Change ${username}'s password`,
  },

  setPasswordModal: {
    title: (username: string) => `Change password — ${username}`,
    description: 'Set a new password for this account. The person can log in with it right away.',
    newPasswordLabel: 'New password',
    submit: 'Save password',
    submitting: 'Saving...',
    success: (username: string) => `${username}'s password updated.`,
    errorPrefix: (msg: string) => `Could not change the password: ${msg}`,
  },

  errors: {
    deactivateFailedPrefix: (msg: string) => `Could not deactivate the user: ${msg}`,
    reactivateFailedPrefix: (msg: string) => `Could not reactivate the user: ${msg}`,
    usernameTooShort: 'Minimum 2 characters for the username',
    passwordTooShort: 'Password must have at least 12 characters',
    usernameTaken: 'That username already exists',
    usernameTakenInactive: 'A deactivated user with that name already exists — reactivate it in the list instead of creating another one',
    tableNumberRequired: 'Enter the table for this customer account (integer ≥ 1)',
    weakPassword: 'Password too weak',
  },

  tableHelp: 'The account stays fixed to this table (tablet on the table). Its orders always go to this table.',

  createModal: {
    title: 'New user',
    usernameLabel: 'Username',
    passwordLabel: 'Password',
    roleLabel: 'Role',
    tableLabel: 'Table',
    footnote: 'Deactivated usernames cannot be reused. To restore access, reactivate the user in the list.',
    submit: 'Create',
    submitting: 'Creating...',
    errorPrefix: (msg: string) => `Could not create: ${msg}`,
  },

  editModal: {
    title: 'Edit user',
    usernameLabel: 'Username',
    passwordNote: 'The password is managed by the user themselves. To force it, deactivate this user and create another one.',
    roleLabel: 'Role',
    tableLabel: 'Table',
    submit: 'Save',
    submitting: 'Saving...',
    errorPrefix: (msg: string) => `Could not save: ${msg}`,
  },
}
