import { createContext, useContext } from 'react'
import type { User } from '@supabase/supabase-js'
import type { AppProfile } from '../@types/user'

export interface AuthContextValue {
  user: User | null
  profile: AppProfile | null
  // `loading = true` enquanto o Supabase ainda não respondeu com o estado
  // inicial. Componentes que dependam do role devem mostrar placeholder.
  loading: boolean
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
