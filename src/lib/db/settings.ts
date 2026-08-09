import { supabase } from '../supabase'
import type { RestaurantSettings } from '../../@types/settings'
import { DEFAULT_SETTINGS } from '../../@types/settings'
import { throwOnError, subscribeTable } from './base'

const SETTINGS_ID = 'restaurant'

export function rowToSettings(r: Record<string, unknown>): RestaurantSettings {
  const settings: RestaurantSettings = {
    ...DEFAULT_SETTINGS,
    mode: r.mode as RestaurantSettings['mode'],
    entryPrice: Number(r.entry_price),
  }
  if (r.name != null) settings.name = r.name as string
  if (r.nif != null) settings.nif = r.nif as string
  if (r.address != null) settings.address = r.address as string
  if (r.default_vat_rate != null) settings.defaultVatRate = Number(r.default_vat_rate)
  if (r.max_shift_hours != null) settings.maxShiftHours = Number(r.max_shift_hours)
  return settings
}

export async function getRestaurantSettings(): Promise<RestaurantSettings> {
  const { data, error } = await supabase.from('settings').select('*').eq('id', SETTINGS_ID).maybeSingle()
  throwOnError(error)
  if (!data) return DEFAULT_SETTINGS
  return rowToSettings(data as Record<string, unknown>)
}

export function subscribeRestaurantSettings(
  callback: (settings: RestaurantSettings) => void,
  onError?: (error: Error) => void,
): () => void {
  return subscribeTable('settings', getRestaurantSettings, callback, { onError })
}

export async function updateRestaurantSettings(settings: RestaurantSettings): Promise<void> {
  const row = {
    id: SETTINGS_ID,
    mode: settings.mode,
    entry_price: settings.entryPrice,
    name: settings.name ?? null,
    nif: settings.nif ?? null,
    address: settings.address ?? null,
    default_vat_rate: settings.defaultVatRate ?? null,
    max_shift_hours: settings.maxShiftHours ?? null,
  }
  const { error } = await supabase.from('settings').upsert(row, { onConflict: 'id' })
  throwOnError(error)
}
