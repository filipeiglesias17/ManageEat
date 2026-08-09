// Namespace 'employee' do dicionário PT: dashboard do empregado (mapa de
// mesas, painel da sessão, pedido/carrinho, fecho de conta, chamadas de mesa,
// menu do empregado) e a notificação nativa (lib/notifications.ts).
// Interpolações = funções.

export const employee = {
  title: 'Empregado',

  // Aviso de ligação perdida no topo do dashboard — o mapa de mesas pode
  // não estar a atualizar em tempo real.
  connectionLostAlert:
    'Ligação ao servidor perdida — o mapa de mesas pode não estar a atualizar. A tentar reconectar…',

  // Etiquetas partilhadas por vários ecrãs (mapa, painel da sessão, conta).
  tableLabel: (table: number) => `Mesa ${table}`,
  itemsCount: (n: number) => `${n} ${n === 1 ? 'item' : 'itens'}`,
  itemsInCartBadge: (n: number) => `${n} ${n === 1 ? 'item' : 'itens'} no carrinho`,
  // Só a palavra (o número já aparece à parte no ecrã, ex: no stepper de pessoas).
  // Retorno anotado como string para o espelho EN poder devolver 'person'/'people'
  // (senão o tipo estreitaria a 'pessoa'|'pessoas' e o EN não casaria).
  personWord: (n: number): string => (n === 1 ? 'pessoa' : 'pessoas'),
  orderCountLabel: (n: number) => `${n} ${n === 1 ? 'pedido' : 'pedidos'}`,
  // Guarda partilhada por table-map.tsx e close-bill-modal.tsx antes de agir
  // sobre `profile` — nunca deve aparecer na prática (o Guard já protege a rota).
  invalidSessionError: 'Sessão inválida. Volta a entrar.',

  // Opções de modo partilhadas pelo mapa de mesas e pelo painel da sessão.
  // "Rodízio" mantém-se igual nos dois idiomas — é o termo do domínio.
  modeOption: {
    alaCarte: 'À la carte',
    rodizio: 'Rodízio',
  },

  // Ações por mesa partilhadas entre o cartão do mapa e o painel da sessão.
  tableActions: {
    orderAction: 'Pedir',
    expiredAction: 'Expirada',
    accountAction: 'Conta',
    startAction: 'Iniciar',
    orderForTableAria: (table: number) => `Pedir para a mesa ${table}`,
    expiredSessionAria: (table: number) => `Sessão da mesa ${table} expirada`,
    closeBillAria: (table: number) => `Fechar conta da mesa ${table}`,
    cancelOrderAria: (table: number) => `Cancelar pedido da mesa ${table}`,
    cancelOrderTitle: 'Cancelar pedido',
    headcountRequired: 'Indica o nº de pessoas (>= 1).',
  },

  // ── Mapa de mesas (table-map.tsx) ──
  map: {
    title: 'Mapa de mesas',
    newTableButton: 'Nova mesa + QR',
    emptyState: 'Nenhuma mesa ativa. Cria uma sessão ou gera um QR permanente no admin.',
    stateLabel: {
      idle: 'À espera',
      servida: 'Servida',
      pronto: 'Pronto p/ servir',
      aguardar: 'A preparar',
      atrasada_chamada: 'Precisa atenção',
    },
    accessCodeCreatedAria: 'Código criado',
    fixedBadge: 'fixa',
    headcountUnit: (n: number) => `${n} px`,
    draftCount: (n: number) => `Rascunho: ${n} ${n === 1 ? 'item' : 'itens'}`,
    tapToStart: 'Toque para iniciar',
    openTableDetailsAria: (table: number) => `Abrir detalhes da mesa ${table}`,
    invalidTableNumber: 'Nº de mesa inválido.',
    duplicateTableNumber: 'Já existe uma mesa com esse número.',
    createSessionError: (message: string) => `Não foi possível criar a sessão: ${message}`,
    newSessionTitle: 'Nova mesa + QR Code',
    newSessionHint:
      'Gera um QR Code para o cliente fazer scan e pedir nesta mesa. A seguir mostramos o código para apontares a câmara.',
    tableNumberLabel: 'Nº da mesa',
    headcountLabel: 'Nº de pessoas',
    entryPriceHint: (price: string) => `Entrada ${price}/pessoa.`,
    createAndShowQr: 'Criar e mostrar QR',
    creating: 'A criar…',
  },

  // ── Painel de gestão da mesa (table-session-panel.tsx) ──
  session: {
    openBadge: 'Aberta',
    startHint:
      'Inicia a sessão para o cliente poder pedir por este QR. Depois de iniciada, o cliente cria um código de 6 dígitos para proteger a conta.',
    headcountPlaceholder: 'Ex: 2',
    entryPriceStartHint: (price: string) => `Entrada ${price}/pessoa (snapshot ao iniciar).`,
    startSession: 'Iniciar sessão',
    startingSession: 'A iniciar…',
    startSessionError: (message: string) => `Não foi possível iniciar a sessão: ${message}`,
    accountTotal: 'Total da conta',
    decreasePersonAria: 'Diminuir uma pessoa',
    increasePersonAria: 'Aumentar uma pessoa',
    editHeadcountAria: 'Editar número de pessoas',
    editHeadcountCurrentAria: (n: number) => `Editar número de pessoas, atualmente ${n}`,
    headcountUpdateError: 'Erro',
    headcountMinError: 'Mínimo 1 pessoa',
    accessCodeCreated: 'Cliente já criou o código',
    accessCodeWaiting: 'À espera de o cliente criar o código',
    resetCode: 'Redefinir código',
    resettingCode: 'A redefinir…',
    resetCodeError: (message: string) => `Não foi possível redefinir o código: ${message}`,
    ordersInAccount: 'Pedidos na conta',
    noOrdersYet: 'Sem pedidos ainda.',
  },

  // ── Histórico da mesa, recolhido por defeito (table-history.tsx) ──
  history: {
    toggleLabel: 'Histórico da mesa',
    emptyTitle: 'Sem pedidos',
    emptyDescription: 'Esta mesa ainda não teve pedidos.',
    currentAccount: 'Conta atual',
    previousAccounts: 'Contas anteriores',
  },

  // ── Fecho de conta (close-bill-modal.tsx) ──
  bill: {
    modalTitle: (table: number) => `Fechar conta — Mesa ${table}`,
    totalToPay: 'Total a pagar',
    confirmingOrders: 'A confirmar pedidos da conta…',
    composition: 'Composição da conta',
    entryRodizio: 'Entrada rodízio',
    extrasAndOrders: 'Extras e pedidos',
    total: 'Total',
    ordersIncluded: 'Pedidos incluídos',
    noPaidOrders: 'Sem pedidos pagos nesta conta.',
    // "status" já vem traduzido de order-status-ui.ts — aqui só juntamos o prefixo.
    orderWithStatus: (status: string) => `Pedido ${status}`,
    subtotalDiscountLine: (subtotal: string, discount: string) => `Subtotal ${subtotal} · desconto ${discount}`,
    unfinishedTitle: 'Há pedidos por concluir',
    unfinishedDescription: 'Entrega estes pedidos ou cancela-os aqui antes de fechar a conta.',
    notInShiftTitle: 'Não estás em turno',
    notInShiftDescription: 'Para fechar contas é preciso picar a entrada — o pagamento fica associado ao teu turno.',
    punchInNow: 'Picar entrada agora',
    punchingIn: 'A picar entrada…',
    paymentMethod: 'Meio de pagamento',
    confirmAndClose: 'Confirmar e encerrar',
    closing: 'A fechar…',
    unfinishedOrdersError:
      'Ainda existem pedidos por concluir. Entrega ou cancela esses pedidos antes de fechar a conta.',
    notInShiftError: 'Não estás em turno. Pica a entrada para poderes fechar a conta.',
    ordersConfirmError: (message: string) => `Não foi possível confirmar os pedidos da conta: ${message}`,
    paymentDoneCloseFailedError: (detail: string) =>
      `Pagamento registado (não será cobrado outra vez), mas a conta ainda não foi encerrada: ${detail}. Carrega em «Confirmar e encerrar» para tentar de novo.`,
    closeFailedError: (detail: string) => `Não foi possível fechar a conta: ${detail}`,
    punchInFailedError: 'Não foi possível picar a entrada.',
  },

  // ── Fluxo de pedido do empregado (employee-dashboard.tsx) ──
  order: {
    panelTitle: (table: number) => `Pedido para a mesa ${table}`,
    panelHint: 'Este menu está ligado só ao rascunho desta mesa.',
    closeOrder: 'Fechar pedido',
    emptyTitleWithTable: (table: number) => `Mesa ${table} sem pedido ativo`,
    emptyTitleNoTable: 'Escolhe uma mesa para pedir',
    emptyHintWithTable:
      'Esta mesa já não tem uma sessão aberta para receber pedidos. Abre uma nova sessão no mapa antes de continuar.',
    emptyHintNoTable:
      'Carrega em Pedir no card de uma mesa aberta. O carrinho fica guardado como rascunho dessa mesa até enviares ou limpares os itens.',
    noOpenSessionError: 'Esta mesa não tem uma sessão aberta para receber pedidos.',
    offShiftError: 'Fora de turno. Pica a entrada na barra do ponto para enviares pedidos.',
    emptyCartError: 'O carrinho está vazio',
    noTableSelectedError: 'Escolhe primeiro uma mesa aberta no mapa. Os pedidos têm de ficar ligados a um sessionId.',
    sessionExpiredError: 'A sessão da mesa expirou entretanto. Abre uma nova sessão no mapa.',
    discountPercentTooHighError: 'O desconto em % não pode ser superior a 100',
    discountEurosTooHighError: 'O desconto em € não pode ser maior que o total do pedido',
    offlineError: 'Sem ligação à internet. Verifica o Wi-Fi e tenta outra vez.',
    // "message" vem da validação local do carrinho (use-cart.ts), já em português.
    invalidCartSuffix: (message: string) => `${message} Corrige o carrinho antes de enviar.`,
    networkSendError:
      'Não foi possível enviar o pedido: sem ligação ao servidor. Tenta outra vez quando o Wi-Fi voltar.',
    sendErrorWithMessage: (message: string) =>
      `Não foi possível enviar o pedido. Corrige o carrinho antes de tentar outra vez: ${message}`,
    sentSuccess: 'Pedido enviado para a cozinha',
  },

  discount: {
    globalLabel: 'Desconto Global',
    percentAria: 'Usar desconto global em percentagem',
    eurosAria: 'Usar desconto global em euros',
  },

  cart: {
    title: (count: number) => `Carrinho (${count})`,
    closeAria: 'Fechar carrinho',
    notesPlaceholder: 'Notas (opcional)',
    viewForTable: (table: number) => `Ver pedido da mesa ${table}`,
    submit: 'Enviar pedido',
    submitting: 'A enviar...',
    total: 'Total',
  },

  // ── Chamadas de mesa (service-calls-panel.tsx) ──
  calls: {
    heading: (count: number) => `Chamadas de mesa (${count})`,
    typeLabel: {
      waiter: 'Chamou o empregado',
      bill: 'Pediu a conta',
    },
    acknowledgedSuffix: ' · Assumida',
    acknowledge: 'Assumir',
    resolve: 'Resolver',
    updateError: (message: string) => `Não foi possível atualizar a chamada: ${message}`,
  },

  // ── Menu do empregado (menu-browser.tsx) ──
  menu: {
    searchPlaceholder: 'Pesquisar itens...',
    searchAria: 'Pesquisar itens do menu',
    allCategories: 'Tudo',
    loadingAria: 'A carregar menu…',
    noItemsFound: 'Nenhum item encontrado com estes filtros.',
    included: 'Incluído',
    soldOut: 'Esgotado',
    quantityAria: (name: string) => `Quantidade de ${name}`,
    removeOneAria: (name: string) => `Tirar uma unidade de ${name}`,
    addOneAria: (name: string) => `Adicionar uma unidade de ${name}`,
    addItemAria: (name: string) => `Adicionar ${name}`,
    add: 'Adicionar',
  },

  // ── Notificação nativa (lib/notifications.ts) — fora do React ──
  notifications: {
    nativeTitle: (table: number) => `Mesa ${table}`,
  },
}
