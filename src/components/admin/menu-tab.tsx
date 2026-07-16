import { useState, type FormEvent } from 'react'
import { PlusCircle, Pencil, ToggleRight, ToggleLeft, Trash } from 'lucide-react'
import type { MenuItem } from '../../@types/menu-item'
import type { Category } from '../../@types/category'
import { createMenuItem, updateMenuItem, deleteMenuItem, deleteMenuImage } from '../../lib/db'
import { formatEuro } from '../../lib/helpers'
import { validateItemFields, buildItemPayload } from '../../lib/item-form'
import { useItemForm } from '../../hooks/use-item-form'
import { useConfirmingId } from '../../hooks/use-confirming-id'
import { useDict } from '../../lib/i18n'
import { Modal, ModalHeader } from '../modal'
import { TagInput } from '../tag-input'
import { ImageUploadField } from '../image-upload-field'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm-button'

interface MenuTabProps {
  menuItems: MenuItem[]
  categories: Category[]
  setMenuItems: React.Dispatch<React.SetStateAction<MenuItem[]>>
}

// ── Peças partilhadas entre a tabela (desktop) e os cartões (telemóvel) ──
// Recebem os handlers por props para as duas vistas usarem a mesma lógica.

type ItemHandlers = {
  onEdit: (item: MenuItem) => void
  onToggleAvailable: (item: MenuItem) => void
  onDelete: (item: MenuItem) => void
  // Confirmação inline (D5) de apagar — id do item em confirmação (não
  // booleano global, para não confirmar todas as linhas ao mesmo tempo).
  confirmingItemId: string | null
  onRequestDelete: (id: string) => void
  onCancelDelete: () => void
}

function ItemCategorySelect({
  item,
  categories,
  onChangeCategory,
}: {
  item: MenuItem
  categories: Category[]
  onChangeCategory: (item: MenuItem, categoryId: string) => void
}) {
  const d = useDict()
  const knownCategory = categories.find((c) => c.id === item.categoryId)
  return (
    <select
      value={item.categoryId}
      onChange={(e) => onChangeCategory(item, e.target.value)}
      aria-label={d.admin.menu.categoryOf(item.name)}
      className="bg-background border border-input rounded-sm px-2 py-1 text-sm text-foreground outline-none cursor-pointer hover:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {categories.map((cat) => (
        <option key={cat.id} value={cat.id}>{cat.name}</option>
      ))}
      {!knownCategory && (
        <option value={item.categoryId}>—</option>
      )}
    </select>
  )
}

function ItemPrice({ item }: { item: MenuItem }) {
  if (!item.discount) return <span>{formatEuro(item.price)}</span>
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground line-through">{formatEuro(item.price)}</span>
      <span className="font-medium">{formatEuro(item.price * (1 - item.discount / 100))}</span>
    </div>
  )
}

// Assume que item.discount existe — o chamador decide o placeholder "—".
function ItemDiscountBadge({ item }: { item: MenuItem }) {
  return (
    <span className="text-xs px-2 py-1 rounded-full font-medium bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300">
      -{item.discount}%
    </span>
  )
}

function ItemAvailabilityBadge({ item }: { item: MenuItem }) {
  const d = useDict()
  return (
    <span className={`text-xs px-2 py-1 rounded-full font-medium ${item.available ? 'bg-brand/15 text-brand' : 'bg-muted text-muted-foreground'}`}>
      {item.available ? d.admin.menu.available : d.admin.menu.unavailable}
    </span>
  )
}

function ItemActions({ item, onEdit, onToggleAvailable, onDelete, confirmingItemId, onRequestDelete, onCancelDelete }: { item: MenuItem } & ItemHandlers) {
  const d = useDict()
  const a = d.admin.menu.actions
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onEdit(item)}
        className="h-9 w-9 flex rounded-md justify-center items-center border border-border bg-secondary hover:bg-secondary/80"
        title={a.edit}
        aria-label={a.editOf(item.name)}
      >
        <Pencil className="size-4" />
      </button>
      <button
        onClick={() => onToggleAvailable(item)}
        className="h-9 w-9 flex rounded-md justify-center items-center border border-border bg-secondary hover:bg-secondary/80"
        title={item.available ? a.deactivate : a.activate}
        aria-label={item.available ? a.deactivateOf(item.name) : a.activateOf(item.name)}
      >
        {item.available
          ? <ToggleRight className="size-4 text-brand" />
          : <ToggleLeft className="size-4 text-muted-foreground" />
        }
      </button>
      <ConfirmButton
        confirming={confirmingItemId === item.id}
        onRequestConfirm={() => onRequestDelete(item.id)}
        onConfirm={() => onDelete(item)}
        onCancel={onCancelDelete}
        triggerIcon={<Trash className="size-4" />}
        triggerLabel={a.deleteOf(item.name)}
        triggerTitle={a.delete}
        triggerClassName="h-9 w-9 flex rounded-md justify-center items-center border border-border bg-secondary hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-colors"
        confirmIcon={<Trash className="size-4" />}
        confirmLabel={a.delete}
        confirmTitle={a.deleteConfirmTitle}
      />
    </div>
  )
}

// Cartão de item para ecrãs pequenos — os mesmos dados e ações da tabela.
function MenuItemCard({
  item,
  categories,
  onChangeCategory,
  ...handlers
}: {
  item: MenuItem
  categories: Category[]
  onChangeCategory: (item: MenuItem, categoryId: string) => void
} & ItemHandlers) {
  return (
    <li className="bg-card border border-border rounded-lg p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate" title={item.name}>{item.name}</p>
          {item.description && (
            <p className="text-xs text-muted-foreground line-clamp-1">{item.description}</p>
          )}
        </div>
        <ItemAvailabilityBadge item={item} />
      </div>
      <div className="flex items-center justify-between gap-2 text-sm">
        <ItemCategorySelect item={item} categories={categories} onChangeCategory={onChangeCategory} />
        <ItemPrice item={item} />
      </div>
      <div className="flex items-center justify-between gap-2">
        {item.discount ? <ItemDiscountBadge item={item} /> : <span />}
        <ItemActions item={item} {...handlers} />
      </div>
    </li>
  )
}

export function MenuTab({ menuItems, categories, setMenuItems }: MenuTabProps) {
  const d = useDict()
  const [showItemForm, setShowItemForm] = useState(false)
  const itemForm = useItemForm()

  const [editingItem, setEditingItem] = useState<MenuItem | null>(null)
  const editItemForm = useItemForm()
  // Confirmação inline (D5) de apagar item — por id, não booleano global.
  const deleteConfirm = useConfirmingId()

  async function handleCreateItem(e: FormEvent) {
    e.preventDefault()
    itemForm.setError('')
    const error = validateItemFields(itemForm.fields)
    if (error) { itemForm.setError(error); return }

    itemForm.setSaving(true)
    try {
      const created = await createMenuItem({ ...buildItemPayload(itemForm.fields), available: true })
      setMenuItems((prev) => [...prev, created])
      itemForm.reset()
      setShowItemForm(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      itemForm.setError(d.admin.menu.createModal.errorPrefix(msg))
    } finally {
      itemForm.setSaving(false)
    }
  }

  function openEditModal(item: MenuItem) {
    setEditingItem(item)
    editItemForm.load(item)
  }

  function closeEditModal() {
    setEditingItem(null)
    editItemForm.reset()
  }

  function handleCancelCreate() {
    if (itemForm.fields.image) {
      deleteMenuImage(itemForm.fields.image)
      itemForm.setField('image', '')
    }
    itemForm.setError('')
    setShowItemForm(false)
  }

  function handleCancelEdit() {
    const current = editItemForm.fields.image
    if (current && editingItem && current !== editingItem.image) deleteMenuImage(current)
    closeEditModal()
  }

  async function handleEditItem(e: FormEvent) {
    e.preventDefault()
    if (!editingItem) return
    editItemForm.setError('')
    const error = validateItemFields(editItemForm.fields)
    if (error) { editItemForm.setError(error); return }

    const data = buildItemPayload(editItemForm.fields)
    const previousImage = editingItem.image
    editItemForm.setSaving(true)
    try {
      await updateMenuItem(editingItem.id, data)
      setMenuItems((prev) => prev.map((i) => i.id === editingItem.id ? { ...i, ...data } : i))
      if (previousImage && previousImage !== data.image) await deleteMenuImage(previousImage)
      closeEditModal()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      editItemForm.setError(d.admin.menu.editModal.errorPrefix(msg))
    } finally {
      editItemForm.setSaving(false)
    }
  }

  async function handleDeleteItem(item: MenuItem) {
    await deleteMenuItem(item.id)
    setMenuItems((prev) => prev.filter((i) => i.id !== item.id))
    if (item.image) await deleteMenuImage(item.image)
    deleteConfirm.confirmed(item.id)
  }

  async function handleToggleAvailable(item: MenuItem) {
    const available = !item.available
    await updateMenuItem(item.id, { available })
    setMenuItems((prev) => prev.map((i) => i.id === item.id ? { ...i, available } : i))
  }

  async function handleChangeCategory(item: MenuItem, categoryId: string) {
    await updateMenuItem(item.id, { categoryId })
    const updated = { ...item, categoryId }
    setMenuItems((prev) => prev.map((i) => i.id === item.id ? updated : i))
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-bold">{d.admin.menu.title}</h1>
        <Button size="lg" onClick={() => setShowItemForm(true)}>
          <PlusCircle />
          {d.admin.menu.addButton}
        </Button>
      </div>

      {/* Tabela só em ecrã largo; no telemóvel a lista de cartões abaixo
          mostra os mesmos dados sem scroll horizontal. */}
      <div className="hidden sm:block bg-card border border-border rounded-lg overflow-hidden shadow-sm mb-4">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-sm min-w-[480px]">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left py-4 px-5 font-semibold text-foreground">{d.admin.menu.columns.name}</th>
                <th className="text-left py-4 px-5 font-semibold text-foreground">{d.admin.menu.columns.category}</th>
                <th className="text-left py-4 px-5 font-semibold text-foreground">{d.admin.menu.columns.price}</th>
                <th className="text-left py-4 px-5 font-semibold text-foreground">{d.admin.menu.columns.discount}</th>
                <th className="text-left py-4 px-5 font-semibold text-foreground">{d.admin.menu.columns.status}</th>
                <th className="text-left py-4 px-5 font-semibold text-foreground">{d.admin.menu.columns.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {menuItems.map((item) => (
                <tr key={item.id} className="hover:bg-accent transition-colors">
                  <td className="py-3 px-5">
                    <div className="flex flex-col gap-0.5 min-w-0 max-w-[240px]">
                      <span className="font-medium truncate" title={item.name}>{item.name}</span>
                      <span className="text-xs text-muted-foreground line-clamp-1">{item.description}</span>
                    </div>
                  </td>
                  <td className="py-3 px-5">
                    <ItemCategorySelect item={item} categories={categories} onChangeCategory={handleChangeCategory} />
                  </td>
                  <td className="py-3 px-4">
                    <ItemPrice item={item} />
                  </td>
                  <td className="py-3 px-4">
                    {item.discount ? <ItemDiscountBadge item={item} /> : <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                  <td className="py-3 px-4">
                    <ItemAvailabilityBadge item={item} />
                  </td>
                  <td className="py-3 px-4">
                    <ItemActions
                      item={item}
                      onEdit={openEditModal}
                      onToggleAvailable={handleToggleAvailable}
                      onDelete={handleDeleteItem}
                      confirmingItemId={deleteConfirm.confirmingId}
                      onRequestDelete={deleteConfirm.requestConfirm}
                      onCancelDelete={deleteConfirm.cancel}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ul className="sm:hidden space-y-2">
        {menuItems.map((item) => (
          <MenuItemCard
            key={item.id}
            item={item}
            categories={categories}
            onChangeCategory={handleChangeCategory}
            onEdit={openEditModal}
            onToggleAvailable={handleToggleAvailable}
            onDelete={handleDeleteItem}
            confirmingItemId={deleteConfirm.confirmingId}
            onRequestDelete={deleteConfirm.requestConfirm}
            onCancelDelete={deleteConfirm.cancel}
          />
        ))}
      </ul>

      {/* ══ Modal: Criar Item ══ */}
      {showItemForm && (
        <Modal maxWidth="max-w-md" onClose={handleCancelCreate} aria-labelledby="new-item-title">
          <ModalHeader title={d.admin.menu.createModal.title} titleId="new-item-title" closeDisabled={itemForm.saving} />
          <form onSubmit={handleCreateItem} className="flex flex-col gap-5">
            <label className="flex flex-col gap-1">
              <span className="text-sm text-muted-foreground">{d.admin.menu.form.nameLabel}</span>
              <input
                value={itemForm.fields.name}
                onChange={(e) => itemForm.setField('name', e.target.value)}
                className="border border-input rounded-sm px-3 py-2 bg-background text-foreground w-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-sm text-muted-foreground">{d.admin.menu.form.descriptionLabel}</span>
              <input
                value={itemForm.fields.description}
                onChange={(e) => itemForm.setField('description', e.target.value)}
                className="border border-input rounded-sm px-3 py-2 bg-background text-foreground w-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </label>

            <ImageUploadField
              value={itemForm.fields.image}
              onChange={(url) => itemForm.setField('image', url)}
            />

            <div className="flex gap-4">
              <label className="flex flex-col gap-1 flex-1">
                <span className="text-sm text-muted-foreground">{d.admin.menu.form.priceLabel}</span>
                <input
                  value={itemForm.fields.price}
                  onChange={(e) => itemForm.setField('price', e.target.value)}
                  type="number"
                  step="0.01"
                  min="0"
                  className="border border-input rounded-sm px-3 py-2 bg-background text-foreground w-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </label>
              <label className="flex flex-col gap-1 flex-1">
                <span className="text-sm text-muted-foreground">{d.admin.menu.form.discountLabel}</span>
                <input
                  value={itemForm.fields.discount}
                  onChange={(e) => itemForm.setField('discount', e.target.value)}
                  type="number"
                  min="0"
                  max="100"
                  placeholder={d.admin.menu.form.discountPlaceholder}
                  className="border border-input rounded-sm px-3 py-2 bg-background text-foreground w-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </label>
              <label className="flex flex-col gap-1 flex-1">
                <span className="text-sm text-muted-foreground">{d.admin.menu.form.vatLabel}</span>
                <input
                  value={itemForm.fields.vat}
                  onChange={(e) => itemForm.setField('vat', e.target.value)}
                  type="number"
                  min="0"
                  max="100"
                  placeholder={d.admin.menu.form.vatPlaceholder}
                  className="border border-input rounded-sm px-3 py-2 bg-background text-foreground w-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </label>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-sm text-muted-foreground">{d.admin.menu.form.categoryLabel}</span>
              <select
                value={itemForm.fields.categoryId}
                onChange={(e) => itemForm.setField('categoryId', e.target.value)}
                className="border border-input rounded-sm px-3 py-2 bg-background text-foreground w-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="">{d.admin.menu.form.categoryPlaceholder}</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </label>

            <div className="flex flex-col gap-2">
              <label className="text-sm text-muted-foreground">{d.admin.menu.form.ingredientsLabel}</label>
              <TagInput
                tags={itemForm.fields.ingredients}
                onChange={(v) => itemForm.setField('ingredients', v)}
                placeholder={d.admin.menu.form.ingredientsPlaceholder}
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm text-muted-foreground">{d.admin.menu.form.tagsLabel}</label>
              <TagInput
                tags={itemForm.fields.tags}
                onChange={(v) => itemForm.setField('tags', v)}
                placeholder={d.admin.menu.form.tagsPlaceholder}
              />
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={itemForm.fields.rodizio}
                onChange={(e) => itemForm.setField('rodizio', e.target.checked)}
                className="accent-brand w-4 h-4 rounded"
              />
              <span className="text-sm text-muted-foreground">{d.admin.menu.form.rodizioLabel}</span>
            </label>

            {itemForm.error && <Alert variant="destructive">{itemForm.error}</Alert>}

            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={handleCancelCreate}>
                {d.common.cancel}
              </Button>
              <Button type="submit" disabled={itemForm.saving}>
                {itemForm.saving ? d.admin.menu.createModal.submitting : d.admin.menu.createModal.submit}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* ══ Modal: Editar Item ══ */}
      {editingItem && (
        <Modal maxWidth="max-w-md" onClose={handleCancelEdit} aria-labelledby="edit-item-title">
          <ModalHeader title={d.admin.menu.editModal.title} titleId="edit-item-title" closeDisabled={editItemForm.saving} />
          <form onSubmit={handleEditItem} className="flex flex-col gap-5">
            <label className="flex flex-col gap-1">
              <span className="text-sm text-muted-foreground">{d.admin.menu.form.nameLabel}</span>
              <input
                value={editItemForm.fields.name}
                onChange={(e) => editItemForm.setField('name', e.target.value)}
                className="border border-input rounded-sm px-3 py-2 bg-background text-foreground w-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-sm text-muted-foreground">{d.admin.menu.form.descriptionLabel}</span>
              <input
                value={editItemForm.fields.description}
                onChange={(e) => editItemForm.setField('description', e.target.value)}
                className="border border-input rounded-sm px-3 py-2 bg-background text-foreground w-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </label>

            <ImageUploadField
              value={editItemForm.fields.image}
              onChange={(url) => editItemForm.setField('image', url)}
            />

            <div className="flex gap-4">
              <label className="flex flex-col gap-1 flex-1">
                <span className="text-sm text-muted-foreground">{d.admin.menu.form.priceLabel}</span>
                <input
                  value={editItemForm.fields.price}
                  onChange={(e) => editItemForm.setField('price', e.target.value)}
                  type="number"
                  step="0.01"
                  min="0"
                  className="border border-input rounded-sm px-3 py-2 bg-background text-foreground w-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </label>
              <label className="flex flex-col gap-1 flex-1">
                <span className="text-sm text-muted-foreground">{d.admin.menu.form.discountLabel}</span>
                <input
                  value={editItemForm.fields.discount}
                  onChange={(e) => editItemForm.setField('discount', e.target.value)}
                  type="number"
                  min="0"
                  max="100"
                  placeholder={d.admin.menu.form.discountPlaceholder}
                  className="border border-input rounded-sm px-3 py-2 bg-background text-foreground w-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </label>
              <label className="flex flex-col gap-1 flex-1">
                <span className="text-sm text-muted-foreground">{d.admin.menu.form.vatLabel}</span>
                <input
                  value={editItemForm.fields.vat}
                  onChange={(e) => editItemForm.setField('vat', e.target.value)}
                  type="number"
                  min="0"
                  max="100"
                  placeholder={d.admin.menu.form.vatPlaceholder}
                  className="border border-input rounded-sm px-3 py-2 bg-background text-foreground w-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </label>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-sm text-muted-foreground">{d.admin.menu.form.categoryLabel}</span>
              <select
                value={editItemForm.fields.categoryId}
                onChange={(e) => editItemForm.setField('categoryId', e.target.value)}
                className="border border-input rounded-sm px-3 py-2 bg-background text-foreground w-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="">{d.admin.menu.form.categoryPlaceholder}</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </label>

            <div className="flex flex-col gap-2">
              <label className="text-sm text-muted-foreground">{d.admin.menu.form.ingredientsLabel}</label>
              <TagInput
                tags={editItemForm.fields.ingredients}
                onChange={(v) => editItemForm.setField('ingredients', v)}
                placeholder={d.admin.menu.form.ingredientsPlaceholder}
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm text-muted-foreground">{d.admin.menu.form.tagsLabel}</label>
              <TagInput
                tags={editItemForm.fields.tags}
                onChange={(v) => editItemForm.setField('tags', v)}
                placeholder={d.admin.menu.form.tagsPlaceholder}
              />
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={editItemForm.fields.rodizio}
                onChange={(e) => editItemForm.setField('rodizio', e.target.checked)}
                className="accent-brand w-4 h-4 rounded"
              />
              <span className="text-sm text-muted-foreground">{d.admin.menu.form.rodizioLabel}</span>
            </label>

            {editItemForm.error && <Alert variant="destructive">{editItemForm.error}</Alert>}

            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={handleCancelEdit}>
                {d.common.cancel}
              </Button>
              <Button type="submit" disabled={editItemForm.saving}>
                {editItemForm.saving ? d.admin.menu.editModal.submitting : d.admin.menu.editModal.submit}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}
