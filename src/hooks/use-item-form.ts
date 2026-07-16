// Estado de um formulário de item do menu (criar OU editar). Junta os 9 campos,
// a mensagem de erro e a flag de gravação que antes eram ~11 useState soltos no
// admin-dashboard. A validação e o payload continuam em `lib/item-form.ts`.

import { useState } from 'react'
import type { MenuItem } from '../@types/menu-item'
import type { ItemFormFields } from '../lib/item-form'

function emptyFields(): ItemFormFields {
  return {
    name: '', description: '', price: '', categoryId: '',
    discount: '', vat: '', ingredients: [], tags: [], rodizio: false, image: '',
  }
}

// Converte um item guardado para os campos do form (tudo em string nos inputs).
function fieldsFromItem(item: MenuItem): ItemFormFields {
  return {
    name: item.name,
    description: item.description,
    price: String(item.price),
    categoryId: item.categoryId,
    discount: item.discount != null ? String(item.discount) : '',
    vat: item.vatRate != null ? String(item.vatRate) : '',
    ingredients: item.removableIngredients ?? [],
    tags: item.tags ?? [],
    rodizio: item.rodizioAvailable ?? false,
    image: item.image ?? '',
  }
}

export function useItemForm() {
  const [fields, setFields] = useState<ItemFormFields>(emptyFields)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  function setField<K extends keyof ItemFormFields>(key: K, value: ItemFormFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }))
  }

  // reset = campos vazios (criar); load = carregar de um item (editar).
  function reset() {
    setFields(emptyFields())
    setError('')
  }
  function load(item: MenuItem) {
    setFields(fieldsFromItem(item))
    setError('')
  }

  return { fields, setField, error, setError, saving, setSaving, reset, load }
}
