// Namespace 'customer' do dicionário PT: fluxo do cliente  sessão QR
// (customer-session.tsx, /mesa/:sessionId) e a conta fixa de tablet
// (customer-dashboard.tsx, /cliente). Interpolações = funções.
//
// "Mesa" fica separado do número em vários sítios (tableWord) porque o
// número às vezes é `number | null` antes da sessão carregar  juntar tudo
// num único template arriscava mostrar "Mesa null" em vez de nada.

export const customer = {
  //  Sessão QR: carregamento e estados de ligação
  loadingSession: 'A carregar sessão…',
  connectionLost: {
    title: 'Sem ligação ao servidor',
    description: 'A tentar reconectar automaticamente. Verifica o Wi-Fi da mesa.',
  },
  sessionExpired: {
    title: 'Sessão expirada ou inválida',
    description: 'Pede ao empregado um novo QR code.',
  },
  waiting: {
    title: 'À espera de início de sessão',
    tablePrefix: (table: number) => `Mesa ${table}. `,
    description: 'O empregado vai abrir a tua mesa num instante — esta página atualiza sozinha.',
  },

  // "Mesa" isolado: usado como rótulo sozinho, ou ao lado do número já
  // renderizado à parte (evita juntar tudo num template com valor nulo).
  tableWord: 'Mesa',

  menuTitle: 'Menu',
  ordersStaleNotice: 'A lista de pedidos pode estar desatualizada. A tentar atualizar…',

  //  Código de acesso da mesa (criar / introduzir)
  accessCode: {
    // Sufixo usado dentro de frases quando já se conhece a mesa: " (Mesa 5)".
    tableSuffix: (table: number) => ` (Mesa ${table})`,
    invalidLength: (length: number) => `Usa exatamente ${length} dígitos.`,
    create: {
      title: (length: number) => `Cria um código de ${length} dígitos`,
      descriptionPrefix: 'Mantém a tua sessão segura',
      descriptionSuffix: '. Só quem souber o código consegue usar a conta por este QR.',
      ariaLabel: (length: number) => `Cria o código de ${length} dígitos`,
      submit: 'Criar código',
      submitting: 'A criar…',
    },
    enter: {
      title: 'Introduz o código',
      descriptionPrefix: 'Esta mesa',
      descriptionSuffix: (length: number) => ` está protegida por um código de ${length} dígitos.`,
      ariaLabel: (length: number) => `Introduz o código de ${length} dígitos`,
      locked: 'Código bloqueado temporariamente. Pede ajuda ao empregado.',
      submit: 'Entrar',
      submitting: 'A entrar…',
    },
    errors: {
      tooManyAttempts: 'Demasiadas tentativas. Pede ajuda ao empregado ou tenta novamente dentro de alguns minutos.',
      incorrect: 'Código incorreto.',
      generic: 'Não foi possível validar o código. Pede ajuda ao empregado.',
    },
  },

  //  Chamar empregado / pedir a conta (repetido em vários ecrãs)
  callWaiterButton: 'Chamar empregado',
  callingWaiterButton: 'A chamar…',
  requestBillButton: 'Pedir a conta',
  waiterCalledSuccess: 'O empregado foi avisado!',
  billRequestedSuccess: 'Pedido de conta enviado!',
  serviceCallError: (message: string) => `Não foi possível enviar o pedido: ${message}`,

  //  Painel do rodízio (conta = entrada × pessoas + extras)
  rodizio: {
    badge: 'Rodízio Ativo',
    // Frase até ao valor da entrada, que fica a negrito à parte:
    // "Entrada 15€ × 2 pessoas = " + <b>30€</b>.
    entryLine: (entryPriceLabel: string, headcount: number) =>
      `Entrada ${entryPriceLabel} × ${headcount} pessoa${headcount !== 1 ? 's' : ''} = `,
    includedNoticePrefix: 'Os itens marcados como ',
    includedWord: 'Incluído',
    includedNoticeSuffix: ' são grátis; os restantes somam à conta.',
    extraSpent: 'Gastos adicionais',
    accountTotal: 'Total da conta',
    subtotalEntry: 'Subtotal Entrada',
  },

  //  Painel "Conta Atual" (mesa normal, fora do rodízio)
  account: {
    title: 'Conta Atual',
    description: 'Abaixo podes acompanhar o consumo acumulado da tua mesa.',
    alreadyOrdered: 'Já pedido',
    inCart: 'No carrinho',
    estimatedTotal: 'Total estimado',
  },

  //  Carrinho (botão flutuante + modal)
  cart: {
    openAria: 'Abrir carrinho',
    itemsCount: (count: number) => `${count} ${count === 1 ? 'item' : 'itens'}`,
    viewOrder: 'Ver pedido',
    modalTitle: 'O Teu Pedido',
    closeAria: 'Fechar carrinho',
    empty: 'Não tens itens no carrinho.',
    total: 'Total',
    submitButton: 'Pedir',
    submitting: 'A enviar…',
  },

  successModal: {
    title: 'Pedido Recebido!',
    messagePrefix: 'O teu pedido da ',
    messageSuffix: ' já foi enviado à cozinha e está a ser preparado.',
    backButton: 'Voltar ao Menu',
  },

  //  Erros partilhados entre a sessão QR e a conta fixa
  errors: {
    cartEmpty: 'O carrinho está vazio',
    invalidSession: 'Sessão inválida',
    codeRequiredBeforeOrder: 'Introduz o código da mesa antes de pedir.',
    offline: 'Sem ligação à internet. Verifica o Wi-Fi da mesa e tenta outra vez.',
    sessionClosed: 'A sessão foi encerrada. Pede ao empregado para a reabrir.',
    // "message" já vem da validação local do carrinho (use-cart.ts), em português.
    fixCartMessage: (message: string) => `${message} Corrige o carrinho antes de enviar.`,
    networkSendFailed: 'Não foi possível enviar o pedido: sem ligação ao servidor. Tenta outra vez quando o Wi-Fi voltar.',
    sendFailedGeneric: (message: string) =>
      `Não foi possível enviar o pedido. Corrige o carrinho antes de tentar outra vez: ${message}`,
  },

  //  Conta fixa de tablet (customer-dashboard.tsx, /cliente)
  dashboard: {
    title: 'Cliente',
    cartBadge: (count: number) => `${count} ${count === 1 ? 'item' : 'itens'} no carrinho`,
    noTableAssigned: 'Esta conta ainda não tem mesa atribuída. Pede ao admin para definir a mesa.',
    searchingSession: 'A procurar sessão aberta da mesa…',
    sessionSearchError: (message: string) => `Não foi possível procurar a sessão: ${message}`,
    tableNotOpen: (table: number) => `Mesa ${table} ainda não está aberta. Pede ao empregado para abrir a mesa no mapa.`,
    cartSectionTitle: 'O Teu Carrinho',
    tableNotOpenForOrder: 'A mesa ainda não tem sessão aberta. Pede ao empregado para abrir a mesa.',
    rodizioMissingConfig: 'A sessão de rodízio ainda não tem entrada e nº de pessoas válidos.',
    orderSentSuccess: 'O teu pedido foi enviado para a cozinha!',
  },
}
