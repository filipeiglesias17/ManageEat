import { supabase } from '../supabase'
import type { Category } from '../../@types/category'
import type { MenuItem } from '../../@types/menu-item'
import { dict } from '../i18n'
import { throwOnError, subscribeTable, type TableInsert, type TableUpdate } from './base'
import { toStablePublicStorageReference } from '../storage-url'

// Bucket das imagens do menu
const MENU_IMAGES_BUCKET = 'menu-images'

//  Categorias

function rowToCategory(r: Record<string, unknown>): Category {
  const category: Category = { id: r.id as string, name: r.name as string }
  if (r.color != null) category.color = r.color as string
  return category
}

export async function getCategories(): Promise<Category[]> {
  const { data, error } = await supabase.from('categories').select('*')
  throwOnError(error)
  return (data ?? []).map(rowToCategory)
}

export function subscribeCategories(callback: (categories: Category[]) => void): () => void {
  return subscribeTable('categories', getCategories, callback)
}

export async function createCategory(name: string, color?: string): Promise<Category> {
  const row: Record<string, unknown> = { name }
  if (color !== undefined) row.color = color
  const { data, error } = await supabase.from('categories').insert(row as TableInsert<'categories'>).select().single()
  throwOnError(error)
  return rowToCategory(data as Record<string, unknown>)
}

export async function updateCategory(id: string, name: string, color?: string): Promise<void> {
  const row: Record<string, unknown> = { name }
  if (color !== undefined) row.color = color
  const { error } = await supabase.from('categories').update(row as TableUpdate<'categories'>).eq('id', id)
  throwOnError(error)
}

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase.from('categories').delete().eq('id', id)
  throwOnError(error)
}

//  Menu Items

function rowToMenuItem(r: Record<string, unknown>): MenuItem {
  const item: MenuItem = {
    id: r.id as string,
    name: r.name as string,
    description: r.description as string,
    price: Number(r.price),
    categoryId: r.category_id as string,
    available: r.available as boolean,
    discount: r.discount === null || r.discount === undefined ? null : Number(r.discount),
  }
  if (r.removable_ingredients != null) item.removableIngredients = r.removable_ingredients as string[]
  if (r.tags != null) item.tags = r.tags as string[]
  if (r.rodizio_available != null) item.rodizioAvailable = r.rodizio_available as boolean
  if (r.vat_rate != null) item.vatRate = Number(r.vat_rate)
  if (r.image != null) item.image = r.image as string
  return item
}

function menuItemToRow(data: Partial<Omit<MenuItem, 'id'>>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if ('name' in data) row.name = data.name
  if ('description' in data) row.description = data.description
  if ('price' in data) row.price = data.price
  if ('categoryId' in data) row.category_id = data.categoryId
  if ('available' in data) row.available = data.available
  if ('discount' in data) row.discount = data.discount
  if ('removableIngredients' in data) row.removable_ingredients = data.removableIngredients
  if ('tags' in data) row.tags = data.tags
  if ('rodizioAvailable' in data) row.rodizio_available = data.rodizioAvailable
  if ('vatRate' in data) row.vat_rate = data.vatRate
  if ('image' in data) {
    row.image = typeof data.image === 'string'
      ? toStablePublicStorageReference(data.image)
      : data.image
  }
  return row
}

export async function getMenuItems(): Promise<MenuItem[]> {
  const { data, error } = await supabase.from('menu_items').select('*')
  throwOnError(error)
  return (data ?? []).map(rowToMenuItem)
}

export function subscribeMenuItems(callback: (items: MenuItem[]) => void): () => void {
  return subscribeTable('menu_items', getMenuItems, callback)
}

export async function createMenuItem(data: Omit<MenuItem, 'id'>): Promise<MenuItem> {
  const { data: row, error } = await supabase.from('menu_items').insert(menuItemToRow(data) as TableInsert<'menu_items'>).select().single()
  throwOnError(error)
  return rowToMenuItem(row as Record<string, unknown>)
}

export async function updateMenuItem(id: string, data: Partial<Omit<MenuItem, 'id'>>): Promise<void> {
  const { error } = await supabase.from('menu_items').update(menuItemToRow(data) as TableUpdate<'menu_items'>).eq('id', id)
  throwOnError(error)
}

export async function deleteMenuItem(id: string): Promise<void> {
  const { error } = await supabase.from('menu_items').delete().eq('id', id)
  throwOnError(error)
}

//  Imagens do menu (Storage)

// Quantas vezes tentar o upload antes de desistir. Só repetimos em falhas
// transitórias (rede instável / servidor 5xx); erros permanentes (sem permissão,
// pedido inválido) falham logo com a mensagem do servidor.
const MAX_UPLOAD_ATTEMPTS = 3

// Decide se vale a pena repetir o upload. Um estado HTTP 4xx (ex.: 403 sem
// permissão, 400 pedido inválido) é permanente  repetir não ajuda. Sem estado
// numérico assume-se falha de rede (o fetch nem chegou ao fim), que é transitória.
function isTransientStorageError(error: unknown): boolean {
  const raw = (error as { statusCode?: number | string })?.statusCode
    ?? (error as { status?: number | string })?.status
  const status = typeof raw === 'string' ? Number(raw) : raw
  if (typeof status === 'number' && !Number.isNaN(status)) return status >= 500
  return true
}

export async function uploadMenuImage(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'

  let lastError: { message: string } | null = null
  for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt++) {
    // Caminho NOVO a cada tentativa: se uma tentativa anterior afinal chegou ao
    // servidor mas a resposta perdeu-se, não colidimos nem duplicamos o item  no
    // pior caso fica uma imagem órfã no storage, que é inofensiva.
    const path = `${crypto.randomUUID()}.${ext}`
    const { data, error } = await supabase.storage
      .from(MENU_IMAGES_BUCKET)
      .upload(path, file, { contentType: file.type || undefined, upsert: false })

    if (!error) {
      // Confirmar que o objeto foi MESMO criado antes de devolver a URL:
      // getPublicUrl() constrói sempre uma string, exista o ficheiro ou não  sem
      // esta verificação podíamos gravar no item uma URL que aponta para nada.
      if (!data?.path) throw new Error(dict().errors.menuImageUploadNotConfirmed)
      const publicUrl = supabase.storage.from(MENU_IMAGES_BUCKET).getPublicUrl(data.path).data.publicUrl
      return toStablePublicStorageReference(publicUrl)
    }

    lastError = error as { message: string }
    // Erro permanente, ou esgotámos as tentativas → desiste já com esse erro.
    if (!isTransientStorageError(error) || attempt === MAX_UPLOAD_ATTEMPTS) break
    // Backoff curto antes de repetir: 300ms, depois 600ms.
    await new Promise((resolve) => setTimeout(resolve, attempt * 300))
  }

  throwOnError(lastError)
  // throwOnError já lançou (lastError nunca é null aqui); este throw é só para o
  // TypeScript perceber que a função nunca chega ao fim sem devolver nem lançar.
  throw new Error(dict().errors.menuImageUploadFailed)
}

export async function deleteMenuImage(url: string): Promise<void> {
  const marker = `/${MENU_IMAGES_BUCKET}/`
  const idx = url.indexOf(marker)
  if (idx === -1) return
  const path = url.slice(idx + marker.length)
  if (!path) return
  try {
    await supabase.storage.from(MENU_IMAGES_BUCKET).remove([path])
  } catch {
    // Ignorado de propósito: imagem órfã é apenas um detalhe
  }
}
