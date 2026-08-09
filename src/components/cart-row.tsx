import { useState } from 'react'
import { formatEuro } from '../lib/helpers'
import { Plus, Minus, X, Tag } from 'lucide-react'
import type { CartItem } from '../@types/cart'
import type { DiscountType } from '../@types/order'
import { resolveStorageUrl } from '../lib/supabase'
import type { RestaurantMode } from '../@types/settings'
import { isIncludedInRodizio } from '../lib/rodizio'
import { effectivePrice, effectiveItemPrice } from '../hooks/use-cart'

interface Props {
  item: CartItem
  // As callbacks recebem o uid da linha do carrinho (não o id do MenuItem):
  // duas linhas podem partilhar o mesmo MenuItem mas ter personalizações diferentes.
  onQty: (uid: string, delta: number) => void
  onNotes: (uid: string, notes: string) => void
  onToggleIngredient: (uid: string, ingredient: string) => void
  onRemove: (uid: string) => void
  onItemDiscount?: (uid: string, type: DiscountType, value: number) => void
  notesPlaceholder?: string
  // No modo rodízio, uma linha incluída mostra "Incluído" em vez do preço.
  mode?: RestaurantMode
}

export function CartRow({ item, onQty, onNotes, onToggleIngredient, onRemove, onItemDiscount, notesPlaceholder = 'Alguma nota? (ex: sem cebola)', mode = 'normal' }: Props) {
  // Se a linha já tem desconto (ex: o componente foi desmontado e montado de
  // novo), recupera o tipo guardado — antes voltava sempre a 'percent' e o
  // valor passava a ser interpretado com o tipo errado.
  const [discountType, setDiscountType] = useState<DiscountType>(item.itemDiscount?.type ?? 'percent')
  const [discountInput, setDiscountInput] = useState(item.itemDiscount?.value ? String(item.itemDiscount.value) : '')

  // Item incluído no rodízio: grátis, e o desconto por linha deixa de fazer sentido.
  const included = isIncludedInRodizio(item.menuItem, mode)
  const basePrice = effectivePrice(item.menuItem)
  const finalPrice = effectiveItemPrice(item)
  const hasItemDiscount = !included && finalPrice < basePrice

  function handleDiscountChange(raw: string) {
    setDiscountInput(raw)
    onItemDiscount?.(item.uid, discountType, Number(raw) || 0)
  }

  function handleTypeChange(type: DiscountType) {
    setDiscountType(type)
    onItemDiscount?.(item.uid, type, Number(discountInput) || 0)
  }

  return (
    // animate-rise: a linha nova entra a subir (a saída é tratada por quem
    // renderiza a lista, via useAnimatedList).
    <div className="animate-rise bg-muted/40 border border-border rounded-sm p-3">
      <div className="flex items-start gap-3">
        {item.menuItem.image && (
          <img src={resolveStorageUrl(item.menuItem.image)} alt="" className="size-12 rounded object-cover shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">{item.menuItem.name}</p>
          {item.menuItem.removableIngredients && item.menuItem.removableIngredients.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {item.menuItem.removableIngredients.map((ing) => {
                const removed = item.removedIngredients.includes(ing)
                return (
                  <button
                    key={ing}
                    type="button"
                    onClick={() => onToggleIngredient(item.uid, ing)}
                    className={`text-xs px-2 py-1.5 rounded-full border transition-colors ${
                      removed
                        ? 'bg-red-100 border-red-300 text-red-700 line-through dark:bg-red-900/40 dark:border-red-700 dark:text-red-400'
                        : 'bg-muted border-border text-muted-foreground hover:border-muted-foreground/50'
                    }`}
                  >
                    {ing}
                  </button>
                )
              })}
            </div>
          )}
          {/* text-base no telemóvel (>=16px) evita o zoom automático do iOS ao
              focar o input; sm:text-xs mantém o visual compacto no desktop. */}
          <input
            value={item.notes}
            onChange={(e) => onNotes(item.uid, e.target.value)}
            placeholder={notesPlaceholder}
            aria-label={`Notas para ${item.menuItem.name}`}
            className="text-base sm:text-xs bg-transparent text-foreground outline-none w-full mt-1 placeholder:text-muted-foreground"
          />
        </div>
        {/* p-2.5 -m-2.5: aumenta a área de toque (~36px) sem deslocar o ícone. */}
        <button onClick={() => onRemove(item.uid)} className="shrink-0 p-2.5 -m-2.5" aria-label="Remover item">
          <X className="size-4 text-muted-foreground hover:text-foreground" />
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 mt-2 pt-2 border-t border-border">
        {/* Quantidade */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onQty(item.uid, -1)}
            className="h-10 w-10 flex items-center justify-center rounded bg-secondary hover:bg-secondary/80 text-foreground"
            aria-label="Diminuir quantidade"
          >
            <Minus className="size-4" />
          </button>
          <span className="text-sm w-6 text-center tabular-nums text-foreground">{item.quantity}</span>
          <button
            onClick={() => onQty(item.uid, 1)}
            className="h-10 w-10 flex items-center justify-center rounded bg-secondary hover:bg-secondary/80 text-foreground"
            aria-label="Aumentar quantidade"
          >
            <Plus className="size-4" />
          </button>
        </div>

        {/* Desconto por item (só empregado). Escondido para itens incluídos no
            rodízio — já são grátis, não há desconto a aplicar. */}
        {onItemDiscount && !included && (
          <div className="flex items-center gap-1">
            <Tag className="size-3 text-muted-foreground" />
            <input
              type="number"
              value={discountInput}
              onChange={(e) => handleDiscountChange(e.target.value)}
              min="0"
              step="0.01"
              placeholder="0"
              aria-label={`Desconto para ${item.menuItem.name}`}
              className="w-16 text-base sm:text-xs bg-muted border border-input rounded-sm px-2 py-1 outline-none text-center text-foreground"
            />
            <div className="flex rounded-sm overflow-hidden border border-border">
              <button
                type="button"
                onClick={() => handleTypeChange('percent')}
                className={`px-2 py-1 text-xs font-medium transition-colors ${
                  discountType === 'percent' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                %
              </button>
              <button
                type="button"
                onClick={() => handleTypeChange('euros')}
                className={`px-2 py-1 text-xs font-medium transition-colors ${
                  discountType === 'euros' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                €
              </button>
            </div>
          </div>
        )}

        {/* Preço. No rodízio, um item incluído mostra "Incluído" em vez do valor. */}
        <div className="flex items-baseline gap-1.5">
          {included ? (
            <span className="text-sm font-medium text-brand">Incluído</span>
          ) : (
            <>
              {hasItemDiscount && (
                <span className="text-xs text-muted-foreground line-through">
                  {formatEuro(basePrice * item.quantity)}
                </span>
              )}
              <span className="text-sm font-medium text-foreground">
                {formatEuro(finalPrice * item.quantity)}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
