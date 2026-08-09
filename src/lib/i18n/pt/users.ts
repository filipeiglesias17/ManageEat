// Namespace 'users' do dicionário PT: aba "Utilizadores" do admin
// (src/components/admin/users-tab.tsx) — a gestão de contas de staff/cliente.

export const users = {
  title: 'Utilizadores',
  createButton: 'Criar Utilizador',

  // Nome de cada role, tal como aparece nos badges e no <select>.
  roleLabel: {
    gerente: 'Gerente',
    empregado: 'Empregado',
    cliente: 'Cliente',
    cozinha: 'Cozinha',
  },

  tableLabel: (n: number) => `Mesa ${n}`,
  status: {
    active: 'Ativo',
    inactive: 'Inativo',
  },

  empty: {
    title: 'Nenhum utilizador criado',
    description: 'Cria a primeira conta com o botão acima.',
  },

  columns: {
    user: 'Utilizador',
    role: 'Role',
    status: 'Estado',
    actions: 'Ações',
  },

  actions: {
    edit: 'Editar',
    editOf: (username: string) => `Editar ${username}`,
    deactivate: 'Desativar',
    deactivateOf: (username: string) => `Desativar ${username}`,
    deactivateConfirmTitle: (username: string) => `Desativar ${username}? A conta deixa de conseguir entrar.`,
    reactivate: 'Reativar',
    reactivateOf: (username: string) => `Reativar ${username}`,
    setPassword: 'Mudar password',
    setPasswordOf: (username: string) => `Mudar a password de ${username}`,
  },

  setPasswordModal: {
    title: (username: string) => `Mudar password — ${username}`,
    description: 'Define uma nova password para esta conta. A pessoa passa a entrar com ela de imediato.',
    newPasswordLabel: 'Nova password',
    submit: 'Guardar password',
    submitting: 'A guardar...',
    success: (username: string) => `Password de ${username} atualizada.`,
    errorPrefix: (msg: string) => `Não foi possível mudar a password: ${msg}`,
  },

  errors: {
    deactivateFailedPrefix: (msg: string) => `Não foi possível desativar o utilizador: ${msg}`,
    reactivateFailedPrefix: (msg: string) => `Não foi possível reativar o utilizador: ${msg}`,
    usernameTooShort: 'Mínimo 2 caracteres no utilizador',
    passwordTooShort: 'Password com mínimo 12 caracteres',
    usernameTaken: 'Esse nome de utilizador já existe',
    usernameTakenInactive: 'Já existe um utilizador desativado com esse nome — reativa-o na lista em vez de criar outro',
    tableNumberRequired: 'Indica a mesa desta conta cliente (inteiro ≥ 1)',
    weakPassword: 'Password demasiado fraca',
  },

  // Nota fixa dos dois modais (criar/editar): a conta de cliente fica presa a
  // uma mesa (tablet fixo), diferente do fluxo QR (que não tem conta própria).
  tableHelp: 'A conta fica fixa nesta mesa (tablet na mesa). Os pedidos dela são sempre para esta mesa.',

  createModal: {
    title: 'Novo Utilizador',
    usernameLabel: 'Utilizador',
    passwordLabel: 'Password',
    roleLabel: 'Role',
    tableLabel: 'Mesa',
    footnote: 'Nomes de utilizadores desativados não podem ser reutilizados. Para repor o acesso, reativa o utilizador na lista.',
    submit: 'Criar',
    submitting: 'A criar...',
    errorPrefix: (msg: string) => `Não foi possível criar: ${msg}`,
  },

  editModal: {
    title: 'Editar Utilizador',
    usernameLabel: 'Utilizador',
    passwordNote: 'A password é gerida pelo próprio utilizador. Para a forçar, desativa este utilizador e cria outro.',
    roleLabel: 'Role',
    tableLabel: 'Mesa',
    submit: 'Guardar',
    submitting: 'A guardar...',
    errorPrefix: (msg: string) => `Não foi possível guardar: ${msg}`,
  },
}
