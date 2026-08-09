import { supabase } from '../supabase'

// Primeira instalação (first-run). Duas RPC da migração
// 20260705140000_first_run_bootstrap.sql: uma diz se o restaurante ainda não
// tem admin (para mostrar o ecrã de setup), a outra promove o utilizador atual
// a admin. A segurança real vive nessas funções security definer (auto-guardadas
// — recusam depois de existir admin), não aqui.

// O sistema ainda não tem administrador? (mostrar o ecrã de primeira instalação)
export async function systemNeedsSetup(): Promise<boolean> {
  const { data, error } = await supabase.rpc('system_needs_setup')
  if (error) throw error
  return data === true
}

export type BootstrapResult = { ok: boolean; reason: string | null }

// Promove o utilizador ATUAL (já autenticado por signUp) a admin. A RPC devolve
// uma tabela [{ ok, reason }] — devolvemos a 1.ª linha já normalizada.
export async function bootstrapFirstAdmin(username: string): Promise<BootstrapResult> {
  const { data, error } = await supabase.rpc('bootstrap_first_admin', { p_username: username.trim() })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return { ok: row?.ok === true, reason: row?.reason ?? null }
}
