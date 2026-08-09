// Agregador do dicionário EN. O tipo de cada namespace espelha o PT
// (ver cada ficheiro) — aqui só se junta tudo.

import { common } from './common'
import { login } from './login'
import { layout } from './layout'
import { employee } from './employee'
import { customer } from './customer'
import { kitchen } from './kitchen'
import { admin } from './admin'
import { stats } from './stats'
import { settings } from './settings'
import { users } from './users'
import { reports } from './reports'
import { errors } from './errors'

export const en = {
  common,
  login,
  layout,
  employee,
  customer,
  kitchen,
  admin,
  stats,
  settings,
  users,
  reports,
  errors,
}
