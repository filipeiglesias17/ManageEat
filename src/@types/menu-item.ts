export type MenuItem = {
  id: string
  name: string
  description: string
  price: number
  categoryId: string
  available: boolean
  discount: number | null  // percentagem 0-100, null = sem desconto
  removableIngredients?: string[]
  // Etiquetas livres mostradas no menu: alergénios e dietas (ex: "vegetariano",
  // "sem glúten", "picante"). Servem de filtro e de aviso ao cliente.
  tags?: string[]
  // Só conta no modo rodízio: quando true, o item está incluído na entrada e
  // aparece grátis ao cliente. Ausente/false = paga-se normalmente (extra).
  rodizioAvailable?: boolean
  // Taxa de IVA (%) deste item. Ausente = usa a taxa por defeito do restaurante
  // (settings.defaultVatRate). Em PT: 13% refeições, 23% bebidas, 6% alguns.
  vatRate?: number
  // Referência pública da imagem (normalmente um caminho estável do Supabase
  // Storage; URLs antigos/externos continuam suportados). Ausente/null = fallback.
  image?: string | null
}
