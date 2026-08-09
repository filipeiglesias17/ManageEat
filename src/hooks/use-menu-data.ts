import { useEffect, useState } from 'react'
import type { MenuItem } from '../@types/menu-item'
import type { Category } from '../@types/category'
import { subscribeMenuItems, subscribeCategories } from '../lib/db'

export function useMenuData() {
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  // loading distingue "ainda não chegou o 1.º snapshot" de "menu mesmo vazio",
  // para a UI não mostrar "Nenhum item" antes do primeiro carregamento.
  const [loading, setLoading] = useState(true)

  // Tempo real (onSnapshot) em vez de fetch único: se o admin mexer no menu, o
  // cliente/empregado vê logo, sem recarregar a página. O cleanup cancela as
  // subscrições quando o componente desmonta.
  useEffect(() => {
    let itemsLoaded = false
    let categoriesLoaded = false
    // Só saímos de loading quando ambos os primeiros snapshots chegaram.
    function markLoaded() {
      if (itemsLoaded && categoriesLoaded) setLoading(false)
    }
    const unsubscribeItems = subscribeMenuItems((items) => {
      setMenuItems(items)
      itemsLoaded = true
      markLoaded()
    })
    const unsubscribeCategories = subscribeCategories((cats) => {
      setCategories(cats)
      categoriesLoaded = true
      markLoaded()
    })
    return () => {
      unsubscribeItems()
      unsubscribeCategories()
    }
  }, [])

  return { menuItems, categories, available: menuItems.filter((i) => i.available), loading }
}
