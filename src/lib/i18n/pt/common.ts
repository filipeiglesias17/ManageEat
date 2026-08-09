// Namespace 'common' do dicionário PT: botões e rótulos transversais.

export const common = {
  languageName: 'Português',
  languageToggleLabel: 'Switch to English',
  cancel: 'Cancelar',
  save: 'Guardar',
  close: 'Fechar',
  confirm: 'Confirmar',
  retry: 'Tentar de novo',
  loading: 'A carregar…',
  saving: 'A guardar…',
  // "Powered by" é a assinatura da marca no rodapé — igual nos dois idiomas.
  poweredBy: 'Powered by',

  // aria-label do 2º passo do ConfirmButton: "Cancelar apagar item", etc.
  cancelAction: (action: string) => `Cancelar ${action}`,

  // Campos de password partilhados (login, primeira instalação, "A minha conta").
  password: {
    show: 'Mostrar password',
    hide: 'Esconder password',
    confirmLabel: 'Confirmar password',
    minHint: (min: number) => `Mínimo ${min} caracteres.`,
    tooShort: (min: number) => `A password tem de ter pelo menos ${min} caracteres.`,
    mismatch: 'As passwords não coincidem.',
  },

  // Etiquetas dos estados de um pedido (badges no admin, cozinha e histórico).
  orderStatus: {
    pending: 'Pendente',
    preparing: 'Em Preparação',
    ready: 'Pronto',
    delivered: 'Entregue',
    cancelled: 'Cancelado',
  },
  // Botão "avançar" do fluxo da cozinha, por estado atual.
  orderStatusNext: {
    pending: 'Iniciar',
    preparing: 'Pronto',
    ready: 'Entregar',
  },
  // Botão "recuar um passo" do fluxo da cozinha, por estado atual.
  orderStatusPrev: {
    preparing: 'Voltar a Pendente',
    ready: 'Voltar a Preparação',
    delivered: 'Voltar a Pronto',
  },
  // Cabeçalhos das colunas do quadro Kanban da cozinha.
  kanbanColumns: {
    pending: 'Pendentes',
    preparing: 'Em Preparação',
    ready: 'Prontos',
  },
}
