// Estado de um formulário de utilizador (criar OU editar). Junta os campos, o
// erro e a flag de gravação que antes eram useState soltos no admin-dashboard.
// O editar não usa a password (no Spark não dá para a trocar pelo browser).

import { useState } from 'react'
import type { UserRole } from '../@types/user'

export type UserFormFields = {
  username: string
  password: string
  role: UserRole
  // Mesa da conta cliente (string porque vem de um <input>). Só é usada/validada
  // quando role === 'cliente'; nos outros roles fica vazia e é ignorada.
  tableNumber: string
}

function emptyFields(): UserFormFields {
  return { username: '', password: '', role: 'empregado', tableNumber: '' }
}

export function useUserForm() {
  const [fields, setFields] = useState<UserFormFields>(emptyFields)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  function setField<K extends keyof UserFormFields>(key: K, value: UserFormFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }))
  }
  function reset() {
    setFields(emptyFields())
    setError('')
  }
  function load(user: { username: string; role: UserRole; tableNumber?: number }) {
    setFields({
      username: user.username,
      password: '',
      role: user.role,
      tableNumber: user.tableNumber != null ? String(user.tableNumber) : '',
    })
    setError('')
  }

  return { fields, setField, error, setError, saving, setSaving, reset, load }
}
