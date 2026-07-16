// Namespace 'layout' do dicionário PT: navbar, rodapé, banners globais
// (offline/atualização), barra de ponto, modais partilhados (logout com turno
// aberto, mudar password) e o Error Boundary. Interpolações = funções.

export const layout = {
  // "A minha conta" — usado no botão da navbar (aria-label/title) e no
  // título do modal de mudar password. É o mesmo conceito em dois sítios.
  myAccountLabel: 'A minha conta',

  navbar: {
    // Texto curto ao lado do ícone (o aria-label/title completo é myAccountLabel).
    myAccountShort: 'Conta',
    logout: 'Sair',
  },

  // Menu único "Definições" na navbar: junta idioma, tema e mudar password num
  // só popover (antes eram três botões soltos).
  settingsMenu: {
    label: 'Definições',
    signedInAs: (username: string) => `Sessão de ${username}`,
    languageLabel: 'Idioma',
    themeLabel: 'Tema',
    themeLight: 'Claro',
    themeDark: 'Escuro',
    changePassword: 'Mudar password',
  },

  offlineBanner: {
    message:
      'Sem ligação — novos pedidos ou chamadas de serviço falharão até a rede voltar (operação offline em beta, sem fila de reenvio).',
  },

  updateBanner: {
    fetchFailed: 'Não foi possível obter a atualização',
    available: 'Atualização disponível',
    applyNow: 'Atualizar agora',
  },

  shiftStatusBar: {
    onShift: 'Em turno',
    // Parte "desde HH:MM ·" (só visível em ecrãs largos, ver shift-status-bar.tsx).
    sinceTime: (time: string) => `desde ${time} ·`,
    // Parte "há X min/h" (sempre visível — é o cronómetro ao vivo).
    timeAgo: (duration: string) => `há ${duration}`,
    offShift: 'Fora de turno',
    offShiftHint: 'Pica o ponto para o chefe registar a que horas entraste.',
    punchInButton: 'Picar entrada',
    punchOutButton: 'Picar saída',
    confirmPunchOut: 'Confirmar saída',
    punchInError: 'Não foi possível picar a entrada.',
    punchOutError: 'Não foi possível picar a saída.',
  },

  // Aviso laranja "fora de turno" (regra D1) por cima do mapa de mesas.
  shiftGateBanner: {
    title: 'Fora de turno',
    description: 'Pica a entrada na barra acima para abrir mesas, enviar pedidos e fechar contas.',
  },

  logoutShiftModal: {
    title: 'Ainda estás em turno',
    body: (time: string) =>
      `Picaste a entrada às ${time} e o turno continua aberto. Se vais embora, pica a saída; se é só uma pausa ou uma troca de aparelho, podes sair sem fechar o turno.`,
    logoutOnly: 'Sair na mesma',
    punchOutAndLogout: 'Picar saída e sair',
    loggingOut: 'A sair…',
  },

  changePasswordModal: {
    newPasswordLabel: 'Nova password',
    submit: 'Mudar password',
    success: 'Password alterada. Vais usá-la no próximo início de sessão.',
    samePasswordError: 'A nova password tem de ser diferente da atual.',
    genericError: 'Não foi possível mudar a password.',
  },

  errorBoundary: {
    title: 'Ocorreu um erro inesperado.',
    description: 'Recarregue a página para continuar.',
    reloadButton: 'Recarregar',
  },
}
