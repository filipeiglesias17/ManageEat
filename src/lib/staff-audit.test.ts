import { describe, it, expect } from 'vitest'
import { buildUidNameMap, shiftDurationHours, staffAuditStats } from './staff-audit'
import type { AppProfile } from '../@types/user'
import type { Shift } from '../@types/shift'
import { makeOrder, makePayment } from '../test/factories'

//  Helpers de fixture
//
// O AppProfile e o Shift não têm factory própria, por isso montamos objetos
// literais mínimos só com os campos que a auditoria lê.

function makeProfile(overrides: Partial<AppProfile> = {}): AppProfile {
  return {
    uid: 'uid-anon',
    username: 'anon',
    role: 'empregado',
    active: true,
    createdAt: '2026-06-01T10:00:00',
    ...overrides,
  }
}

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    openedAt: '2026-06-19T09:00:00',
    openedBy: 'uid-anon',
    status: 'open',
    ...overrides,
  }
}

describe('buildUidNameMap', () => {
  it('mapeia cada uid para o seu username', () => {
    const profiles = [
      makeProfile({ uid: 'u1', username: 'ana' }),
      makeProfile({ uid: 'u2', username: 'bruno' }),
    ]
    const map = buildUidNameMap(profiles)
    expect(map.get('u1')).toBe('ana')
    expect(map.get('u2')).toBe('bruno')
  })

  it('um uid ausente no map vira "—" na linha de auditoria', () => {
    // Só temos o nome do u1; o pagamento do u2 não tem nome conhecido.
    const uidNames = buildUidNameMap([makeProfile({ uid: 'u1', username: 'ana' })])
    const payments = [
      makePayment({ createdBy: 'u1', amount: 10 }),
      makePayment({ createdBy: 'u2', amount: 20 }),
    ]
    const rows = staffAuditStats([], payments, [], uidNames)

    const semNome = rows.find((row) => row.uid === 'u2')
    expect(semNome?.name).toBe('—')
  })
})

describe('staffAuditStats — cancelamentos', () => {
  it('conta os orders cujo cancelledBy é o uid', () => {
    const uidNames = buildUidNameMap([makeProfile({ uid: 'u1', username: 'ana' })])
    const orders = [
      makeOrder({ cancelledBy: 'u1' }),
      makeOrder({ cancelledBy: 'u1' }),
      makeOrder({ cancelledBy: undefined }), // não conta
    ]
    const rows = staffAuditStats(orders, [], [], uidNames)

    const ana = rows.find((row) => row.uid === 'u1')
    expect(ana?.cancellations).toBe(2)
  })
})

describe('staffAuditStats — pagamentos registados', () => {
  it('soma só os pagamentos NÃO anulados de createdBy', () => {
    const uidNames = buildUidNameMap([makeProfile({ uid: 'u1', username: 'ana' })])
    const payments = [
      makePayment({ createdBy: 'u1', amount: 30 }),
      makePayment({ createdBy: 'u1', amount: 20 }),
      // Anulado: não entra nem na contagem nem no valor registado.
      makePayment({ createdBy: 'u1', amount: 99, voidedAt: '2026-06-19T13:00:00', voidedBy: 'u1', voidReason: 'Erro' }),
    ]
    const rows = staffAuditStats([], payments, [], uidNames)

    const ana = rows.find((row) => row.uid === 'u1')
    expect(ana?.paymentsRegistered).toBe(2)
    expect(ana?.amountRegistered).toBe(50)
  })
})

describe('staffAuditStats — pagamentos anulados', () => {
  it('conta as anulações por voidedBy (ação à parte do registo)', () => {
    const uidNames = buildUidNameMap([
      makeProfile({ uid: 'u1', username: 'ana' }),
      makeProfile({ uid: 'u2', username: 'bruno' }),
    ])
    // Ana registou; Bruno anulou. A anulação conta para o Bruno.
    const payments = [
      makePayment({ createdBy: 'u1', amount: 40, voidedAt: '2026-06-19T13:00:00', voidedBy: 'u2', voidReason: 'Erro' }),
    ]
    const rows = staffAuditStats([], payments, [], uidNames)

    const bruno = rows.find((row) => row.uid === 'u2')
    expect(bruno?.paymentsVoided).toBe(1)
    // Ana não soma valor: o pagamento dela ficou anulado.
    const ana = rows.find((row) => row.uid === 'u1')
    expect(ana?.amountRegistered).toBe(0)
    expect(ana?.paymentsRegistered).toBe(0)
  })
})

describe('staffAuditStats — turnos', () => {
  it('conta turnos abertos por openedBy e fechados por closedBy', () => {
    const uidNames = buildUidNameMap([
      makeProfile({ uid: 'u1', username: 'ana' }),
      makeProfile({ uid: 'u2', username: 'bruno' }),
    ])
    const shifts = [
      makeShift({ id: 's1', openedBy: 'u1', closedBy: 'u2', closedAt: '2026-06-19T18:00:00', status: 'closed' }),
      makeShift({ id: 's2', openedBy: 'u1', closedBy: undefined, status: 'open' }),
    ]
    const rows = staffAuditStats([], [], shifts, uidNames)

    const ana = rows.find((row) => row.uid === 'u1')
    const bruno = rows.find((row) => row.uid === 'u2')
    expect(ana?.shiftsOpened).toBe(2)
    expect(ana?.shiftsClosed).toBe(0)
    expect(bruno?.shiftsOpened).toBe(0)
    expect(bruno?.shiftsClosed).toBe(1)
  })

  it('soma as horas trabalhadas para quem ABRIU o turno, mesmo num fecho forçado', () => {
    const uidNames = buildUidNameMap([
      makeProfile({ uid: 'u1', username: 'ana' }),
      makeProfile({ uid: 'u2', username: 'bruno' }),
    ])
    const shifts = [
      // 9h de trabalho da Ana; o fecho foi forçado pelo Bruno (chefe), mas as
      // horas são de quem trabalhou o turno.
      makeShift({ id: 's1', openedAt: '2026-06-19T09:00:00', closedAt: '2026-06-19T18:00:00', openedBy: 'u1', closedBy: 'u2', status: 'closed' }),
      // Turno ainda aberto: sem duração conhecida, não soma horas.
      makeShift({ id: 's2', openedBy: 'u1', status: 'open' }),
    ]
    const rows = staffAuditStats([], [], shifts, uidNames)

    const ana = rows.find((row) => row.uid === 'u1')
    const bruno = rows.find((row) => row.uid === 'u2')
    expect(ana?.hoursWorked).toBe(9)
    expect(bruno?.hoursWorked).toBe(0)
  })
})

describe('shiftDurationHours', () => {
  it('devolve a duração em horas decimais de um turno fechado', () => {
    const shift = makeShift({
      openedAt: '2026-06-19T09:00:00',
      closedAt: '2026-06-19T13:30:00',
      status: 'closed',
    })
    expect(shiftDurationHours(shift)).toBe(4.5)
  })

  it('devolve null enquanto o turno está aberto', () => {
    expect(shiftDurationHours(makeShift({ status: 'open' }))).toBeNull()
  })
})

describe('staffAuditStats — só inclui uids presentes e ordena', () => {
  it('não cria linhas para staff sem qualquer atividade', () => {
    const uidNames = buildUidNameMap([
      makeProfile({ uid: 'u1', username: 'ana' }),
      makeProfile({ uid: 'sem-atividade', username: 'carlos' }),
    ])
    const payments = [makePayment({ createdBy: 'u1', amount: 10 })]
    const rows = staffAuditStats([], payments, [], uidNames)

    expect(rows.map((row) => row.uid)).toEqual(['u1'])
  })

  it('ordena as linhas por amountRegistered descendente', () => {
    const uidNames = buildUidNameMap([
      makeProfile({ uid: 'u1', username: 'ana' }),
      makeProfile({ uid: 'u2', username: 'bruno' }),
      makeProfile({ uid: 'u3', username: 'carlos' }),
    ])
    const payments = [
      makePayment({ createdBy: 'u1', amount: 10 }),
      makePayment({ createdBy: 'u2', amount: 100 }),
      makePayment({ createdBy: 'u3', amount: 50 }),
    ]
    const rows = staffAuditStats([], payments, [], uidNames)

    expect(rows.map((row) => row.uid)).toEqual(['u2', 'u3', 'u1'])
  })
})
