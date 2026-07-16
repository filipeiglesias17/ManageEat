import { useState, type FormEvent } from 'react'
import { PlusCircle, Trash, Check, Pencil } from 'lucide-react'
import type { Category } from '../../@types/category'
import type { MenuItem } from '../../@types/menu-item'
import { createCategory, deleteCategory, updateCategory } from '../../lib/db'
import { useConfirmingId } from '../../hooks/use-confirming-id'
import { useDict } from '../../lib/i18n'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm-button'

interface CategoriesTabProps {
  categories: Category[]
  menuItems: MenuItem[]
  setCategories: React.Dispatch<React.SetStateAction<Category[]>>
}

function ColorSwatch({ color, onChange }: { color: string; onChange: (c: string) => void }) {
  const d = useDict()
  return (
    <label className="relative cursor-pointer shrink-0" title={d.admin.categories.colorPickerTitle}>
      <div className="w-8 h-8 rounded-sm border-2 border-input hover:border-ring transition-colors" style={{ background: color }} />
      <input
        type="color"
        value={color}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
      />
    </label>
  )
}

// ── Peças partilhadas entre a tabela (desktop) e os cartões (telemóvel) ──
// Recebem o estado de edição e os handlers por props: as duas vistas usam a
// mesma lógica de renomear/apagar.

type EditingCategory = { id: string; name: string; color: string } | null

type CategoryPieceProps = {
  cat: Category
  editingCat: EditingCategory
  renameError: string
  onEditingChange: (next: EditingCategory) => void
  onRename: () => void
  onStartRename: (cat: Category) => void
  onDelete: (id: string) => void
  // Confirmação inline (D5) de apagar: id da categoria em confirmação (não
  // booleano global) + mensagem dinâmica (varia se a categoria tem itens).
  confirmingCatId: string | null
  deleteConfirmMessage: (cat: Category) => string
  // Aviso VISÍVEL durante a confirmação (o tooltip da mensagem não abre em
  // tablet); só existe quando a categoria tem itens, que ficam órfãos.
  deleteConfirmHint: (cat: Category) => string | undefined
  onRequestDelete: (id: string) => void
  onCancelDelete: () => void
}

// Nome da categoria: bolinha de cor + nome, ou o editor inline quando esta
// categoria está a ser renomeada.
type CategoryNameFieldProps = Pick<CategoryPieceProps, 'cat' | 'editingCat' | 'renameError' | 'onEditingChange' | 'onRename'>

function CategoryNameField({ cat, editingCat, renameError, onEditingChange, onRename }: CategoryNameFieldProps) {
  const d = useDict()
  if (editingCat?.id === cat.id) {
    return (
      <div className="flex items-center gap-2">
        <ColorSwatch color={editingCat.color} onChange={(c) => onEditingChange({ ...editingCat, color: c })} />
        <input
          value={editingCat.name}
          onChange={(e) => onEditingChange({ ...editingCat, name: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && onRename()}
          autoFocus
          aria-label={d.admin.categories.renameInputLabel(cat.name)}
          className="border border-input rounded-sm px-2 py-1 bg-background text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 text-sm"
        />
        {renameError && <span className="text-destructive text-xs">{renameError}</span>}
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-3 h-3 rounded-full shrink-0" style={{ background: cat.color ?? '#71717a' }} />
      <span className="font-medium">{cat.name}</span>
    </div>
  )
}

function CategoryActions({
  cat,
  editingCat,
  onRename,
  onStartRename,
  onDelete,
  confirmingCatId,
  deleteConfirmMessage,
  deleteConfirmHint,
  onRequestDelete,
  onCancelDelete,
}: Omit<CategoryPieceProps, 'renameError' | 'onEditingChange'>) {
  const d = useDict()
  const a = d.admin.categories.actions
  return (
    <div className="flex items-center gap-2">
      {editingCat?.id === cat.id ? (
        <button
          onClick={onRename}
          className="h-8 w-8 flex rounded-md justify-center items-center border border-border bg-secondary hover:bg-secondary/80"
          title={a.confirmRename}
          aria-label={a.confirmRenameOf(cat.name)}
        >
          <Check className="size-4 text-brand" />
        </button>
      ) : (
        <button
          onClick={() => onStartRename(cat)}
          className="h-9 w-9 flex rounded-md justify-center items-center border border-border bg-secondary hover:bg-secondary/80"
          title={a.rename}
          aria-label={a.renameOf(cat.name)}
        >
          <Pencil className="size-4" />
        </button>
      )}
      <ConfirmButton
        confirming={confirmingCatId === cat.id}
        onRequestConfirm={() => onRequestDelete(cat.id)}
        onConfirm={() => onDelete(cat.id)}
        onCancel={onCancelDelete}
        triggerIcon={<Trash className="size-4" />}
        triggerLabel={a.deleteOf(cat.name)}
        triggerTitle={a.delete}
        triggerClassName="h-9 w-9 flex rounded-md justify-center items-center border border-border bg-secondary hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-colors"
        confirmIcon={<Trash className="size-4" />}
        confirmLabel={a.delete}
        confirmTitle={deleteConfirmMessage(cat)}
        confirmHint={deleteConfirmHint(cat)}
      />
    </div>
  )
}

// Cartão de categoria para ecrãs pequenos — os mesmos dados e ações da tabela.
function CategoryCard({ itemCount, ...props }: CategoryPieceProps & { itemCount: number }) {
  const d = useDict()
  return (
    <li className="bg-card border border-border rounded-lg p-3 space-y-2">
      <CategoryNameField {...props} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{d.admin.categories.itemsCount(itemCount)}</span>
        <CategoryActions {...props} />
      </div>
    </li>
  )
}

export function CategoriesTab({ categories, menuItems, setCategories }: CategoriesTabProps) {
  const d = useDict()
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryColor, setNewCategoryColor] = useState('#1759d2')
  const [categoryFormError, setCategoryFormError] = useState('')
  const [savingCategory, setSavingCategory] = useState(false)

  const [editingCat, setEditingCat] = useState<{ id: string; name: string; color: string } | null>(null)
  const [renameError, setRenameError] = useState('')
  // Confirmação inline (D5) de apagar categoria — por id, não booleano global.
  const deleteConfirm = useConfirmingId()

  // Não há FK entre menu_items e categories (ver schema): apagar a categoria
  // NÃO apaga os itens — deixa-os órfãos (sem categoria). Por isso, quando há
  // itens, avisamos mais forte, e o aviso tem de ser VISÍVEL (deleteConfirmHint),
  // não só no tooltip — num tablet o tooltip nunca abre.
  function categoryHasItems(cat: Category): boolean {
    return menuItems.some((i) => i.categoryId === cat.id)
  }

  function deleteConfirmMessage(cat: Category): string {
    if (categoryHasItems(cat)) return d.admin.categories.deleteConfirmWithItems
    return d.admin.categories.deleteConfirmEmpty
  }

  function deleteConfirmHint(cat: Category): string | undefined {
    if (categoryHasItems(cat)) return d.admin.categories.deleteHintWithItems
    return undefined
  }

  async function handleCreateCategory(e: FormEvent) {
    e.preventDefault()
    setCategoryFormError('')
    if (newCategoryName.trim().length < 2) { setCategoryFormError(d.admin.categories.nameTooShort); return }

    setSavingCategory(true)
    try {
      const created = await createCategory(newCategoryName.trim(), newCategoryColor)
      setCategories((prev) => [...prev, created])
      setNewCategoryName('')
      setNewCategoryColor('#1759d2')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setCategoryFormError(d.admin.categories.createErrorPrefix(msg))
    } finally {
      setSavingCategory(false)
    }
  }

  async function handleDeleteCategory(id: string) {
    await deleteCategory(id)
    setCategories((prev) => prev.filter((c) => c.id !== id))
    deleteConfirm.confirmed(id)
  }

  async function handleRenameCategory() {
    if (!editingCat) return
    if (editingCat.name.trim().length < 2) { setRenameError(d.admin.categories.nameTooShort); return }
    const name = editingCat.name.trim()
    const color = editingCat.color
    await updateCategory(editingCat.id, name, color)
    setCategories((prev) => prev.map((c) => c.id === editingCat.id ? { ...c, name, color } : c))
    setEditingCat(null)
    setRenameError('')
  }

  // Editar nome/cor limpa o erro de rename — feedback antigo não deve ficar.
  function handleEditingChange(next: EditingCategory) {
    setEditingCat(next)
    setRenameError('')
  }

  function handleStartRename(cat: Category) {
    setEditingCat({ id: cat.id, name: cat.name, color: cat.color ?? '#1759d2' })
    setRenameError('')
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-bold">{d.admin.categories.title}</h1>
      </div>

      <form onSubmit={handleCreateCategory} className="flex items-center gap-2 mb-4">
        <ColorSwatch color={newCategoryColor} onChange={setNewCategoryColor} />
        <input
          value={newCategoryName}
          onChange={(e) => setNewCategoryName(e.target.value)}
          placeholder={d.admin.categories.newNamePlaceholder}
          aria-label={d.admin.categories.newNameLabel}
          className="border border-input rounded-sm px-3 py-2 bg-background text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 text-sm w-60"
        />
        <Button type="submit" size="lg" disabled={savingCategory}>
          <PlusCircle />
          {savingCategory ? d.admin.categories.creating : d.admin.categories.createButton}
        </Button>
      </form>

      {categoryFormError && <Alert variant="destructive">{categoryFormError}</Alert>}

      {/* Tabela só em ecrã largo; no telemóvel a lista de cartões abaixo
          mostra os mesmos dados sem scroll horizontal. */}
      <div className="hidden sm:block bg-card border border-border rounded-lg overflow-hidden shadow-sm mb-4">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-sm min-w-[480px]">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left py-4 px-5 font-semibold text-foreground">{d.admin.categories.columns.name}</th>
                <th className="text-left py-4 px-5 font-semibold text-foreground">{d.admin.categories.columns.items}</th>
                <th className="text-left py-4 px-5 font-semibold text-foreground">{d.admin.categories.columns.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {categories.map((cat) => (
                <tr key={cat.id} className="hover:bg-accent transition-colors">
                  <td className="py-3 px-5">
                    <CategoryNameField
                      cat={cat}
                      editingCat={editingCat}
                      renameError={renameError}
                      onEditingChange={handleEditingChange}
                      onRename={handleRenameCategory}
                    />
                  </td>
                  <td className="py-3 px-5 text-muted-foreground">
                    {menuItems.filter((i) => i.categoryId === cat.id).length}
                  </td>
                  <td className="py-3 px-5">
                    <CategoryActions
                      cat={cat}
                      editingCat={editingCat}
                      onRename={handleRenameCategory}
                      onStartRename={handleStartRename}
                      onDelete={handleDeleteCategory}
                      confirmingCatId={deleteConfirm.confirmingId}
                      deleteConfirmMessage={deleteConfirmMessage}
                      deleteConfirmHint={deleteConfirmHint}
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
        {categories.map((cat) => (
          <CategoryCard
            key={cat.id}
            cat={cat}
            itemCount={menuItems.filter((i) => i.categoryId === cat.id).length}
            editingCat={editingCat}
            renameError={renameError}
            onEditingChange={handleEditingChange}
            onRename={handleRenameCategory}
            onStartRename={handleStartRename}
            onDelete={handleDeleteCategory}
            confirmingCatId={deleteConfirm.confirmingId}
            deleteConfirmMessage={deleteConfirmMessage}
            deleteConfirmHint={deleteConfirmHint}
            onRequestDelete={deleteConfirm.requestConfirm}
            onCancelDelete={deleteConfirm.cancel}
          />
        ))}
      </ul>
    </section>
  )
}
