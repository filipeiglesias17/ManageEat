import { Capacitor } from '@capacitor/core'

// Teclado nativo: quando abre, garantir que o input focado fica visível.
// O resize 'native' (capacitor.config.ts) encolhe a webview, mas não faz
// scroll até ao campo — em iPhones pequenos o input podia ficar tapado.
// Init único no arranque (main.tsx). No-op na web.
export async function initKeyboardScrollIntoView(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { Keyboard } = await import('@capacitor/keyboard')
    let settleTimer: number | undefined

    await Keyboard.addListener('keyboardDidShow', () => {
      // Pequeno atraso para o resize da webview assentar antes do scroll —
      // senão o scrollIntoView calcula posições com a altura antiga.
      window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => {
        const active = document.activeElement
        const isTextField = active instanceof HTMLElement &&
          (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')
        if (!isTextField) return
        active.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }, 60)
    })
  } catch {
    // Plugin indisponível: o comportamento fica o de sempre.
  }
}
