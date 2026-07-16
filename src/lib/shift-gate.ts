import type { UserRole } from '../@types/user'

// Regra D1 do relógio de ponto, num sítio só (espelha operational_shift_ok()
// na base de dados): quem opera a sala — empregado e gerente — precisa de
// turno aberto. O admin (dono) é isento; a cozinha é uma conta partilhada que
// vive aberta nos ecrãs da cozinha; o cliente/anónimo nunca tem turno.
// A UI usa isto para avisar e desativar botões; a regra a sério vive nos
// triggers da BD (a UI é só a experiência simpática por cima).
export function isShiftRequired(role: UserRole | null | undefined): boolean {
  return role === 'empregado' || role === 'gerente'
}

export function canOperate(role: UserRole | null | undefined, hasOpenShift: boolean): boolean {
  if (!isShiftRequired(role)) return true
  return hasOpenShift
}

// Mensagem única para todos os botões desativados por falta de turno.
export const SHIFT_GATE_MESSAGE = 'Fora de turno — pica a entrada para começar a operar.'
