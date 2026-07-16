import { Capacitor } from '@capacitor/core'

// Feedback tátil CENTRAL da app (Fase 5 do redesign POS). Um único mapa de
// intensidades para toda a app, em vez de cada componente inventar o seu:
//
//   hapticTap()     → toque leve: adicionar ao carrinho, avançar estado na cozinha
//   hapticSuccess() → ação concluída: picar ponto, enviar pedido, fechar conta
//   hapticWarning() → atenção: chamadas de mesa (via notifications.ts)
//   hapticError()   → algo falhou / pedido atrasado
//
// Tudo no-op na web e à prova de falha (import dinâmico + try/catch): se o
// plugin não existir, a app segue sem vibração e sem erro.

export async function hapticTap(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics')
    await Haptics.impact({ style: ImpactStyle.Light })
  } catch {
    // Haptics indisponível: segue sem vibração.
  }
}

async function hapticNotification(kind: 'success' | 'warning' | 'error'): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { Haptics, NotificationType } = await import('@capacitor/haptics')
    const type = {
      success: NotificationType.Success,
      warning: NotificationType.Warning,
      error: NotificationType.Error,
    }[kind]
    await Haptics.notification({ type })
  } catch {
    // Haptics indisponível: segue sem vibração.
  }
}

export async function hapticSuccess(): Promise<void> {
  await hapticNotification('success')
}

export async function hapticWarning(): Promise<void> {
  await hapticNotification('warning')
}

export async function hapticError(): Promise<void> {
  await hapticNotification('error')
}
