// Namespace 'login' do dicionário PT: ecrã de login e primeira instalação
// (first-run-setup partilha este namespace porque é o "outro" ecrã de entrada).

export const login = {
  title: 'Entrar',
  subtitle: 'Aceda à sua área de trabalho.',
  usernameLabel: 'Utilizador',
  passwordLabel: 'Password',
  rememberMe: 'Lembrar sessão',
  submit: 'Entrar',
  submitting: 'A entrar…',
  connectionSettings: 'Definições de ligação',

  errors: {
    fillBothFields: 'Preenche o utilizador e a password.',
    invalidCredentials: 'Utilizador ou password incorretos.',
    tooManyAttempts: 'Muitas tentativas. Espera um momento e tenta outra vez.',
    serverUnreachable: 'Não foi possível ligar ao servidor.',
    generic: 'Não foi possível entrar.',
  },

  // Ecrã de PRIMEIRA INSTALAÇÃO (first-run-setup.tsx).
  setup: {
    title: 'Configurar o restaurante',
    subtitle: 'Primeira utilização: cria a conta de administrador para começar.',
    usernameLabel: 'Utilizador do administrador',
    usernameTooShort: (min: number) => `O utilizador tem de ter pelo menos ${min} caracteres.`,
    usernameTaken: 'Já existe uma conta com esse nome. Escolhe outro utilizador.',
    alreadyConfigured: 'Este restaurante já foi configurado. Atualiza a página para entrar.',
    setupFailed: 'Não foi possível concluir a configuração. Tenta novamente.',
    createFailed: 'Não foi possível criar a conta de administrador.',
    submit: 'Criar administrador',
    submitting: 'A criar…',
    footnote: 'A password fica só neste servidor. Podes mudá-la depois em “A minha conta”.',
  },
}
