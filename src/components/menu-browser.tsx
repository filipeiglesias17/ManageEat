import { useState } from 'react'
import { formatEuro } from '../lib/helpers'
import { Plus, Minus, UtensilsCrossed } from 'lucide-react'
import type { MenuItem } from '../@types/menu-item'
import type { Category } from '../@types/category'
import type { RestaurantMode } from '../@types/settings'
import { isIncludedInRodizio } from '../lib/rodizio'
import { effectivePrice } from '../hooks/use-cart'
import { resolveStorageUrl } from '../lib/supabase'
import { useDict } from '../lib/i18n'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

// Cores por tag (alergénios/dietas). Sem emojis — a cor já dá a leitura rápida
// e mantém o visual mais sóbrio/profissional.
const TAG_STYLES: Record<string, { bg: string, text: string, border: string }> = {
  'Picante': { bg: 'bg-red-500/15', text: 'text-red-600 dark:text-red-400', border: 'border-red-500/30' },
  'Vegan': { bg: 'bg-green-500/15', text: 'text-green-600 dark:text-green-400', border: 'border-green-500/30' },
  'Vegetariano': { bg: 'bg-green-500/15', text: 'text-green-600 dark:text-green-400', border: 'border-green-500/30' },
  'Mais Pedido': { bg: 'bg-yellow-500/15', text: 'text-yellow-700 dark:text-yellow-400', border: 'border-yellow-500/30' },
  'Novo': { bg: 'bg-blue-500/15', text: 'text-blue-600 dark:text-blue-400', border: 'border-blue-500/30' },
}

// Diferenças SÓ visuais entre a face do staff (densa, operacional) e a face do
// cliente (mais respiro, fotos maiores, preço destacado). O default 'staff'
// mantém o menu do empregado exatamente como estava.
const VARIANT_STYLES = {
  staff: {
    grid: 'gap-3 @md:gap-4',
    media: 'w-28',
    content: 'p-3 @md:p-4',
    itemName: 'text-[14px] @md:text-[15px]',
    price: 'text-sm',
    plainPriceColor: 'text-foreground',
  },
  cliente: {
    // Thumb maior no layout estreito; no layout largo a foto passa a 4:3 (mais
    // fotográfica) em vez do quadrado denso do staff.
    grid: 'gap-4 @md:gap-5',
    media: 'w-32 @md:aspect-[4/3]',
    content: 'p-4 @md:p-5',
    itemName: 'text-base',
    price: 'text-base',
    plainPriceColor: 'text-brand',
  },
} as const

// O estado selecionado tem um contorno próprio e estável; não depende do foco
// que o iOS pode manter depois do toque. O ring de teclado fica fino e interior
// para acompanhar sempre o rounded-full.
function categoryButtonClass(active: boolean): string {
  return `rounded-full border focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 ${
    active
      ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15'
      : 'border-transparent'
  }`
}

type MenuBrowserVariant = keyof typeof VARIANT_STYLES

// Card fantasma para o estado de loading: mesma forma do card real (imagem +
// duas linhas de texto + preço), para a grelha não "saltar" de tamanho quando
// os itens verdadeiros chegam a seguir.
function MenuItemSkeletonCard({ mediaClassName }: { mediaClassName: string }) {
  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
      <div className="flex @md:flex-col gap-0">
        <Skeleton className={`shrink-0 @md:w-full aspect-square rounded-none ${mediaClassName}`} />
        <div className="flex flex-col gap-2 flex-1 min-w-0 p-3 @md:p-4">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-5 w-16 mt-2" />
        </div>
      </div>
    </div>
  )
}

interface Props {
  categories: Category[]
  items: MenuItem[]   // todos os itens
  onAdd: (item: MenuItem) => void
  // Quantidade já no carrinho por id de item (linha "plain"). Quando > 0, o card
  // mostra um stepper − N + em vez do botão "Adicionar". Opcional: sem isto, o
  // menu mantém o comportamento antigo (só "Adicionar").
  quantities?: Record<string, number>
  onRemove?: (item: MenuItem) => void
  // No modo rodízio, os itens incluídos aparecem como "Incluído" em vez do preço.
  mode?: RestaurantMode
  // true enquanto o 1.º snapshot do menu não chegou — distingue "a carregar" de
  // "menu vazio" para não mostrar "Nenhum item" antes do primeiro carregamento.
  loading?: boolean
  // 'cliente' = face pública (mais respiro, fotos maiores); 'staff' = densa.
  variant?: MenuBrowserVariant
}

function uniqueSortedTags(items: MenuItem[]): string[] {
  return [...new Set(items.flatMap((item) => item.tags ?? []))].sort()
}

function menuItemMatchesFilters(
  item: MenuItem,
  activeCategoryId: string,
  activeTag: string | null,
  searchTerm: string,
): boolean {
  const matchesCategory = activeCategoryId === 'all' || item.categoryId === activeCategoryId
  const matchesSearch = item.name.toLowerCase().includes(searchTerm)
  const matchesTag = !activeTag || (item.tags?.includes(activeTag) ?? false)

  return matchesCategory && matchesSearch && matchesTag
}

// Média de uma caixa do menu: foto quando existe, senão um placeholder desenhado
// (bloco com a cor da categoria + talheres). Cada caixa gere o seu próprio estado
// para o fade-in e o esqueleto não serem partilhados entre itens.
function MenuItemMedia({ item, tint, sizeClassName }: { item: MenuItem, tint?: string, sizeClassName: string }) {
  // `loaded` controla o fade-in da foto e tapa o esqueleto; `failed` faz uma foto
  // partida (404 / sem rede) cair no placeholder em vez de deixar um buraco.
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const src = item.image ? resolveStorageUrl(item.image) : undefined
  const showImage = src && !failed

  return (
    // Espaço SEMPRE reservado e QUADRADO (thumb no telemóvel; full-width no
    // desktop) → caixas uniformes e sem "salto" quando a foto chega. Quadrado
    // porque o object-contain mostra a foto INTEIRA: numa caixa quadrada as
    // fotos quadradas (o caso comum) preenchem sem barras, e as não-quadradas
    // aparecem completas (com margem neutra) em vez de cortadas.
    <div className={`relative shrink-0 @md:w-full aspect-square overflow-hidden bg-muted/40 ${sizeClassName}`}>
      {showImage ? (
        <>
          {/* Esqueleto a pulsar enquanto a foto não decodifica (rede local lenta). */}
          {!loaded && <div className="absolute inset-0 animate-pulse bg-muted" />}
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          />
        </>
      ) : (
        // Placeholder: tinta com a cor da categoria (alfa em hex de 8 dígitos, ok
        // no WebView do iOS); sem cor definida cai num tom neutro (muted).
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={tint ? { backgroundColor: `${tint}1f` } : undefined}
        >
          <UtensilsCrossed
            className={`size-7 sm:size-9 ${tint ? '' : 'text-muted-foreground/40'}`}
            style={tint ? { color: `${tint}99` } : undefined}
          />
        </div>
      )}
    </div>
  )
}

export function MenuBrowser({ categories, items, onAdd, quantities, onRemove, mode = 'normal', loading = false, variant = 'staff' }: Props) {
  const d = useDict()
  // Classes de apresentação da face escolhida (staff denso vs cliente com respiro).
  const styles = VARIANT_STYLES[variant]
  const [activeCategoryId, setActiveCategoryId] = useState('all')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const searchTerm = search.trim().toLowerCase()
  const visibleCategories = categories.filter((category) => items.some((item) => item.categoryId === category.id))
  // Tags presentes em pelo menos um item (ordenadas) — alimentam os chips de filtro.
  const availableTags = uniqueSortedTags(items)
  const filteredItems = items.filter((item) => menuItemMatchesFilters(item, activeCategoryId, activeTag, searchTerm))

  return (
    // @container: a grelha de pratos reage à largura DESTA coluna, não do ecrã.
    // Assim os cards mantêm um tamanho legível esteja o menu numa coluna estreita
    // (lado a lado com o mapa) ou a ocupar a largura toda.
    <section className="@container">
      <div className="flex flex-col gap-3 mb-6">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={d.employee.menu.searchPlaceholder}
          aria-label={d.employee.menu.searchAria}
          className="w-full sm:w-64"
        />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveCategoryId('all')}
            aria-pressed={activeCategoryId === 'all'}
            className={categoryButtonClass(activeCategoryId === 'all')}
          >
            {d.employee.menu.allCategories}
          </Button>
          {visibleCategories.map((cat) => (
            <Button
              key={cat.id}
              variant="ghost"
              size="sm"
              onClick={() => setActiveCategoryId(cat.id)}
              aria-pressed={activeCategoryId === cat.id}
              className={categoryButtonClass(activeCategoryId === cat.id)}
            >
              {cat.name}
            </Button>
          ))}
        </div>

        {/* Filtro por tag (alergénios/dietas). Clicar outra vez limpa. */}
        {availableTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {availableTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setActiveTag((cur) => (cur === tag ? null : tag))}
                aria-pressed={activeTag === tag}
                className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                  activeTag === tag
                    ? 'bg-primary/15 text-primary border-primary/40'
                    : 'text-muted-foreground border-border hover:text-foreground hover:bg-accent'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Grelha de esqueletos com a MESMA forma da grelha real (mesmas colunas),
          para não saltar de tamanho quando o 1.º snapshot chega. O texto para
          leitores de ecrã fica num só role="status", não card a card. */}
      {loading && (
        <div className={`grid grid-cols-1 @md:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4 ${styles.grid}`} role="status" aria-label={d.employee.menu.loadingAria}>
          {Array.from({ length: 8 }).map((_, index) => (
            <MenuItemSkeletonCard key={index} mediaClassName={styles.media} />
          ))}
        </div>
      )}

      {!loading && filteredItems.length === 0 && (
        <p className="text-muted-foreground text-sm text-center py-12 animate-fade-in" role="status">
          {d.employee.menu.noItemsFound}
        </p>
      )}

      {/* Só depois do 1.º carregamento, com fade-in: a troca esqueletos → itens
          reais deixa de saltar a seco. */}
      {!loading && (
      <div className={`grid grid-cols-1 @md:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4 animate-fade-in ${styles.grid}`}>
        {filteredItems.map((item, index) => (
          <div
            key={item.id}
            // Entrada escalonada: cada prato "sobe" com um pequeno atraso (cap aos
            // ~10 primeiros para listas longas não terem cascata lenta). Só nos
            // disponíveis — o animate-rise acaba em opacity:1 e apagaria o
            // opacity-60 dos esgotados.
            style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}
            // transition em opacity/filter: quando um item esgota (ou volta a
            // haver) em tempo real, o cinzento entra/sai suave em vez de saltar.
            className={`bg-card border border-border rounded-xl shadow-sm transition-[border-color,opacity,filter] duration-300 overflow-hidden ${
              !item.available ? 'opacity-60 grayscale-[50%]' : 'animate-rise hover:border-ring/40'
            }`}
          >
            {/* Layout horizontal quando a coluna é estreita, vertical quando há
                largura (≥ @md). Reage à coluna (container), não ao ecrã. */}
            <div className="flex @md:flex-col gap-0">

              {/* Slot de imagem sempre presente: foto ou placeholder, tingido com a
                  cor da categoria do item para o menu ficar uniforme com ou sem foto. */}
              <MenuItemMedia item={item} tint={categories.find((c) => c.id === item.categoryId)?.color} sizeClassName={styles.media} />

              {/* Conteúdo */}
              <div className={`flex flex-col gap-2 flex-1 min-w-0 ${styles.content}`}>
                <div>
                  <p className={`font-medium leading-snug ${styles.itemName} ${item.available ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {item.name}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2 @md:line-clamp-none">
                    {item.description}
                  </p>
                  {item.tags && item.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {item.tags.map((tag) => {
                        const style = TAG_STYLES[tag] || { bg: 'bg-secondary', text: 'text-muted-foreground', border: 'border-border' }
                        return (
                          <Badge
                            key={tag}
                            variant="outline"
                            className={`text-[10px] ${style.bg} ${style.text} ${style.border}`}
                          >
                            {tag}
                          </Badge>
                        )
                      })}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between mt-auto pt-1 gap-2">
                  <div className="flex flex-col shrink-0">
                    {isIncludedInRodizio(item, mode) ? (
                      <span className={`${styles.price} font-semibold ${item.available ? 'text-primary' : 'text-muted-foreground'}`}>{d.employee.menu.included}</span>
                    ) : item.discount ? (
                      <>
                        <span className="text-[11px] text-muted-foreground line-through leading-none">{formatEuro(item.price)}</span>
                        <span className={`${styles.price} font-semibold ${item.available ? 'text-primary' : 'text-muted-foreground'}`}>
                          {formatEuro(effectivePrice(item))}{' '}
                          <span className="text-[11px] font-medium text-orange-600 dark:text-orange-400">-{item.discount}%</span>
                        </span>
                      </>
                    ) : (
                      <span className={`${styles.price} font-semibold ${item.available ? styles.plainPriceColor : 'text-muted-foreground'}`}>{formatEuro(item.price)}</span>
                    )}
                  </div>
                  {!item.available ? (
                    <Badge
                      variant="outline"
                      className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-destructive bg-destructive/10 border-destructive/20 px-2 sm:px-3 py-1.5 shrink-0"
                    >
                      {d.employee.menu.soldOut}
                    </Badge>
                  ) : onRemove && (quantities?.[item.id] ?? 0) > 0 ? (
                    // Já no carrinho: stepper − N + (controla a linha "plain" do item).
                    // A 0 a linha desaparece e volta ao botão "Adicionar".
                    <div className="flex items-center gap-2 shrink-0" role="group" aria-label={d.employee.menu.quantityAria(item.name)}>
                      <Button
                        variant="secondary"
                        size="icon"
                        onClick={() => onRemove(item)}
                        aria-label={d.employee.menu.removeOneAria(item.name)}
                        className="size-11 sm:size-9 active:scale-95"
                      >
                        <Minus className="size-4" />
                      </Button>
                      <span className="w-6 text-center text-sm font-semibold tabular-nums text-foreground" aria-live="polite">
                        {quantities?.[item.id] ?? 0}
                      </span>
                      <Button
                        size="icon"
                        onClick={() => onAdd(item)}
                        aria-label={d.employee.menu.addOneAria(item.name)}
                        className="size-11 sm:size-9 active:scale-95"
                      >
                        <Plus className="size-4" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => onAdd(item)}
                      aria-label={d.employee.menu.addItemAria(item.name)}
                      className="h-10 sm:h-9 active:scale-95 shrink-0"
                    >
                      <Plus className="size-3.5" />
                      <span>{d.employee.menu.add}</span>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      )}
    </section>
  )
}
