import { useEffect, useRef, useState } from 'react'
import { formatEuro } from '../lib/helpers'
import {
  CheckCircle2,
  Lock,
  RotateCcw,
  Save,
  Unlock,
  UtensilsCrossed,
} from 'lucide-react'
import type { Category } from '../@types/category'
import type { MenuItem } from '../@types/menu-item'
import { DEFAULT_SETTINGS, type RestaurantMode, type RestaurantSettings } from '../@types/settings'
import { subscribeRestaurantSettings, updateMenuItem, updateRestaurantSettings } from '../lib/db'
import { parsePrice, formatPrice } from '../lib/validation'
import { Button } from '@/components/ui/button'
import { dict, useDict } from '../lib/i18n'

type AdminRestaurantSettingsProps = {
  categories: Category[]
  menuItems: MenuItem[]
  onMenuItemsChange: (items: MenuItem[]) => void
}

type CategoryGroup = {
  id: string
  name: string
  color?: string
  items: MenuItem[]
}

const UNCATEGORIZED_ID = '__uncategorized__'

// Neste ecrã o preço de entrada a 0 mostra-se como campo vazio (não "0.00").
function formatEntryPrice(value: number): string {
  if (value <= 0) return ''
  return formatPrice(value)
}

// Campos fiscais do form, como strings (os inputs guardam texto). Convertidos
// para o tipo final em handleSave.
type FiscalForm = {
  name: string
  nif: string
  address: string
  vatRate: string
}

// Versão em string dos dados fiscais guardados, para inicializar/comparar o form.
function savedFiscalForm(s: RestaurantSettings): FiscalForm {
  return {
    name: s.name ?? '',
    nif: s.nif ?? '',
    address: s.address ?? '',
    vatRate: s.defaultVatRate != null ? String(s.defaultVatRate) : '',
  }
}

// Horas máximas de turno guardadas, como string do input (vazio = desligado).
function savedMaxShiftHours(s: RestaurantSettings): string {
  return s.maxShiftHours != null ? String(s.maxShiftHours) : ''
}

function settingsChanged(
  currentMode: RestaurantMode,
  currentEntryPrice: string,
  fiscal: FiscalForm,
  maxShiftHours: string,
  savedSettings: RestaurantSettings,
): boolean {
  const parsedEntryPrice = parsePrice(currentEntryPrice)
  const formEntryPrice = parsedEntryPrice ?? 0

  if (currentMode !== savedSettings.mode) return true
  if (formEntryPrice !== savedSettings.entryPrice) return true
  if (maxShiftHours.trim() !== savedMaxShiftHours(savedSettings)) return true

  const savedFiscal = savedFiscalForm(savedSettings)
  if (fiscal.name.trim() !== savedFiscal.name) return true
  if (fiscal.nif.trim() !== savedFiscal.nif) return true
  if (fiscal.address.trim() !== savedFiscal.address) return true
  if (fiscal.vatRate.trim() !== savedFiscal.vatRate) return true
  return false
}

// Helper fora do componente (não é hook) — usa dict() em vez de useDict()
// porque não pode chamar hooks aqui.
function entryPriceError(mode: RestaurantMode, value: string): string {
  if (mode === 'normal') return ''

  const parsedEntryPrice = parsePrice(value)
  if (parsedEntryPrice === null || parsedEntryPrice <= 0) {
    return dict().settings.restaurant.entryPriceRequired
  }

  return ''
}

function groupItemsByCategory(categories: Category[], menuItems: MenuItem[]): CategoryGroup[] {
  const groups = categories.map((category) => ({
    id: category.id,
    name: category.name,
    color: category.color,
    items: menuItems.filter((item) => item.categoryId === category.id),
  }))

  const knownCategoryIds = new Set(categories.map((category) => category.id))
  const uncategorizedItems = menuItems.filter((item) => !knownCategoryIds.has(item.categoryId))
  if (uncategorizedItems.length === 0) return groups

  return [
    ...groups,
    {
      id: UNCATEGORIZED_ID,
      name: dict().settings.restaurant.rodizio.uncategorizedLabel,
      items: uncategorizedItems,
    },
  ]
}

// Definições globais do restaurante: modo (normal/rodízio), entrada e itens
// incluídos. A flag por item (`rodizioAvailable`) é a que cliente/empregado usam
// para gravar preço 0 no pedido quando o modo é rodízio.
export function AdminRestaurantSettings({
  categories,
  menuItems,
  onMenuItemsChange,
}: AdminRestaurantSettingsProps) {
  const d = useDict()
  const [savedSettings, setSavedSettings] = useState<RestaurantSettings>(DEFAULT_SETTINGS)
  const [mode, setMode] = useState<RestaurantMode>(DEFAULT_SETTINGS.mode)
  const [entryPrice, setEntryPrice] = useState(formatEntryPrice(DEFAULT_SETTINGS.entryPrice))
  // ── Dados fiscais (para os relatórios; não tornam os documentos válidos) ──
  const [fiscalName, setFiscalName] = useState('')
  const [fiscalNif, setFiscalNif] = useState('')
  const [fiscalAddress, setFiscalAddress] = useState('')
  const [fiscalVatRate, setFiscalVatRate] = useState(
    DEFAULT_SETTINGS.defaultVatRate != null ? String(DEFAULT_SETTINGS.defaultVatRate) : '',
  )
  // Horas máximas de um turno; vazio desativa o fecho automático.
  const [maxShiftHours, setMaxShiftHours] = useState('')
  const [modeLocked, setModeLocked] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [updatingItemIds, setUpdatingItemIds] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [itemsMessage, setItemsMessage] = useState('')
  const [itemsError, setItemsError] = useState('')

  const fiscalForm: FiscalForm = { name: fiscalName, nif: fiscalNif, address: fiscalAddress, vatRate: fiscalVatRate }
  const hasUnsavedChanges = settingsChanged(mode, entryPrice, fiscalForm, maxShiftHours, savedSettings)
  const hasUnsavedChangesRef = useRef(hasUnsavedChanges)
  const savingRef = useRef(saving)
  const categoryGroups = groupItemsByCategory(categories, menuItems)
  const includedCount = menuItems.filter((item) => item.rodizioAvailable === true).length

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges
  }, [hasUnsavedChanges])

  useEffect(() => {
    savingRef.current = saving
  }, [saving])

  // Tempo real: se o admin abrir a página noutra janela, recebemos a config.
  // Não pisamos alterações locais que ainda não foram guardadas.
  useEffect(() => {
    const unsubscribe = subscribeRestaurantSettings(
      (settings) => {
        setSavedSettings(settings)
        setLoading(false)
        setError('')

        if (hasUnsavedChangesRef.current) {
          if (!savingRef.current) {
            setMessage(d.settings.restaurant.changedElsewhere)
          }
          return
        }

        setMode(settings.mode)
        setEntryPrice(formatEntryPrice(settings.entryPrice))
        const savedFiscal = savedFiscalForm(settings)
        setFiscalName(savedFiscal.name)
        setFiscalNif(savedFiscal.nif)
        setFiscalAddress(savedFiscal.address)
        setFiscalVatRate(savedFiscal.vatRate)
        setMaxShiftHours(savedMaxShiftHours(settings))
        setModeLocked(true)
      },
      (err) => {
        const msg = err instanceof Error ? err.message : String(err)
        setLoading(false)
        setError(d.settings.restaurant.loadErrorPrefix(msg))
      },
    )
    return unsubscribe
    // "d" fica de fora de propósito: trocar de idioma não deve recriar a
    // subscrição às definições — só corre uma vez, ao montar o ecrã.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleModeChange(newMode: RestaurantMode) {
    if (modeLocked) {
      setError(d.settings.restaurant.serviceType.lockedError)
      return
    }

    setMode(newMode)
    setMessage('')
    setError('')
  }

  function handleEntryPriceChange(value: string) {
    setEntryPrice(value)
    setMessage('')
    setError('')
  }

  function handleReset() {
    setMode(savedSettings.mode)
    setEntryPrice(formatEntryPrice(savedSettings.entryPrice))
    const savedFiscal = savedFiscalForm(savedSettings)
    setFiscalName(savedFiscal.name)
    setFiscalNif(savedFiscal.nif)
    setFiscalAddress(savedFiscal.address)
    setFiscalVatRate(savedFiscal.vatRate)
    setMaxShiftHours(savedMaxShiftHours(savedSettings))
    setModeLocked(true)
    setMessage(d.settings.restaurant.resetDone)
    setError('')
  }

  // Editar um campo fiscal limpa as mensagens, como os outros campos.
  function handleFiscalChange(setter: (v: string) => void, value: string) {
    setter(value)
    setMessage('')
    setError('')
  }

  function toggleModeLock() {
    setModeLocked((current) => !current)
    setMessage('')
    setError('')
  }

  function updateLocalRodizioFlags(itemIds: string[], rodizioAvailable: boolean) {
    const nextItems = menuItems.map((item) => {
      if (!itemIds.includes(item.id)) return item
      return { ...item, rodizioAvailable }
    })
    onMenuItemsChange(nextItems)
  }

  function startUpdatingItems(itemIds: string[]) {
    setUpdatingItemIds((current) => Array.from(new Set([...current, ...itemIds])))
  }

  function stopUpdatingItems(itemIds: string[]) {
    setUpdatingItemIds((current) => current.filter((id) => !itemIds.includes(id)))
  }

  async function handleItemIncludedChange(item: MenuItem, rodizioAvailable: boolean) {
    setItemsError('')
    setItemsMessage('')
    startUpdatingItems([item.id])

    try {
      await updateMenuItem(item.id, { rodizioAvailable })
      updateLocalRodizioFlags([item.id], rodizioAvailable)
      setItemsMessage(rodizioAvailable ? d.settings.restaurant.rodizio.itemIncluded : d.settings.restaurant.rodizio.itemExcluded)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setItemsError(d.settings.restaurant.rodizio.itemUpdateErrorPrefix(msg))
    } finally {
      stopUpdatingItems([item.id])
    }
  }

  async function handleCategoryIncludedChange(group: CategoryGroup, rodizioAvailable: boolean) {
    setItemsError('')
    setItemsMessage('')

    const itemIds = group.items.map((item) => item.id)
    if (itemIds.length === 0) return

    startUpdatingItems(itemIds)
    try {
      await Promise.all(itemIds.map((id) => updateMenuItem(id, { rodizioAvailable })))
      updateLocalRodizioFlags(itemIds, rodizioAvailable)
      setItemsMessage(rodizioAvailable
        ? d.settings.restaurant.rodizio.categoryIncluded(group.name)
        : d.settings.restaurant.rodizio.categoryExcluded(group.name))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setItemsError(d.settings.restaurant.rodizio.categoryUpdateErrorPrefix(msg))
    } finally {
      stopUpdatingItems(itemIds)
    }
  }

  async function handleSave() {
    setError('')
    setMessage('')

    const validationError = entryPriceError(mode, entryPrice)
    if (validationError) {
      setError(validationError)
      return
    }

    // IVA por defeito: vazio = sem taxa definida; caso contrário 0–100.
    if (fiscalVatRate.trim() !== '') {
      const v = Number(fiscalVatRate.trim().replace(',', '.'))
      if (!Number.isFinite(v) || v < 0 || v > 100) {
        setError(d.settings.restaurant.vatRangeError)
        return
      }
    }

    // Auto-fecho de turnos: vazio = desligado; caso contrário 0–24h (a BD
    // impõe o mesmo limite com um CHECK).
    if (maxShiftHours.trim() !== '') {
      const h = Number(maxShiftHours.trim().replace(',', '.'))
      if (!Number.isFinite(h) || h <= 0 || h > 24) {
        setError(d.settings.restaurant.maxShiftHoursRangeError)
        return
      }
    }

    const parsedEntryPrice = parsePrice(entryPrice)
    // setDoc faz overwrite total, por isso só incluímos os campos fiscais que
    // têm valor — assim um campo apagado deixa de existir no documento.
    const nextSettings: RestaurantSettings = {
      mode,
      entryPrice: parsedEntryPrice ?? 0,
      ...(fiscalName.trim() ? { name: fiscalName.trim() } : {}),
      ...(fiscalNif.trim() ? { nif: fiscalNif.trim() } : {}),
      ...(fiscalAddress.trim() ? { address: fiscalAddress.trim() } : {}),
      ...(fiscalVatRate.trim() ? { defaultVatRate: Number(fiscalVatRate.trim().replace(',', '.')) } : {}),
      ...(maxShiftHours.trim() ? { maxShiftHours: Number(maxShiftHours.trim().replace(',', '.')) } : {}),
    }

    savingRef.current = true
    setSaving(true)
    try {
      await updateRestaurantSettings(nextSettings)
      setSavedSettings(nextSettings)
      setEntryPrice(formatEntryPrice(nextSettings.entryPrice))
      const savedFiscal = savedFiscalForm(nextSettings)
      setFiscalName(savedFiscal.name)
      setFiscalNif(savedFiscal.nif)
      setFiscalAddress(savedFiscal.address)
      setFiscalVatRate(savedFiscal.vatRate)
      setMaxShiftHours(savedMaxShiftHours(nextSettings))
      setModeLocked(true)
      setMessage(d.settings.restaurant.saveDone)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(d.settings.restaurant.saveErrorPrefix(msg))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="restaurant-settings-title">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 id="restaurant-settings-title" className="text-xl font-bold flex items-center gap-2">
            <UtensilsCrossed className="size-5" />
            {d.settings.restaurant.title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {d.settings.restaurant.subtitle}
          </p>
        </div>

        <span
          className={`w-fit rounded-sm px-2.5 py-1 text-xs font-medium ${
            savedSettings.mode === 'rodizio'
              ? 'bg-brand/15 text-brand'
              : savedSettings.mode === 'mixed'
              ? 'bg-info/15 text-info'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {d.settings.restaurant.savedBadge(d.settings.restaurant.modeLabels[savedSettings.mode])}
        </span>
      </div>

      <div className="rounded-sm border border-border bg-card">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{d.settings.restaurant.serviceType.title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {d.settings.restaurant.serviceType.description}
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:items-end">
            <div className="flex items-center gap-2">
              <div className="flex rounded-sm overflow-hidden border border-border bg-card">
                {(['normal', 'rodizio', 'mixed'] as RestaurantMode[]).map((m) => {
                  const labels = d.settings.restaurant.modeLabels
                  const active = mode === m
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => handleModeChange(m)}
                      disabled={saving || loading}
                      className={`px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                        active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                      }`}
                    >
                      {labels[m]}
                    </button>
                  )
                })}
              </div>
              <button
                type="button"
                onClick={toggleModeLock}
                disabled={saving || loading}
                aria-label={modeLocked ? d.settings.restaurant.serviceType.unlock : d.settings.restaurant.serviceType.lock}
                className="flex size-8 items-center justify-center rounded-sm border border-border text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                {modeLocked ? <Lock className="size-4" /> : <Unlock className="size-4" />}
              </button>
            </div>

            <p id="mode-lock-status" className="text-xs text-muted-foreground">
              {modeLocked ? d.settings.restaurant.serviceType.lockedStatus : d.settings.restaurant.serviceType.unlockedStatus}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-border p-4 sm:flex-row sm:items-center">
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || loading || !hasUnsavedChanges}
          >
            <Save />
            {saving ? d.settings.restaurant.saving : d.settings.restaurant.save}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleReset}
            disabled={saving || loading || !hasUnsavedChanges}
          >
            <RotateCcw />
            {d.settings.restaurant.reset}
          </Button>

          {loading && <span className="text-sm text-muted-foreground" role="status">{d.settings.restaurant.loadingSettings}</span>}
          {hasUnsavedChanges && !error && (
            <span className="text-sm text-warning" role="status">
              {d.settings.restaurant.unsavedChanges}
            </span>
          )}
          {message && (
            <span className="flex items-center gap-1.5 text-sm text-brand" role="status">
              <CheckCircle2 className="size-4" />
              {message}
            </span>
          )}
          {error && (
            <span className="text-sm text-destructive" role="alert">
              {error}
            </span>
          )}
        </div>
      </div>

      {/* ── Dados fiscais (alimentam os relatórios PDF/SAF-T) ── */}
      <div className="rounded-sm border border-border bg-card p-4 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{d.settings.restaurant.fiscal.title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {d.settings.restaurant.fiscal.description}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="fiscal-name" className="text-sm font-medium text-foreground">{d.settings.restaurant.fiscal.nameLabel}</label>
            <input
              id="fiscal-name"
              type="text"
              value={fiscalName}
              onChange={(e) => handleFiscalChange(setFiscalName, e.target.value)}
              placeholder={d.settings.restaurant.fiscal.namePlaceholder}
              className="w-full rounded-sm border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="fiscal-nif" className="text-sm font-medium text-foreground">{d.settings.restaurant.fiscal.nifLabel}</label>
            <input
              id="fiscal-nif"
              type="text"
              inputMode="numeric"
              value={fiscalNif}
              onChange={(e) => handleFiscalChange(setFiscalNif, e.target.value)}
              placeholder={d.settings.restaurant.fiscal.nifPlaceholder}
              className="w-full rounded-sm border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label htmlFor="fiscal-address" className="text-sm font-medium text-foreground">{d.settings.restaurant.fiscal.addressLabel}</label>
            <input
              id="fiscal-address"
              type="text"
              value={fiscalAddress}
              onChange={(e) => handleFiscalChange(setFiscalAddress, e.target.value)}
              placeholder={d.settings.restaurant.fiscal.addressPlaceholder}
              className="w-full rounded-sm border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="fiscal-vat" className="text-sm font-medium text-foreground">{d.settings.restaurant.fiscal.vatLabel}</label>
            <input
              id="fiscal-vat"
              type="number"
              min="0"
              max="100"
              inputMode="decimal"
              value={fiscalVatRate}
              onChange={(e) => handleFiscalChange(setFiscalVatRate, e.target.value)}
              placeholder={d.settings.restaurant.fiscal.vatPlaceholder}
              className="w-full rounded-sm border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <p className="text-xs text-muted-foreground">
              {d.settings.restaurant.fiscal.vatHelp}
            </p>
          </div>
        </div>
      </div>

      {/* Fecho automático de turnos esquecidos. */}
      <div className="rounded-sm border border-border bg-card p-4 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{d.settings.restaurant.timeClock.title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {d.settings.restaurant.timeClock.description}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="max-shift-hours" className="text-sm font-medium text-foreground">
              {d.settings.restaurant.timeClock.maxHoursLabel}
            </label>
            <input
              id="max-shift-hours"
              type="number"
              min="1"
              max="24"
              inputMode="decimal"
              value={maxShiftHours}
              onChange={(e) => handleFiscalChange(setMaxShiftHours, e.target.value)}
              placeholder={d.settings.restaurant.timeClock.maxHoursPlaceholder}
              aria-describedby="max-shift-hours-help"
              className="w-full rounded-sm border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <p id="max-shift-hours-help" className="text-xs text-muted-foreground">
              {d.settings.restaurant.timeClock.maxHoursHelp}
            </p>
          </div>
        </div>
      </div>

      {mode !== 'normal' && (
        <div className="rounded-sm border border-border bg-card p-4 space-y-5">
          <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="entry-price" className="text-sm font-medium text-foreground">
                {d.settings.restaurant.rodizio.entryPriceLabel}
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">€</span>
                <input
                  id="entry-price"
                  type="text"
                  inputMode="decimal"
                  value={entryPrice}
                  onChange={(e) => handleEntryPriceChange(e.target.value)}
                  aria-describedby="entry-price-help"
                  className="w-full rounded-sm border border-input bg-background px-8 py-2 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </div>
              <p id="entry-price-help" className="text-xs text-muted-foreground">
                {d.settings.restaurant.rodizio.entryPriceHelp}
              </p>
            </div>

            <div>
              <h2 className="text-sm font-semibold text-foreground">{d.settings.restaurant.rodizio.includedItemsTitle}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {d.settings.restaurant.rodizio.includedItemsSummary(includedCount, menuItems.length)}
              </p>
            </div>
          </div>

          <div className="space-y-5">
            {categoryGroups.length === 0 && (
              <p className="text-sm text-muted-foreground">{d.settings.restaurant.rodizio.needsCategories}</p>
            )}

            {categoryGroups.map((group) => {
              const totalItems = group.items.length
              const selectedItems = group.items.filter((item) => item.rodizioAvailable === true).length
              const allSelected = totalItems > 0 && selectedItems === totalItems
              const categoryUpdating = group.items.some((item) => updatingItemIds.includes(item.id))

              return (
                <div key={group.id} className="border-t border-border pt-4 first:border-t-0 first:pt-0">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="size-3 rounded-full"
                        style={{ background: group.color ?? '#71717a' }}
                      />
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">{group.name}</h3>
                        <p className="text-xs text-muted-foreground">
                          {d.settings.restaurant.rodizio.categorySelected(selectedItems, totalItems)}
                        </p>
                      </div>
                    </div>

                    <label className="flex w-fit items-center gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        disabled={totalItems === 0 || categoryUpdating}
                        onChange={(e) => handleCategoryIncludedChange(group, e.target.checked)}
                        className="size-4 accent-brand disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      {d.settings.restaurant.rodizio.wholeCategory}
                    </label>
                  </div>

                  {totalItems === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">{d.settings.restaurant.rodizio.noItemsInCategory}</p>
                  ) : (
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {group.items.map((item) => {
                        const itemUpdating = updatingItemIds.includes(item.id)
                        return (
                          <label
                            key={item.id}
                            className="flex items-start justify-between gap-3 rounded-sm border border-border bg-muted/40 px-3 py-2"
                          >
                            <span>
                              <span className="block text-sm font-medium text-foreground">{item.name}</span>
                              <span className="block text-xs text-muted-foreground">
                                {d.settings.restaurant.rodizio.normalPrice(formatEuro(item.price))}
                              </span>
                            </span>
                            <input
                              type="checkbox"
                              checked={item.rodizioAvailable === true}
                              disabled={itemUpdating}
                              onChange={(e) => handleItemIncludedChange(item, e.target.checked)}
                              className="mt-1 size-4 shrink-0 accent-brand disabled:cursor-not-allowed disabled:opacity-50"
                            />
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {itemsMessage && (
            <p className="text-sm text-brand" role="status">
              {itemsMessage}
            </p>
          )}
          {itemsError && (
            <p className="text-sm text-destructive" role="alert">
              {itemsError}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
