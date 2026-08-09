import { Capacitor } from '@capacitor/core'
import type { StaffNotification, StaffNotificationKind } from '../@types/notification'
import { hapticSuccess, hapticWarning, hapticError } from './haptics'
import { dict } from './i18n'

// Camada nativa das notificações do empregado. Na web, estas funções não atuam:
// guard `isNativePlatform()` + import() dinâmico (o mesmo padrão de export-download.ts).
// Limite honesto: sem push (APNs/FCM), isto só dispara com a app VIVA — o Realtime
// do Supabase suspende quando o SO congela a app em background.

// O id da notificação nativa tem de ser um INTEIRO (32 bits). Derivamo-lo do id
// estável em texto (ex.: "ready:<uuid>") com um hash simples e determinístico.
function numericId(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

let permissionRequested = false

// Pede permissão de notificações uma vez (iOS mostra o pedido; Android 13+ pede
// POST_NOTIFICATIONS). Se o utilizador recusar, o alerta in-app continua a funcionar.
export async function requestNotificationPermissions(): Promise<void> {
  if (!Capacitor.isNativePlatform() || permissionRequested) return
  permissionRequested = true
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const status = await LocalNotifications.checkPermissions()
    if (status.display !== 'granted') {
      await LocalNotifications.requestPermissions()
    }
  } catch (error) {
    console.warn('Notificações nativas: não foi possível pedir permissão', error)
  }
}

// Vibração por tipo de evento. A implementação vive agora em lib/haptics.ts
// (mapa tátil único de toda a app) — aqui só se traduz o tipo de notificação
// do empregado para a intensidade certa.
const HAPTIC_BY_KIND: Record<StaffNotificationKind, () => Promise<void>> = {
  waiter_call: hapticWarning,
  bill_request: hapticWarning,
  order_ready: hapticSuccess,
  order_late: hapticError,
}

export async function haptic(kind: StaffNotificationKind): Promise<void> {
  await HAPTIC_BY_KIND[kind]()
}

// Mostra a notificação no sistema (banner + centro de notificações). Cobre o caso
// "app aberta mas o empregado está noutro ecrã do telemóvel".
export async function presentNativeNotification(notification: StaffNotification): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.schedule({
      notifications: [
        {
          id: numericId(notification.id),
          title: dict().employee.notifications.nativeTitle(notification.tableNumber),
          // A mensagem em si (notification.message) nasce em notifications-detect.ts,
          // um ficheiro fora do scope desta migração — fica em português por agora.
          body: notification.message,
          // Guardamos o sessionId para saltar à mesa quando se toca no banner.
          extra: { sessionId: notification.sessionId },
        },
      ],
    })
  } catch (error) {
    console.warn('Notificação nativa falhou', error)
  }
}

// Regista o toque no banner nativo → abrir a mesa. Devolve uma função de limpeza.
export async function registerNotificationTap(
  onOpen: (sessionId?: string) => void,
): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => {}
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const handle = await LocalNotifications.addListener(
      'localNotificationActionPerformed',
      (event) => {
        const sessionId = event.notification.extra?.sessionId as string | undefined
        onOpen(sessionId)
      },
    )
    return () => {
      handle.remove()
    }
  } catch (error) {
    console.warn('Não foi possível registar o toque na notificação', error)
    return () => {}
  }
}
