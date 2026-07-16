import { supabase, getSecondaryClient, usernameToEmail } from '../supabase'
import type { AppProfile, UserRole } from '../../@types/user'
import { dict } from '../i18n'
import { throwOnError, subscribeTable, type TableUpdate } from './base'

export function rowToProfile(r: Record<string, unknown>): AppProfile {
  const profile: AppProfile = {
    uid: r.id as string,
    username: r.username as string,
    role: r.role as UserRole,
    active: r.active as boolean,
    createdAt: r.created_at as string,
  }
  if (r.table_number != null) profile.tableNumber = Number(r.table_number)
  return profile
}

export async function getProfiles(): Promise<AppProfile[]> {
  const { data, error } = await supabase.from('profiles').select('*')
  throwOnError(error)
  return (data ?? []).map(rowToProfile)
}

export async function getProfile(uid: string): Promise<AppProfile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle()
  throwOnError(error)
  if (!data) return null
  return rowToProfile(data as Record<string, unknown>)
}

export function subscribeProfile(
  uid: string,
  callback: (profile: AppProfile | null) => void,
): () => void {
  return subscribeTable('profiles', () => getProfile(uid), callback, { filter: `id=eq.${uid}` })
}

export async function adminCreateUser(input: {
  username: string
  password: string
  role: UserRole
  tableNumber?: number
}): Promise<AppProfile> {
  const email = usernameToEmail(input.username)
  const secondary = getSecondaryClient()

  const { data, error } = await secondary.auth.signUp({ email, password: input.password })
  if (error) throw error
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new Error(dict().errors.userAlreadyExists)
  }
  const uid = data.user?.id
  if (!uid) throw new Error(dict().errors.userAuthCreateFailed)

  const createdAt = new Date().toISOString()
  const { error: insertError } = await supabase.from('profiles').insert({
    id: uid,
    username: input.username.trim(),
    role: input.role,
    active: true,
    created_at: createdAt,
    table_number: input.tableNumber ?? null,
  })
  throwOnError(insertError)

  await secondary.auth.signOut()

  const profile: AppProfile = {
    uid,
    username: input.username.trim(),
    role: input.role,
    active: true,
    createdAt,
  }
  if (input.tableNumber !== undefined) profile.tableNumber = input.tableNumber
  return profile
}

export async function updateProfile(
  uid: string,
  data: Partial<Pick<AppProfile, 'username' | 'role' | 'active' | 'tableNumber'>>,
): Promise<void> {
  const row: Record<string, unknown> = {}
  if ('username' in data) row.username = data.username
  if ('role' in data) row.role = data.role
  if ('active' in data) row.active = data.active
  if ('tableNumber' in data) row.table_number = data.tableNumber
  const { error } = await supabase.from('profiles').update(row as TableUpdate<'profiles'>).eq('id', uid)
  throwOnError(error)
}

export async function deactivateProfile(uid: string): Promise<void> {
  const { error } = await supabase.from('profiles').update({ active: false }).eq('id', uid)
  throwOnError(error)
}

// Admin redefine a password de outro utilizador. A operação privilegiada vive
// no Postgres (RPC admin_set_user_password, SECURITY DEFINER) — o browser nunca
// vê a service_role. A própria função valida is_admin(), o mínimo de 12 e recusa
// alvos admin; os erros voltam como códigos err_ (traduzidos por base.ts).
export async function adminSetUserPassword(uid: string, password: string): Promise<void> {
  const { error } = await supabase.rpc('admin_set_user_password', {
    p_user_id: uid,
    p_password: password,
  })
  throwOnError(error)
}

export function subscribeProfiles(callback: (profiles: AppProfile[]) => void): () => void {
  return subscribeTable('profiles', getProfiles, callback)
}
