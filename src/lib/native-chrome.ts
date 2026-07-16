import { Capacitor } from '@capacitor/core'

// "Chrome" nativo (status bar) alinhado com o tema da app. Antes o estilo era
// fixo em Style.Dark — com o tema claro por defeito, os ícones do relógio/bateria
// ficavam brancos sobre fundo claro. Chamado no arranque (main.tsx) e a cada
// troca de tema (theme.ts#applyTheme). No-op na web.
export async function syncStatusBarWithTheme(dark: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    // Style.Dark = ícones CLAROS (para fundo escuro); Style.Light = ícones
    // escuros (para o tema claro). Os nomes do plugin referem-se ao fundo.
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light })
  } catch {
    // Plugin indisponível: a status bar fica como está.
  }
}
