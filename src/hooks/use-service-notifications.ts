import { useEffect, useRef, useState } from 'react'
import type { Order } from '../@types/order'
import type { ServiceCall } from '../@types/service-call'
import type { QrSession } from '../lib/db'
import type { StaffNotification } from '../@types/notification'
import { detectStaffNotifications } from '../lib/notifications-detect'

// Cadência do "relógio" que reavalia os pedidos atrasados. Os outros eventos
// (chamadas, pedidos prontos) chegam por Realtime e não esperam pelo tick.
const CLOCK_MS = 15_000

// Motor de notificações do empregado: observa as listas em tempo real e chama
// `onNotify` para cada evento NOVO. A deteção (o que é novo) vive na função pura
// `detectStaffNotifications`; aqui só guardamos o estado anterior entre renders.
export function useServiceNotifications(
  orders: Order[],
  calls: ServiceCall[],
  sessions: QrSession[],
  onNotify: (notification: StaffNotification) => void,
): void {
  const seen = useRef({
    openCallIds: new Set<string>(),
    readyOrderIds: new Set<string>(),
    lateOrderIds: new Set<string>(),
    isInitial: true,
  })

  // O relógio faz os pedidos atrasados dispararem mesmo sem chegar dado novo.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), CLOCK_MS)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const prev = seen.current
    const result = detectStaffNotifications({
      orders,
      calls,
      sessions,
      now,
      prevOpenCallIds: prev.openCallIds,
      prevReadyOrderIds: prev.readyOrderIds,
      prevLateOrderIds: prev.lateOrderIds,
      isInitial: prev.isInitial,
    })

    seen.current = {
      openCallIds: result.openCallIds,
      readyOrderIds: result.readyOrderIds,
      lateOrderIds: result.lateOrderIds,
      isInitial: false,
    }

    for (const notification of result.notifications) {
      onNotify(notification)
    }
  }, [orders, calls, sessions, now, onNotify])
}
