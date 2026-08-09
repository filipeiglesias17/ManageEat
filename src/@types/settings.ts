// Definições globais do restaurante. Vivem numa única linha
// `settings/restaurant` no Postgres. Leitura pública (o cliente precisa de
// saber se está em modo rodízio e qual o preço de entrada); escrita só admin.

export type SessionMode = 'normal' | 'rodizio'
export type RestaurantMode = SessionMode | 'mixed'

export type RestaurantSettings = {
  // 'normal' = à la carte (paga-se por item, o que existe desde sempre).
  // 'rodizio' = preço de entrada por pessoa e os itens grátis.
  // 'mixed' = o restaurante opera em ambos; o empregado escolhe por mesa.
  mode: RestaurantMode
  // Preço de entrada por pessoa, em euros. Só conta no modo rodízio.
  entryPrice: number
  // ── Dados fiscais (opcionais) ──
  // Usados nos relatórios de vendas (PDF/SAF-T). NÃO tornam os documentos
  // fiscalmente válidos — isso exigiria software certificado pela AT.
  name?: string      // nome comercial do restaurante
  nif?: string       // número de contribuinte da empresa
  address?: string   // morada (uma linha)
  // Taxa de IVA por defeito (%) aplicada a items sem taxa própria. Em PT a
  // restauração usa tipicamente 13% (refeições), 23% (bebidas), 6% (alguns).
  defaultVatRate?: number
  // Auto-fecho de turnos esquecidos: turnos abertos há mais do que este número
  // de horas fecham sozinhos com a marca "saída não picada". Vazio = desligado.
  // A BD limita a 0–24h (um turno não atravessa mais de um dia).
  maxShiftHours?: number
}

// Default seguro para quando o documento ainda não existe: restaurante normal,
// sem entrada. Garante que a app funciona sem qualquer migração de dados.
export const DEFAULT_SETTINGS: RestaurantSettings = {
  mode: 'normal',
  entryPrice: 0,
  // 13% é a taxa intermédia das refeições no continente — ponto de partida
  // razoável; o admin ajusta nas Definições e por item.
  defaultVatRate: 13,
}
