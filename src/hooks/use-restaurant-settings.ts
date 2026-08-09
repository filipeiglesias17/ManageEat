import { useEffect, useState } from 'react'
import { subscribeRestaurantSettings } from '../lib/db'
import { DEFAULT_SETTINGS, type RestaurantSettings } from '../@types/settings'

// Subscreve as definições globais do restaurante (modo + preço de entrada) em
// tempo real. Devolve sempre um valor seguro: enquanto carrega, ou se o
// documento ainda não existir, fica em DEFAULT_SETTINGS (modo normal).
export function useRestaurantSettings(): RestaurantSettings {
  const [settings, setSettings] = useState<RestaurantSettings>(DEFAULT_SETTINGS)

  useEffect(() => {
    const unsubscribe = subscribeRestaurantSettings(setSettings)
    return unsubscribe
  }, [])

  return settings
}
