import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Shift } from '../@types/shift'
import { closeStaleShifts, subscribeShifts } from './db'
import { useAuth } from './auth-context'
import { canOperate } from './shift-gate'
import { ShiftContext } from './shift-context'

// Uma única subscrição de turnos para a app toda (antes vivia dentro da
// shift-status-bar). Alimenta a barra do ponto, o gating D1 dos botões e o
// aviso do logout. Para cliente/anónimo não subscreve nada — devolve logo
// "pode operar" para o fluxo QR ficar intocado.
export function ShiftProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const [shifts, setShifts] = useState<Shift[]>([])
  const [loaded, setLoaded] = useState(false)

  const isStaff = !!profile && profile.role !== 'cliente'

  useEffect(() => {
    if (!isStaff) return
    // D7: varrer turnos esquecidos no arranque (quem não picou a saída ontem).
    // Falhar aqui não pode partir a app — o varrimento repete-se noutro sítio.
    void closeStaleShifts().catch(() => {})
    // Realtime + refetch (padrão da app): se o chefe forçar a saída noutro
    // dispositivo, os botões desativam-se sozinhos em todo o lado.
    const unsubscribe = subscribeShifts((data) => {
      setShifts(data)
      setLoaded(true)
    })
    return unsubscribe
  }, [isStaff])

  const value = useMemo(() => {
    // Não-staff (cliente/anónimo/sem login): sem turno e sem bloqueios.
    if (!isStaff || !profile) {
      return { myShift: null, shiftLoaded: true, canOperate: true }
    }
    const myShift = shifts.find((shift) => shift.status === 'open' && shift.openedBy === profile.uid) ?? null
    return {
      myShift,
      shiftLoaded: loaded,
      canOperate: canOperate(profile.role, !!myShift),
    }
  }, [isStaff, profile, shifts, loaded])

  return <ShiftContext.Provider value={value}>{children}</ShiftContext.Provider>
}
