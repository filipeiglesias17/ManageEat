import { Capacitor } from '@capacitor/core'

export async function hideNativeKeyboard(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { Keyboard } = await import('@capacitor/keyboard')
    await Keyboard.hide()
  } catch {
    // O formulário continua funcional quando o plugin não está disponível.
  }
}

// Em ecrãs pequenos, mantém o campo focado acima do teclado nativo.
export async function initKeyboardScrollIntoView(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { Keyboard } = await import('@capacitor/keyboard')
    let settleTimer: number | undefined

    await Keyboard.addListener('keyboardDidShow', () => {
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
    // O browser conserva o comportamento normal quando o plugin não existe.
  }
}
