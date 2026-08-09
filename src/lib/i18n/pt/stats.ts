// Namespace 'stats' do dicionário PT — página de Análises do admin
// (src/pages/admin-stats/*, src/components/stats-cards.tsx e export-modal.tsx).
// Agrupado à imagem dos separadores da página (Resumo/Vendas/Produtos/Fechos).

export const stats = {
  header: {
    title: 'Análises',
    subtitle: 'Vendas, produtos e fechos do restaurante',
  },

  // Separadores do topo da página.
  tabs: {
    summary: 'Resumo',
    sales: 'Vendas',
    products: 'Produtos',
    closings: 'Fechos & Turnos',
  },

  // Botões rápidos de período — usados no filtro principal e no modal de exportação.
  presets: {
    today: 'Hoje',
    '7d': '7 dias',
    '30d': '30 dias',
    '90d': '90 dias',
    all: 'Tudo',
  },

  // Seg…Dom — usado no mapa de calor (charts.tsx) e no "Hora de ponta" (summary-tab.tsx).
  weekdays: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'],

  // Nomes dos quadrantes de rentabilidade do menu, em linguagem de dono de
  // restaurante (não jargão de "engenharia de menu"). As cores continuam a
  // vir de QUADRANT_META em lib/stats.ts — aqui só o texto.
  quadrants: {
    estrela: {
      label: 'Estrelas',
      hint: 'Muito pedidos e muita receita — proteger e destacar.',
    },
    popular: {
      label: 'Muito vendidos, pouca receita',
      hint: 'Saem muito mas rendem pouco — subir preço ou sugerir extras.',
    },
    nicho: {
      label: 'Boa receita, poucas vendas',
      hint: 'Rendem bem mas saem pouco — dar mais visibilidade no menu.',
    },
    fraco: {
      label: 'A rever',
      hint: 'Saem pouco e rendem pouco — rever a ficha ou tirar do menu.',
    },
  },

  // Rótulos curtos dentro do próprio gráfico de matriz (pouco espaço); a
  // explicação completa fica na legenda por baixo, que usa `quadrants.*.label`.
  quadrantChartLabel: {
    estrela: 'Estrelas',
    popular: 'Saem muito',
    nicho: 'Rendem bem',
    fraco: 'A rever',
  },

  dateRange: {
    from: 'De',
    to: 'Até',
    custom: 'Personalizado',
    daysCount: (days: number) => `${days} dias`,
  },

  compare: {
    button: 'Comparar',
    vsLastWeek: 'vs semana passada',
    // title (tooltip nativo) do botão de comparar.
    hintSameWeekday: 'Comparação com o mesmo dia da semana passada',
    hintPreviousPeriod: 'Comparar com o período anterior de igual duração',
    // Frase visível por baixo dos KPIs quando a comparação está ativa.
    noteSameWeekday: 'Comparação com o mesmo dia da semana passada.',
    notePreviousPeriod: 'Comparação com o período anterior de igual duração.',
  },

  // Contador de pedidos com singular/plural — usado no filtro do topo e no
  // título de cada célula do mapa de calor.
  ordersCount: (count: number) => `${count} pedido${count !== 1 ? 's' : ''}`,

  loadingLabel: 'A carregar as análises',

  emptyPeriod: {
    title: 'Sem vendas no período',
    description: 'Não há pedidos registados nas datas selecionadas. Muda o período ou regista novas vendas.',
  },

  limitedData: (error?: string) => `Não foi possível carregar o período completo${error ? ` (${error})` : ''}.`,

  export: {
    button: 'Exportar…',
    busy: 'A exportar…',
    error: (message: string) => `Não foi possível exportar: ${message}`,
    reportButton: 'Exportar relatório (XLSX / PDF / CSV)',
  },

  kpis: {
    revenue: 'Total de vendas',
    orders: 'Pedidos',
    avgTicket: 'Ticket médio',
    avgTicketSub: 'média por pedido',
    covers: 'Nº de pessoas',
    coversSub: 'servidas em rodízio',
    alaCarteLabel: 'À la carte',
    rodizioEntriesLabel: 'Rodízio (entradas)',
    rodizioLabel: 'Rodízio',
  },

  // Rótulos curtos partilhados por várias secções (cabeçalhos de tabela,
  // nomes de eixo/tooltip dos gráficos, etc.) — um sítio só para não repetir
  // "Pedidos"/"Vendas"/"Total" em cada ficheiro.
  labels: {
    tableNumber: 'Mesa',
    sales: 'Vendas',
    orders: 'Pedidos',
    covers: 'Pessoas',
    rate: 'Taxa',
    base: 'Base',
    vat: 'IVA',
    total: 'Total',
    employee: 'Empregado',
    accountsClosed: 'Contas fechadas',
    totalCollected: 'Total cobrado',
    totalReceived: 'Total recebido',
    who: 'Quem',
    checkIn: 'Entrada',
    checkOut: 'Saída',
    duration: 'Duração',
  },

  tableRowLabel: (tableNumber: number) => `Mesa ${tableNumber}`,

  sections: {
    highlights: {
      title: 'Destaques',
      hint: 'O que sobressai no período escolhido',
      bestDay: 'Melhor dia',
      peakHour: 'Hora de ponta',
      topItem: 'Artigo mais vendido',
      dominantSource: 'Origem dominante',
    },
    trend: {
      title: 'Evolução das vendas',
      compareHint: 'Linha tracejada = período de comparação',
      views: { revenue: 'Vendas', orders: 'Pedidos' },
    },
    topItems: {
      title: 'Artigos mais vendidos',
      empty: 'Sem vendas de artigos no período.',
      viewAll: 'Ver todos os produtos',
    },
    paymentMethods: {
      title: 'Meios de pagamento',
      hintSales: 'Repartição dos pagamentos registados ao fechar contas (anulados não contam).',
      empty: 'Sem pagamentos registados no período.',
      viewAll: 'Ver fechos e turnos',
    },
    peakHours: {
      title: 'Horas de ponta',
      hint: 'Pedidos por dia da semana e hora — células mais escuras têm mais movimento. Útil para escalar a equipa.',
    },
    orderSource: {
      title: 'Origem do pedido',
      hint: 'Pedidos feitos pelo cliente no QR da mesa vs lançados pelo empregado.',
    },
    tableSales: {
      title: 'Vendas por mesa e por pessoa',
      hint: 'Mesas que mais faturam no período. O nº de pessoas vem do rodízio (contado uma vez por conta).',
      coversLabel: 'Nº de pessoas (rodízio): ',
      revenuePerCover: 'Vendas por pessoa: ',
      empty: 'Sem vendas no período.',
    },
    vat: {
      title: 'IVA por taxa',
      hint: 'Preços em Portugal têm IVA incluído: a base é calculada a partir do total. Igual ao mapa de IVA dos relatórios exportados.',
    },
    menuProfitability: {
      title: 'Rentabilidade do menu',
      hint: 'Cada ponto é um artigo: quantas vezes sai (largura) vs quanto rende (altura).',
      views: { matrix: 'Matriz', bars: 'Barras', cards: 'Cards' },
    },
    categorySales: {
      title: 'Vendas por família',
      hint: 'Famílias/categorias do menu — onde se concentra o movimento.',
      views: { donut: 'Donut', bars: 'Barras' },
      metricQty: 'Quantidade',
      metricRevenue: 'Vendas',
    },
    combos: {
      title: 'Pedidos em conjunto',
      hint: 'Quem pede um, costuma pedir o outro — bom para sugerir extras ou montar combos.',
      emptyNoCategory: 'Selecione pelo menos uma família acima.',
      emptyNoCombos: 'Sem pedidos em conjunto neste período.',
    },
    neverOrdered: {
      title: 'Artigos sem vendas',
      hint: 'Disponíveis no menu mas sem uma única venda no período — candidatos a promoção ou a sair da carta.',
    },
    dailyClosing: {
      titleDay: 'Fecho do dia',
      titlePeriod: 'Fecho do período',
      hint: 'Resumo à imagem do talão de fecho: o que entrou, por que meio, e o que foi anulado.',
      ordersServed: (count: number) => `${count} pedido${count !== 1 ? 's' : ''} servidos`,
      voidedNote: 'pagamentos anulados não contam',
      cancellationsLabel: 'Anulações',
      cancellationsBreakdown: (orders: number, payments: number) =>
        `${orders} pedido${orders !== 1 ? 's' : ''} · ${payments} pagamento${payments !== 1 ? 's' : ''}`,
    },
    employeeSales: {
      title: 'Vendas por empregado',
      hint: 'Quem fechou cada conta — a receita fica ligada a quem cobrou (turno picado).',
      empty: 'Sem contas fechadas no período.',
    },
    shifts: {
      title: 'Turnos',
      hint: 'Entradas e saídas picadas no período (os 10 mais recentes). A gestão completa está na área Turnos.',
      empty: 'Sem turnos registados no período.',
      open: 'aberto',
      autoSuffix: '(auto)',
    },
    cancellations: {
      title: 'Anulações e descontos',
      hint: 'Pedidos anulados no período, valor que não entrou e descontos concedidos — controlo interno junto ao fecho.',
      cancelledOrders: 'Pedidos anulados',
      cancelledRate: 'Taxa de anulação',
      lostValue: 'Valor não cobrado',
      discountsGiven: 'Descontos concedidos',
      topReasons: 'Motivos mais frequentes',
    },
  },

  // "Chrome" dos gráficos Recharts: nomes de eixo/tooltip e textos do mapa de calor.
  chart: {
    tooltipCurrent: 'Atual',
    tooltipPrevious: 'Anterior',
    matrixOrdersLabel: (count: number) => `${count} pedidos`,
    axisOrdersOut: 'Vezes que sai (pedidos)',
    axisSalesAccumulated: 'Vendas acumuladas',
    medianQty: 'Mediana Qtd',
    medianSales: 'Mediana Vendas',
    recommendedAction: 'Ação recomendada: ',
    heatmapLess: 'Menos movimento',
    heatmapMore: 'Mais movimento',
    heatmapCellTitle: (dayLabel: string, hour: string, count: number) =>
      `${dayLabel} às ${hour}:00 · ${count} pedido${count !== 1 ? 's' : ''}`,
    tooWideTitle: 'Intervalo demasiado longo',
    tooWideDescription: (days: number) =>
      `O período selecionado (${days} dias) é muito longo para a evolução diária (máx. 92 dias). Escolha um intervalo mais curto.`,
  },

  productsChip: 'Artigos vendidos no período: ',

  exportModal: {
    title: 'Exportar análises',
    subtitle: 'Escolhe o formato, o período e o que queres incluir no ficheiro.',
    formatLegend: 'Formato',
    formats: {
      xlsx: 'XLSX (Excel)',
      pdf: 'PDF',
      csv: 'CSV',
      saft: 'SAF-T',
    },
    saftWarningLabel: 'Aviso:',
    saftWarningText: 'o SAF-T (PT) é experimental. Gera um ficheiro XML não certificado, sem validade fiscal — serve só para estudo, não para entregar à AT.',
    periodLegend: 'Período',
    presetAriaLabel: (label: string) => `Preencher o período: ${label}`,
    noDatesHint: 'Sem datas preenchidas, o ficheiro inclui todo o histórico.',
    sectionsLegend: 'Secções a incluir',
    sections: {
      resumo: 'Resumo',
      vendasDia: 'Vendas por dia',
      categorias: 'Categorias',
      itens: 'Itens',
      pagamentos: 'Meios de pagamento',
      iva: 'IVA',
      turnos: 'Turnos',
      rodizio: 'Rodízio',
      auditoria: 'Auditoria de staff',
    },
    purposeLabel: 'Finalidade (opcional)',
    purposePlaceholder: 'Ex.: contabilidade, gestão interna',
    purposeHelp: 'Fica registada nos metadados do ficheiro e ajuda a justificar o uso dos dados (RGPD).',
    invalidDateRange: 'A data "De" não pode ser depois da data "Até".',
    needsSection: 'Escolhe pelo menos uma secção para incluir.',
    submit: 'Exportar ficheiro',
    submitBusy: 'A exportar…',
    legalTitle: 'Aviso legal',
  },
}
