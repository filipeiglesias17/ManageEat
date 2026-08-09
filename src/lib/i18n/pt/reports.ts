// Namespace 'reports' do dicionário PT: textos dos RELATÓRIOS EXPORTADOS
// (XLSX, PDF, CSV) das Análises do admin  nomes de folha/secção, cabeçalhos
// de coluna, etiquetas de KPI, avisos legais e mensagens de download.
// Interpolações = funções.
//
// Porquê um namespace à parte de 'stats': estas strings vivem dentro dos
// FICHEIROS gerados (fora do React  ver `dict()` em `lib/i18n/index.ts`), não
// no ecrã de Análises. O idioma ativo no momento de clicar "Exportar" é o que
// sai no ficheiro.
//
// Alguns conceitos têm etiqueta LONGA (folha do XLSX) e CURTA (mesma coluna no
// CSV, ou título diferente no PDF)  isto é assim já no código PT original;
// mantemos as duas versões para não mudar o texto de cada ficheiro por engano.
export const reports = {
  //  Metadados partilhados (Capa do XLSX, cabeçalho do PDF, comentários "# " do CSV)
  meta: {
    exportedBy: 'Exportado por',
    role: 'Função',
    dateTime: 'Data/hora',
    period: 'Período',
    purpose: 'Finalidade',
    establishment: 'Estabelecimento',
    // "NIF" é dado fiscal  não se traduz (ver o cabeçalho de i18n/index.ts).
    nif: 'NIF',
    fullHistory: 'Todo o histórico',
    periodRange: (from: string, to: string) => `${from} a ${to}`,
  },

  // Etiqueta de cada role SÓ para os documentos exportados (a BD guarda o role
  // sempre em inglês  isto é apresentação).
  roleLabel: {
    admin: 'Administrador',
    gerente: 'Gerente',
    empregado: 'Empregado',
    cozinha: 'Cozinha',
    cliente: 'Cliente',
  },

  // Etiquetas de meio de pagamento SÓ para os relatórios exportados. Não mexe
  // em PAYMENT_METHOD_LABEL (@types/payment.ts), que serve o resto da app.
  paymentMethodLabel: {
    dinheiro: 'Dinheiro',
    cartao: 'Cartão',
    outro: 'Outro',
  },

  // Avisos legais usados pelos ficheiros exportados. É uma cópia com a MESMA
  // redação de LEGAL_NO_FISCAL/LEGAL_CONFIDENTIAL_RGPD em export-meta.ts  essa
  // fonte fica como está (usada por export-modal.tsx, fora do âmbito desta
  // migração); esta cópia reage ao idioma ativo no export.
  legal: {
    // Cuidado ao editar: o rodapé do PDF usa só a 1.ª frase (corta no 1.º
    // ponto)  mantém a 1.ª frase curta e sem pontos a meio (abreviaturas).
    noFiscalNotice:
      'Documento de gestão interna, sem validade fiscal. Não substitui a fatura ou o recibo, que em Portugal têm de ser emitidos por software certificado pela AT (com ATCUD, QR Code e assinatura digital).',
    confidentialRgpd:
      'Documento confidencial. Contém dados pessoais de trabalhadores protegidos pelo RGPD. O acesso é restrito à finalidade de gestão do restaurante; recolha apenas os dados necessários e não partilhe nem guarde o ficheiro além do tempo indispensável a essa finalidade.',
  },

  //  Folha: Capa (XLSX, sempre incluída)
  cover: {
    sheetName: 'Capa',
    fieldColumn: 'Campo',
    valueColumn: 'Valor',
    noticeLabel: 'Aviso',
    confidentialityLabel: 'Confidencialidade',
  },

  //  Folha: Resumo (XLSX)  a tabela "Resumo" do PDF reutiliza estas etiquetas
  summary: {
    sheetName: 'Resumo',
    indicatorColumn: 'Indicador',
    valueColumn: 'Valor',
    deltaColumn: 'vs período anterior (%)',
    revenue: 'Receita total',
    orders: 'Nº de pedidos',
    avgTicket: 'Ticket médio',
    items: 'Itens vendidos',
    discount: 'Descontos concedidos',
    covers: 'Pessoas servidas (rodízio)',
  },

  //  Folha: Vendas por dia (XLSX + CSV; mesmo título e colunas no PDF)
  dailySales: {
    sheetName: 'Vendas por dia',
    dayColumn: 'Dia',
    revenueColumn: 'Receita',
    ordersColumn: 'Pedidos',
    itemsColumn: 'Itens',
  },

  //  Folha: Categorias (XLSX + CSV; o PDF chama a secção "Vendas por categoria")
  categories: {
    sheetName: 'Categorias',
    categoryColumn: 'Categoria',
    qtyColumn: 'Qtd',
    revenueColumn: 'Receita',
  },

  //  Folha: Itens (XLSX + CSV; o PDF chama a secção "Top itens")
  items: {
    sheetName: 'Itens',
    itemColumn: 'Item',
    qtyColumn: 'Qtd',
    revenueColumn: 'Receita',
    // O nome do quadrante em si (Estrela/Popular/Nicho/Fraco) vem de
    // QUADRANT_META em stats.ts  fora do âmbito desta migração, fica em PT
    // nos dois idiomas por agora.
    quadrantColumn: 'Quadrante',
  },

  //  Folha: Pagamentos (XLSX + CSV; o PDF chama a secção "Meios de pagamento")
  payments: {
    sheetName: 'Pagamentos',
    methodColumn: 'Método',
    countColumn: 'Nº',
    valueColumn: 'Valor',
    shareColumn: '% do total',
    totalReceivedLabel: 'Total recebido',
  },

  //  Folha: IVA (XLSX; o PDF chama a secção "Resumo de IVA")
  vat: {
    sheetName: 'IVA',
    rateColumn: 'Taxa',
    baseColumn: 'Base tributável',
    // Versão curta usada só no CSV (o cabeçalho de "Base" já existia assim).
    csvBaseColumn: 'Base',
    vatColumn: 'IVA',
    totalColumn: 'Total',
    totalRowLabel: 'Total',
  },

  //  Folha: Turnos (XLSX; o PDF chama a secção "Turnos (ponto)")
  shifts: {
    sheetName: 'Turnos',
    openedColumn: 'Entrada',
    closedColumn: 'Saída',
    hoursColumn: 'Horas',
    openedByColumn: 'Aberto por',
    closedByColumn: 'Fechado por',
    paymentsCountColumn: 'Nº pagamentos',
    revenueColumn: 'Receita',
  },

  //  Folha: Rodízio (XLSX; secção "Rodízio" do PDF reutiliza estas etiquetas)
  rodizio: {
    sheetName: 'Rodízio',
    indicatorColumn: 'Indicador',
    tableColumn: 'Mesa',
    peopleColumn: 'Pessoas',
    revenueColumn: 'Receita',
    revenuePerPersonLabel: 'Receita por pessoa',
    topTablesLabel: 'Top mesas',
    tableLabel: (n: number) => `Mesa ${n}`,
  },

  //  Folha: Auditoria de staff (XLSX; o CSV usa "Valor" em vez de "Valor registado")
  audit: {
    sheetName: 'Auditoria',
    staffColumn: 'Staff',
    cancellationsColumn: 'Cancelamentos',
    paymentsColumn: 'Pagamentos',
    valueColumn: 'Valor registado',
    // Versão curta usada só no CSV (o cabeçalho de "Valor" já existia assim).
    csvValueColumn: 'Valor',
    voidsColumn: 'Anulações',
    shiftsOpenedColumn: 'Turnos abertos',
    shiftsClosedColumn: 'Turnos fechados',
    hoursColumn: 'Horas',
  },

  //  Textos exclusivos do PDF (títulos/etiquetas que não coincidem com o XLSX)
  pdf: {
    defaultTitle: 'Relatório de Vendas',
    issuedAt: 'Emitido em',
    deltaColumnShort: 'vs ant.',
    vatSummaryTitle: 'Resumo de IVA',
    categorySalesTitle: 'Vendas por categoria',
    topItemsTitle: 'Top itens',
    // Variante curta de "Pessoas servidas (rodízio)", só na secção Rodízio.
    peopleServedLabel: 'Pessoas servidas',
    shiftsTitle: 'Turnos (ponto)',
    whoColumn: 'Quem',
    openShiftLabel: 'Em aberto',
    paymentsTitle: 'Meios de pagamento',
    noPaymentsRegistered: 'Sem pagamentos registados',
    cancelDiscountTitle: 'Cancelamentos & descontos',
    cancelledOrdersLabel: 'Pedidos cancelados',
    cancelRateLabel: 'Taxa de cancelamento',
    lostValueLabel: 'Valor perdido',
    footerFiscalNotice:
      'Documento de gestão — sem validade fiscal. Não substitui fatura/recibo certificado pela AT.',
    pageLabel: (current: number, total: number) => `Página ${current}/${total}`,
  },

  //  Entrega do ficheiro ao utilizador (export-download.ts)
  download: {
    reinstallRequired:
      'Reinstala a app para exportar (esta atualização precisa da nova versão nativa, não chega a atualização automática).',
    shareDialogTitle: 'Guardar ou partilhar',
    readFileError: 'Falha a ler o ficheiro a exportar.',
  },
}
