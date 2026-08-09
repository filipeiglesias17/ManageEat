// Idioma da interface (PT/EN), com o mesmo padrão por dispositivo do tema
// (src/lib/theme.ts): escolha guardada em localStorage, default português.
//
// O dicionário é um objeto TypeScript tipado (não react-i18next): uma chave a
// faltar em inglês é erro de compilação apanhado pelo gate, e funciona igual
// dentro e fora do React (camada db/, notificações, relatórios). Interpolações
// são funções no próprio dicionário: d.employee.tableLabel(5) → "Mesa 5".
//
// O que NUNCA se traduz: conteúdo do restaurante (menu, famílias, tags, dados
// fiscais), valores de roles na BD e códigos-máquina de erro.

import { useSyncExternalStore } from 'react'
import { pt } from './pt'
import { en } from './en'

export type Translation = typeof pt
export type Lang = 'pt' | 'en'

const DICTS: Record<Lang, Translation> = { pt, en }
const STORAGE_KEY = 'lang'

// Locale de FORMATAÇÃO (datas/números) por idioma. A moeda é sempre EUR.
const LOCALE_BY_LANG: Record<Lang, string> = { pt: 'pt-PT', en: 'en-GB' }

function readStoredLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'pt' || stored === 'en') return stored
  } catch {
    // localStorage pode estar indisponível (modo privado / WebView restrito).
  }
  return 'pt'
}

// Init síncrono no módulo: o primeiro render já sai no idioma certo.
let current: Lang = readStoredLang()
if (typeof document !== 'undefined') {
  document.documentElement.lang = current
}

// Subscritores (useSyncExternalStore) — trocar o idioma re-renderiza a app toda.
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getLang(): Lang {
  return current
}

export function setLang(lang: Lang): void {
  current = lang
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang
  }
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // Sem persistência não faz mal: a troca visual já aconteceu.
  }
  listeners.forEach(l => l())
}

// Alterna e devolve o idioma resultante (para o botão atualizar o rótulo).
export function toggleLang(): Lang {
  setLang(current === 'pt' ? 'en' : 'pt')
  return current
}

// Idioma reativo para componentes React.
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang)
}

// Dicionário ativo, reativo — o caminho normal nos componentes:
//   const d = useDict()  →  d.login.title
export function useDict(): Translation {
  return DICTS[useLang()]
}

// Dicionário ativo fora do React (db/, notificações, relatórios).
export function dict(): Translation {
  return DICTS[current]
}

// Locale de formatação ativo — usado pelos formatadores de src/lib/helpers.ts.
export function getLocale(): string {
  return LOCALE_BY_LANG[current]
}
