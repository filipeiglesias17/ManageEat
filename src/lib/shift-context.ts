import { createContext, useContext } from 'react'
import type { Shift } from '../@types/shift'

// Estado partilhado do turno do próprio utilizador. Antes cada componente
// fazia o seu fetch/subscrição (shift-status-bar, close-bill-modal…) e era
// fácil um ecrã novo esquecer-se da regra — agora todos leem daqui.
// Separado do provider (padrão auth-context/auth-provider) por causa do lint
// react-refresh/only-export-components.
export interface ShiftContextValue {
  // Turno aberto do próprio utilizador (null = fora de turno).
  myShift: Shift | null
  // false enquanto a primeira lista de turnos não chegou — evita mostrar
  // avisos/bloqueios errados durante o arranque.
  shiftLoaded: boolean
  // Resultado da regra D1 já calculado: admin/cozinha/cliente → sempre true;
  // empregado/gerente → só com turno aberto.
  canOperate: boolean
}

export const ShiftContext = createContext<ShiftContextValue | null>(null)

export function useMyShift(): ShiftContextValue {
  const ctx = useContext(ShiftContext)
  if (!ctx) throw new Error('useMyShift must be used inside ShiftProvider')
  return ctx
}
