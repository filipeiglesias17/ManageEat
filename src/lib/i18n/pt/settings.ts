// Namespace 'settings' do dicionário PT. Preenchido à medida que as páginas
// migram as strings para aqui (interpolações = funções).

export const settings = {
  betaFeatures: {
    saft: {
      name: 'Export SAF-T (PT)',
      limitation:
        'XML experimental para estudo — sem assinatura/Hash, ATCUD nem validação XSD. Não serve para entrega à AT.',
    },
    notifications: {
      name: 'Notificações do empregado',
      limitation:
        'Som, vibração e alerta nativo funcionam com a app aberta. Sem push (APNs/FCM): de ecrã bloqueado ou app fechada não chega nada.',
    },
    offline: {
      name: 'Operação offline',
      limitation:
        'A app avisa quando perde a ligação, mas pedidos e chamadas feitos offline falham — não há fila de reenvio.',
    },
    userManagement: {
      name: 'Gestão de utilizadores',
      limitation:
        '"Remover" desativa a conta (reativável); apagar por completo a conta de autenticação ainda não é possível a partir da app (mudar a password de terceiros já é).',
    },
    scheduledBackup: {
      name: 'Backup automático diário',
      limitation:
        'O agendamento automático (launchd) só está disponível em macOS. O backup manual funciona em todo o lado.',
    },
    launcherWindowsLinux: {
      name: 'Launcher em Windows/Linux',
      limitation:
        'O arranque de um clique está validado em macOS; em Windows e Linux está escrito mas por validar em máquina real.',
    },
    otaHttps: {
      name: 'Atualizações OTA e HTTPS do staff',
      limitation:
        'Funcionais, mas dependem de infraestrutura local: publicação de release na LAN e instalação manual do certificado (uma vez por aparelho de staff).',
    },
  },

  // Ecrã "Definições" do admin (src/components/admin-restaurant-settings.tsx):
  // modo do restaurante, dados fiscais, relógio de ponto e itens do rodízio.
  restaurant: {
    title: 'Definições',
    subtitle: 'Definições que mudam o funcionamento do restaurante.',
    savedBadge: (modeLabel: string) => `Guardado: ${modeLabel}`,
    modeLabels: {
      normal: 'À la carte',
      rodizio: 'Rodízio',
      mixed: 'Misto',
    },
    serviceType: {
      title: 'Tipo de serviço',
      description: 'No rodízio, os itens incluídos aparecem a 0 euros para cliente e empregado.',
      unlock: 'Desbloquear tipo de serviço',
      lock: 'Bloquear tipo de serviço',
      lockedStatus: 'Bloqueado para evitar mudanças acidentais.',
      unlockedStatus: 'Desbloqueado.',
      lockedError: 'Desbloqueia o cadeado ao lado para alterar o tipo de serviço.',
    },
    save: 'Guardar',
    saving: 'A guardar...',
    reset: 'Repor',
    loadingSettings: 'A carregar definições...',
    unsavedChanges: 'Alterações por guardar.',
    resetDone: 'Alterações repostas.',
    saveDone: 'Definições guardadas.',
    changedElsewhere: 'Há alterações noutro dispositivo. Repõe para ver a versão guardada.',
    loadErrorPrefix: (msg: string) => `Não foi possível ler as definições: ${msg}`,
    saveErrorPrefix: (msg: string) => `Não foi possível guardar: ${msg}`,
    entryPriceRequired: 'Define um preço de entrada maior que 0.',
    vatRangeError: 'IVA por defeito tem de ser um número entre 0 e 100.',
    maxShiftHoursRangeError: 'Horas máximas de turno têm de ser um número entre 0 e 24.',

    fiscal: {
      title: 'Dados fiscais',
      description:
        'Usados nos relatórios de vendas. Guardados com o botão acima. Nota: não tornam os documentos fiscalmente válidos — isso exige software certificado pela AT.',
      nameLabel: 'Nome do restaurante',
      namePlaceholder: 'Ex: Temple Sushi',
      nifLabel: 'NIF',
      nifPlaceholder: 'Ex: 500123456',
      addressLabel: 'Morada',
      addressPlaceholder: 'Rua, nº, código-postal, localidade',
      vatLabel: 'IVA por defeito (%)',
      vatPlaceholder: '13',
      vatHelp: 'Aplicado a itens sem taxa própria. Restauração: 13% refeições, 23% bebidas.',
    },

    timeClock: {
      title: 'Relógio de ponto',
      description:
        'Quem se esquecer de picar a saída fica com o turno aberto a contar horas. Com um máximo definido, o turno fecha sozinho ao atingir esse tempo e fica marcado "saída não picada" no painel de turnos. Guardado com o botão acima.',
      maxHoursLabel: 'Horas máximas de turno',
      maxHoursPlaceholder: '12',
      maxHoursHelp: 'Vazio = sem auto-fecho. Máximo 24 horas.',
    },

    rodizio: {
      entryPriceLabel: 'Entrada por pessoa',
      entryPriceHelp: 'Valor base da conta por pessoa.',
      includedItemsTitle: 'Itens incluídos no rodízio',
      includedItemsSummary: (selected: number, total: number) =>
        `Selecionados: ${selected}/${total}. Estes itens custam 0 euros no modo rodízio.`,
      needsCategories: 'Cria categorias e itens no menu antes de configurar o rodízio.',
      categorySelected: (selected: number, total: number) => `${selected}/${total} incluídos`,
      wholeCategory: 'Categoria inteira',
      noItemsInCategory: 'Sem itens nesta categoria.',
      // Grupo sintético (não vem da BD) para itens sem categoria atribuída.
      uncategorizedLabel: 'Sem categoria',
      normalPrice: (price: string) => `Preço normal: ${price}`,
      itemIncluded: 'Item incluído no rodízio.',
      itemExcluded: 'Item removido do rodízio.',
      categoryIncluded: (name: string) => `Categoria "${name}" incluída no rodízio.`,
      categoryExcluded: (name: string) => `Categoria "${name}" removida do rodízio.`,
      itemUpdateErrorPrefix: (msg: string) => `Não foi possível atualizar o item: ${msg}`,
      categoryUpdateErrorPrefix: (msg: string) => `Não foi possível atualizar a categoria: ${msg}`,
    },

    betaSection: {
      title: 'Funcionalidades em beta',
      description:
        'Estas funcionalidades existem e funcionam, mas têm limitações conhecidas. Estão assinaladas com o selo Beta nos ecrãs onde aparecem.',
    },
  },

  // Modal "Definições de ligação" (src/components/server-connection-settings.tsx),
  // aberto a partir do Login/first-run-setup em dispositivos nativos (Capacitor).
  connection: {
    title: 'Definições de ligação',
    description: 'Indica o servidor do restaurante a que este dispositivo se liga. Usa isto quando a app não consegue ligar automaticamente.',
    hostLabel: 'IP / host do servidor',
    hostPlaceholder: '192.168.1.50',
    portLabel: 'Porta',
    portPlaceholder: '54321',
    urlLabel: 'URL completo',
    urlPlaceholder: 'http://192.168.1.50:54321',
    useSimple: 'Usar IP e porta',
    useAdvanced: 'Modo avançado (URL completo)',
    invalidUrl: 'URL inválido. Exemplo: http://192.168.1.50:54321',
    invalidHostPort: 'Verifica o IP/host e a porta (1 a 65535).',
    unreachable: 'Não foi possível ligar a esse servidor. Confirma o IP, a porta e a rede.',
    submit: 'Testar e ligar',
    submitting: 'A testar ligação...',
    resetToAuto: 'Voltar ao automático',
  },
}
