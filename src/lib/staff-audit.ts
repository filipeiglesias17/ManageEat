// Auditoria de atividade do staff para os relatórios exportados. Resolve
// uid → nome e agrega SÓ as contagens necessárias (minimização RGPD: não
// expomos mais dados pessoais do que o relatório precisa).

import type { Order } from '../@types/order'
import type { Payment } from '../@types/payment'
import type { Shift } from '../@types/shift'
import type { AppProfile } from '../@types/user'
import { isVoidedPayment } from './stats'

// uid → username. Serve para mostrar nomes em vez de ids nos relatórios.
export function buildUidNameMap(profiles: AppProfile[]): Map<string, string> {
  const map = new Map<string, string>()
  profiles.forEach((profile) => {
    map.set(profile.uid, profile.username)
  })
  return map
}

export type StaffAuditRow = {
  uid: string
  name: string
  cancellations: number
  paymentsRegistered: number
  amountRegistered: number
  paymentsVoided: number
  shiftsOpened: number
  shiftsClosed: number
  // Horas trabalhadas (decimais), somadas dos turnos fechados que a pessoa
  // abriu  o relógio de ponto do empregado.
  hoursWorked: number
}

// Duração de um turno em horas decimais. null enquanto está aberto  a duração
// só é conhecida depois de picar a saída.
export function shiftDurationHours(shift: Shift): number | null {
  if (!shift.closedAt) return null
  const openedMs = Date.parse(shift.openedAt)
  const closedMs = Date.parse(shift.closedAt)
  if (!Number.isFinite(openedMs) || !Number.isFinite(closedMs)) return null
  return Math.max(0, closedMs - openedMs) / 3_600_000
}

// Estrutura mutável usada só enquanto agregamos. No fim convertemos para
// StaffAuditRow (que já inclui o nome resolvido).
type Counters = Omit<StaffAuditRow, 'uid' | 'name'>

function emptyCounters(): Counters {
  return {
    cancellations: 0,
    paymentsRegistered: 0,
    amountRegistered: 0,
    paymentsVoided: 0,
    shiftsOpened: 0,
    shiftsClosed: 0,
    hoursWorked: 0,
  }
}

// Devolve (criando se preciso) o contador de um uid. Mantém o map agrupado por
// pessoa sem repetir a verificação de "já existe?" em cada sítio.
function counterFor(map: Map<string, Counters>, uid: string): Counters {
  const existing = map.get(uid)
  if (existing) return existing
  const fresh = emptyCounters()
  map.set(uid, fresh)
  return fresh
}

// Agrega a atividade de staff a partir do que os dados REALMENTE registam.
// Nota importante: os orders não guardam quem os criou (só `cancelledBy`), por
// isso NÃO contamos "pedidos lançados"  só cancelamentos.
export function staffAuditStats(
  orders: Order[],
  payments: Payment[],
  shifts: Shift[],
  uidNames: Map<string, string>,
): StaffAuditRow[] {
  const byUid = new Map<string, Counters>()

  //  Cancelamentos: orders com cancelledBy
  orders.forEach((order) => {
    if (!order.cancelledBy) return
    counterFor(byUid, order.cancelledBy).cancellations += 1
  })

  //  Pagamentos
  payments.forEach((payment) => {
    // Quem registou o pagamento aparece SEMPRE na auditoria (mesmo que o
    // pagamento tenha sido anulado  para a auditoria não esconder quem fez o
    // quê). Mas a contagem/valor só somam se não estiver anulado, senão
    // inflávamos a "caixa" de quem registou algo que foi depois desfeito.
    if (payment.createdBy) {
      const counters = counterFor(byUid, payment.createdBy)
      if (!isVoidedPayment(payment)) {
        counters.paymentsRegistered += 1
        counters.amountRegistered += payment.amount
      }
    }
    // Quem anulou o pagamento (ação à parte, sempre contada).
    if (payment.voidedBy) {
      counterFor(byUid, payment.voidedBy).paymentsVoided += 1
    }
  })

  //  Turnos (ponto): quem picou entrada / quem fechou / horas
  shifts.forEach((shift) => {
    if (shift.openedBy) {
      const counters = counterFor(byUid, shift.openedBy)
      counters.shiftsOpened += 1
      // As horas são de quem TRABALHOU o turno (openedBy), mesmo que o fecho
      // tenha sido forçado por um responsável (closedBy diferente).
      const hours = shiftDurationHours(shift)
      if (hours != null) {
        counters.hoursWorked += hours
      }
    }
    if (shift.closedBy) {
      counterFor(byUid, shift.closedBy).shiftsClosed += 1
    }
  })

  // Converter para linhas com o nome resolvido. Staff apagado (sem entrada no
  // map de nomes) fica como ''.
  const rows: StaffAuditRow[] = []
  byUid.forEach((counters, uid) => {
    rows.push({
      uid,
      name: uidNames.get(uid) ?? '—',
      ...counters,
    })
  })

  // Ordenar por valor registado (desc): quem mais fechou caixa fica no topo.
  rows.sort((a, b) => b.amountRegistered - a.amountRegistered)
  return rows
}
