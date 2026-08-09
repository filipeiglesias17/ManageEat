// Lógica de domínio do modo rodízio. Mantida pura (só depende de tipos) para
// poder ser usada em hooks, componentes e páginas sem criar imports circulares.
//
// Modelo do projeto: no modo rodízio o cliente paga uma entrada por pessoa e os
// itens marcados como `rodizioAvailable` ficam grátis. Itens não marcados (ex:
// bebidas) continuam a ter preço e a somar à conta como extras.

import type { MenuItem } from '../@types/menu-item'
import type { RestaurantMode } from '../@types/settings'

// Um item está incluído (grátis) quando o restaurante está em rodízio E o admin
// o marcou como disponível para rodízio. Caso contrário, paga-se normalmente.
export function isIncludedInRodizio(item: MenuItem, mode: RestaurantMode): boolean {
  return mode === 'rodizio' && item.rodizioAvailable === true
}

// Total da entrada no modo rodízio: preço de entrada × nº de pessoas.
// Fora do rodízio, sem preço ou sem pessoas, devolve 0.
export function entryTotal(entryPrice: number, headcount: number): number {
  if (!Number.isFinite(entryPrice) || !Number.isFinite(headcount)) return 0
  if (entryPrice <= 0 || headcount <= 0) return 0
  return entryPrice * headcount
}
