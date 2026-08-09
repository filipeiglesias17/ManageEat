// Hook e helpers do carrinho. O estado vive no componente que chamar useCart()
// — não persiste entre páginas. Só o pedido final é que vai parar à base de dados.

import { useState, useEffect, useRef } from 'react'
import type { MenuItem } from '../@types/menu-item'
import type { CartItem } from '../@types/cart'
import type { DiscountType } from '../@types/order'
import type { RestaurantMode } from '../@types/settings'
import { randomHexId } from '../lib/helpers'
import { lineTotalForMode } from '../lib/pricing'
import { hapticTap } from '../lib/haptics'

// O cálculo de preços vive agora em `lib/pricing.ts`. Re-exportamos aqui para
// não partir os imports antigos (`from '../hooks/use-cart'`).
export { effectivePrice, effectiveItemPrice, lineTotalForMode, cartItemToOrderItem, buildOrderItems } from '../lib/pricing'

type CartValidationResult = {
  ok: boolean
  cart: CartItem[]
  message: string
}

export const MAX_CART_ITEM_QUANTITY = 99

function menuPriceChanged(previous: MenuItem, current: MenuItem): boolean {
  return previous.price !== current.price || previous.discount !== current.discount
}

function rodizioFlagChanged(previous: MenuItem, current: MenuItem, mode: RestaurantMode): boolean {
  if (mode !== 'rodizio') return false
  return previous.rodizioAvailable === true && current.rodizioAvailable !== true
    || previous.rodizioAvailable !== true && current.rodizioAvailable === true
}

export function validateCartAgainstMenu(
  cart: CartItem[],
  latestMenuItems: MenuItem[],
  mode: RestaurantMode,
): CartValidationResult {
  const latestById = new Map(latestMenuItems.map((item) => [item.id, item]))
  const issues: string[] = []
  const nextCart: CartItem[] = []

  cart.forEach((cartItem) => {
    const latest = latestById.get(cartItem.menuItem.id)
    if (!latest) {
      issues.push(`${cartItem.menuItem.name} já não existe no menu`)
      return
    }

    if (!latest.available) {
      issues.push(`${latest.name} ficou indisponível`)
      return
    }

    if (menuPriceChanged(cartItem.menuItem, latest)) {
      issues.push(`${latest.name} mudou de preço/desconto`)
    }

    if (rodizioFlagChanged(cartItem.menuItem, latest, mode)) {
      issues.push(`${latest.name} mudou no rodízio`)
    }

    const allowedIngredients = new Set(latest.removableIngredients ?? [])
    const validRemovedIngredients = cartItem.removedIngredients.filter((ingredient) => allowedIngredients.has(ingredient))
    if (validRemovedIngredients.length !== cartItem.removedIngredients.length) {
      issues.push(`${latest.name} tem ingredientes removidos que já não existem`)
    }

    if (cartItem.quantity > MAX_CART_ITEM_QUANTITY) {
      issues.push(`${latest.name} tem quantidade acima do limite (${MAX_CART_ITEM_QUANTITY})`)
    }

    nextCart.push({
      ...cartItem,
      menuItem: latest,
      quantity: Math.min(cartItem.quantity, MAX_CART_ITEM_QUANTITY),
      removedIngredients: validRemovedIngredients,
    })
  })

  if (issues.length === 0) {
    return { ok: true, cart: nextCart, message: '' }
  }

  const visibleIssues = issues.slice(0, 3).join('; ')
  const suffix = issues.length > 3 ? ` e mais ${issues.length - 3} alteração(ões)` : ''

  return {
    ok: false,
    cart: nextCart,
    message: `O menu mudou desde que adicionaste itens ao carrinho: ${visibleIssues}${suffix}. Revê o carrinho antes de pedir.`,
  }
}

// `mode` decide se os itens de rodízio entram no total a 0. Default 'normal'
// mantém o comportamento à la carte para quem chamar useCart() sem o passar.
export function useCart(mode: RestaurantMode = 'normal', sessionId?: string) {
  const cartKey = sessionId ? `manageEat_cart_${sessionId}` : 'manageEat_cart'

  // Inicializar o carrinho lendo do sessionStorage, prevenindo a perda do 
  // pedido se o telemóvel do cliente recarregar a página.
  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const saved = sessionStorage.getItem(cartKey)
      if (saved) return JSON.parse(saved)
    } catch {
      // Falhas no parse (dados corrompidos) recaem para carrinho vazio
    }
    return []
  })

  // Ref para saber qual a chave que está carregada no estado 'cart' atual.
  // Evita que ao mudar a sessionId, o useEffect de escrita grave o carrinho
  // antigo na chave da nova sessão.
  const loadedKeyRef = useRef(cartKey)

  useEffect(() => {
    if (loadedKeyRef.current !== cartKey) {
      try {
        const saved = sessionStorage.getItem(cartKey)
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Carregar o estado do carrinho da nova sessão QR de forma síncrona
        setCart(saved ? JSON.parse(saved) : [])
      } catch {
        setCart([])
      }
      loadedKeyRef.current = cartKey
    }
  }, [cartKey])

  // Espelhar sempre o estado do carrinho no sessionStorage
  useEffect(() => {
    if (loadedKeyRef.current === cartKey) {
      sessionStorage.setItem(cartKey, JSON.stringify(cart))
    }
  }, [cart, cartKey])

  // No modo rodízio o total do carrinho é só dos extras (itens não incluídos).
  const total = cart.reduce((acc, c) => acc + lineTotalForMode(c, mode) * c.quantity, 0)
  // Soma das quantidades (não o nº de linhas) — para o badge "X items" contar
  // unidades, como num carrinho de loja: 3 hambúrgueres = 3 items, não 1.
  const count = cart.reduce((acc, c) => acc + c.quantity, 0)

  // Quantidade da linha "plain" (sem personalização) por id de item. Alimenta o
  // stepper inline no menu; as linhas personalizadas geram-se/editam-se só no carrinho.
  const plainQuantities = cart.reduce<Record<string, number>>((acc, c) => {
    if (c.removedIngredients.length === 0 && c.notes === '' && !c.itemDiscount) {
      acc[c.menuItem.id] = c.quantity
    }
    return acc
  }, {})

  function addToCart(item: MenuItem) {
    // Toque leve ao adicionar (no-op na web): feedback imediato num único sítio,
    // em vez de cada ecrã que adiciona ao carrinho repetir a chamada.
    void hapticTap()
    setCart((prev) => {
      // Só agrupa (incrementa quantity) com uma linha existente se essa linha
      // ainda não tiver personalizações. Assim o user pode pedir, p.ex.,
      // "1 burger sem cebola" e "1 burger com tudo" como linhas distintas.
      const plain = prev.find((c) =>
        c.menuItem.id === item.id &&
        c.removedIngredients.length === 0 &&
        c.notes === '' &&
        !c.itemDiscount
      )
      if (plain) {
        return prev.map((c) => (
          c.uid === plain.uid
            ? { ...c, quantity: Math.min(c.quantity + 1, MAX_CART_ITEM_QUANTITY) }
            : c
        ))
      }
      return [...prev, { uid: randomHexId(6), menuItem: item, quantity: 1, notes: '', removedIngredients: [] }]
    })
  }

  // Espelho do addToCart para o stepper inline do menu: tira 1 unidade à linha
  // "plain" (sem personalização) deste item. Quando chega a 0, a linha desaparece
  // e o card volta ao botão "Adicionar".
  function decrementFromCart(itemId: string) {
    setCart((prev) => {
      const plain = prev.find((c) =>
        c.menuItem.id === itemId &&
        c.removedIngredients.length === 0 &&
        c.notes === '' &&
        !c.itemDiscount
      )
      if (!plain) return prev
      return prev
        .map((c) => c.uid === plain.uid ? { ...c, quantity: c.quantity - 1 } : c)
        .filter((c) => c.quantity > 0)
    })
  }

  function updateQty(uid: string, delta: number) {
    setCart((prev) =>
      prev
        .map((c) => c.uid === uid ? { ...c, quantity: Math.min(c.quantity + delta, MAX_CART_ITEM_QUANTITY) } : c)
        .filter((c) => c.quantity > 0)
    )
  }

  function updateNotes(uid: string, notes: string) {
    setCart((prev) =>
      prev.map((c) => c.uid === uid ? { ...c, notes } : c)
    )
  }

  function updateItemDiscount(uid: string, type: DiscountType, value: number) {
    // Percentagem acima de 100 fica em 100. O preço já era clampado em
    // effectiveItemPrice, mas o valor original ia tal e qual para o pedido
    // e aparecia no admin como "-150%".
    const safeValue = type === 'percent' ? Math.min(value, 100) : value
    setCart((prev) => prev.map((c) =>
      c.uid === uid
        ? { ...c, itemDiscount: safeValue > 0 ? { type, value: safeValue } : undefined }
        : c
    ))
  }

  function toggleIngredient(uid: string, ingredient: string) {
    setCart((prev) => prev.map((c) => {
      if (c.uid !== uid) return c
      const already = c.removedIngredients.includes(ingredient)
      return {
        ...c,
        removedIngredients: already
          ? c.removedIngredients.filter((i) => i !== ingredient)
          : [...c.removedIngredients, ingredient],
      }
    }))
  }

  return { cart, setCart, total, count, plainQuantities, addToCart, decrementFromCart, updateQty, updateNotes, toggleIngredient, updateItemDiscount }
}
