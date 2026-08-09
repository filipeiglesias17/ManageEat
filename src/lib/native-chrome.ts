import { Capacitor } from '@capacitor/core'

export async function configureStatusBarOverlay(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { StatusBar } = await import('@capacitor/status-bar')
    await StatusBar.setOverlaysWebView({ overlay: true })
  } catch {
    // A aplicação continua funcional quando o plugin não está disponível.
  }
}

// Mantém os ícones da status bar legíveis no tema ativo.
export async function syncStatusBarWithTheme(dark: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light })
  } catch {
    // A aplicação continua funcional quando o plugin não está disponível.
  }
}
