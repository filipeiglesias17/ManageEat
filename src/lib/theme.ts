// Tema claro/escuro. O CLARO é o default (look POS — legível em sala iluminada);
// o escuro é opcional e a escolha fica guardada em localStorage (por dispositivo).
// A troca é feita pondo/tirando a classe .dark no <html> — os tokens de cor em
// index.css reagem a essa classe.
//
// O primeiro paint é tratado por um pequeno script inline no index.html (evita o
// "flash" de tema errado antes do JS arrancar). Este módulo trata da troca em
// runtime (o botão ThemeToggle).

import { syncStatusBarWithTheme } from './native-chrome'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'theme'

// Lê o tema atual a partir do DOM (fonte de verdade), não do storage: assim o
// botão reflete sempre o que está no ecrã, mesmo no primeiro render.
export function isDarkActive(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.classList.contains('dark')
}

// Cores de fundo por tema (iguais aos tokens --background em index.css).
// Usadas para tingir a barra do browser/PWA quando o tema troca em runtime —
// os <meta name="theme-color"> do index.html só reagem ao modo do SO.
const THEME_BACKGROUND: Record<Theme, string> = {
  light: '#f6f7f8',
  dark: '#09090b',
}

function syncThemeColorMeta(theme: Theme): void {
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
  metas.forEach((meta) => {
    meta.content = THEME_BACKGROUND[theme]
  })
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement
  // Suprimir transições durante a troca: senão TODOS os elementos com
  // `transition` animam a cor de claro→escuro ao mesmo tempo e vê-se um "wipe".
  // Reativamos no frame seguinte, já com as cores novas aplicadas.
  root.classList.add('theme-switching')
  if (theme === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
  // Reativar transições depois de o browser pintar com as cores novas. O duplo
  // rAF cobre o caso normal; o setTimeout é a rede de segurança caso o rAF esteja
  // estrangulado (ex.: aba em segundo plano) — senão a classe ficaria presa e as
  // transições desligadas para sempre. Remover duas vezes é inofensivo.
  const reenableTransitions = () => root.classList.remove('theme-switching')
  requestAnimationFrame(() => requestAnimationFrame(reenableTransitions))
  setTimeout(reenableTransitions, 250)

  syncThemeColorMeta(theme)
  // Em nativo, a status bar acompanha o tema (no-op na web). void: não vale a
  // pena atrasar a troca visual à espera do plugin.
  void syncStatusBarWithTheme(theme === 'dark')
}

export function setTheme(theme: Theme): void {
  applyTheme(theme)
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // localStorage pode estar indisponível (modo privado / WebView restrito).
    // A troca visual já foi aplicada; só não fica persistida.
  }
}

// Alterna e devolve o tema resultante (para o componente atualizar o ícone).
export function toggleTheme(): Theme {
  const next: Theme = isDarkActive() ? 'light' : 'dark'
  setTheme(next)
  return next
}
