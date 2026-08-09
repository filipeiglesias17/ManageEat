// Funcionalidades em beta — os IDs e a ordem vivem aqui; o texto (nome e
// limitação honesta) vive no dicionário (i18n, namespace settings.betaFeatures)
// para trocar com o idioma. Alimenta os BetaBadge espalhados pela UI e a
// secção "Funcionalidades em beta" nas Definições.

import { dict } from './i18n'

export const BETA_FEATURE_IDS = [
  'saft',
  'notifications',
  'offline',
  'userManagement',
  'scheduledBackup',
  'launcherWindowsLinux',
  'otaHttps',
] as const

export type BetaFeatureId = (typeof BETA_FEATURE_IDS)[number]

export type BetaFeature = {
  id: BetaFeatureId
  name: string
  limitation: string
}

// Lista completa no idioma ativo (para a secção das Definições).
export function betaFeatures(): BetaFeature[] {
  const texts = dict().settings.betaFeatures
  return BETA_FEATURE_IDS.map(id => ({ id, ...texts[id] }))
}

// Uma funcionalidade específica no idioma ativo (para os badges com hint).
export function betaFeature(id: BetaFeatureId): BetaFeature {
  return { id, ...dict().settings.betaFeatures[id] }
}
