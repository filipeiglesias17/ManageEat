// Validação e construção do payload de um item do menu — partilhado pelos forms
// de CRIAR e EDITAR no admin. Antes esta lógica estava copiada nos dois
// handlers; se uma mudasse e a outra não, criar e editar passavam a aceitar
// coisas diferentes. Aqui há uma só fonte de verdade, pura e testável.
//
// As mensagens de erro vêm do dicionário (`dict()`, fora do React) para saírem
// no idioma ativo mesmo sendo chamadas de um handler de formulário, não de um
// render — ver src/lib/i18n/index.ts.

import { dict } from './i18n'

// Campos do form como o utilizador os escreve (vêm de inputs, logo strings).
export type ItemFormFields = {
  name: string
  description: string
  price: string
  categoryId: string
  discount: string
  vat: string
  ingredients: string[]
  tags: string[]
  rodizio: boolean
  image: string  // referência/URL pública da imagem ('' = sem imagem)
}

// Dados prontos a gravar (já convertidos). Não inclui `available`: criar liga-o
// a true; editar não lhe toca (mantém o estado atual do item).
export type ItemPayload = {
  name: string
  description: string
  price: number
  categoryId: string
  discount: number | null
  removableIngredients: string[]
  tags: string[]
  rodizioAvailable: boolean
  vatRate?: number
  image: string | null
}

// Devolve a mensagem de erro (a mesma no criar e no editar) ou null se válido.
export function validateItemFields(fields: ItemFormFields): string | null {
  const errors = dict().admin.menu.form.errors
  if (fields.name.trim().length < 2) return errors.nameTooShort
  if (!fields.price || isNaN(Number(fields.price)) || Number(fields.price) <= 0) return errors.invalidPrice
  if (!fields.categoryId) return errors.categoryRequired
  // Desconto é percentagem — só aceita 0–100. Vazio significa "sem desconto".
  if (fields.discount !== '') {
    const d = Number(fields.discount)
    if (isNaN(d) || d < 0 || d > 100) return errors.discountRange
  }
  // IVA é percentagem — vazio significa "usar a taxa por defeito do restaurante".
  if (fields.vat !== '') {
    const v = Number(fields.vat)
    if (isNaN(v) || v < 0 || v > 100) return errors.vatRange
  }
  return null
}

export function buildItemPayload(fields: ItemFormFields): ItemPayload {
  const payload: ItemPayload = {
    name: fields.name.trim(),
    description: fields.description.trim(),
    price: Number(fields.price),
    categoryId: fields.categoryId,
    discount: fields.discount !== '' ? Number(fields.discount) : null,
    removableIngredients: fields.ingredients,
    tags: fields.tags,
    rodizioAvailable: fields.rodizio,
    // '' no form significa "sem imagem" → grava null para limpar a coluna.
    image: fields.image.trim() ? fields.image.trim() : null,
  }
  // vatRate só quando definido: vazio = seguir a taxa por defeito do restaurante.
  if (fields.vat !== '') payload.vatRate = Number(fields.vat)
  return payload
}
