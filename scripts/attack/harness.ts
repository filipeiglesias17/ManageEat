// Harness partilhado dos scripts de ataque (pentest + stress).
//
// Porquê separado do audit.ts: o audit é a SUITE DE REGRESSÃO (prova que o bom
// passa e o óbvio mau é negado). Este harness é ADVERSÁRIO — tenta forjar/escalar
// e trata "permitido" como FALHA. Vive em scripts/ (ignorado pelo ESLint, fora do
// tsc -b e do vitest), por isso NÃO entra no `npm run gate`.
//
// Segurança: só corre contra o Supabase LOCAL (guarda assertLocal). O setup e a
// limpeza usam a SERVICE_ROLE (god mode) para montar/desmontar o "tabuleiro"; as
// provas de ataque usam clientes com role real (anon key + login), que são os
// atacantes a ser testados.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

export const SUPA_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321'
export const ANON = process.env.VITE_SUPABASE_ANON_KEY ?? ''
export const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
export const PW = process.env.AUDIT_PASSWORD ?? process.env.SEED_PASSWORD ?? 'manageeat2026!'

function hostOf(u: string): string {
  try {
    return new URL(u).hostname
  } catch {
    return ''
  }
}

// Recusa correr fora de localhost. É a guarda de segurança nº1: nunca martelar
// uma instância que não seja a local de desenvolvimento.
export function assertLocal(): void {
  const host = hostOf(SUPA_URL)
  const local = host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '0.0.0.0'
  if (!local) {
    console.error(`RECUSADO: VITE_SUPABASE_URL aponta para "${host}". Os ataques só correm contra localhost.`)
    process.exit(1)
  }
  if (!ANON) {
    console.error('Falta VITE_SUPABASE_ANON_KEY no .env.local (vê `npm run db:status`).')
    process.exit(1)
  }
}

export function anonClient(): SupabaseClient {
  return createClient(SUPA_URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
}

// Cliente god-mode só para montar/limpar fixtures (nunca é "o atacante").
export function serviceClient(): SupabaseClient {
  if (!SERVICE) {
    console.error('Falta SUPABASE_SERVICE_ROLE_KEY no .env.local (setup/teardown).')
    process.exit(1)
  }
  return createClient(SUPA_URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function signIn(c: SupabaseClient, username: string): Promise<string> {
  const { data, error } = await c.auth.signInWithPassword({
    email: `${username}@manageeat.local`,
    password: PW,
  })
  if (error || !data.user) throw new Error(`login ${username} falhou: ${error?.message}`)
  return data.user.id
}

export async function signInAnon(c: SupabaseClient): Promise<string> {
  const { data, error } = await c.auth.signInAnonymously()
  if (error || !data.user) throw new Error(`auth anónima falhou: ${error?.message}`)
  return data.user.id
}

export const rid = () => 'atk-' + Math.random().toString(16).slice(2, 12)
export const uuid = () => randomUUID()

// ── settle: nunca rebenta, devolve {data,error} ──
export type Settled = { data: unknown; error: { message?: string } | null }
export async function settle(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<Settled> {
  try {
    const r = await p
    return { data: r.data ?? null, error: (r.error as { message?: string }) ?? null }
  } catch (e) {
    return { data: null, error: (e as { message?: string }) ?? { message: 'throw' } }
  }
}

export function claimResult(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) return (data[0] as Record<string, unknown> | undefined) ?? null
  return (data as Record<string, unknown> | null) ?? null
}

// ── Relatório de findings ──
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'
export type Finding = {
  id: number
  title: string
  severity: Severity
  role: string
  held: boolean // true = a defesa aguentou; false = vulnerabilidade ABERTA
  detail: string
}

const findings: Finding[] = []

export function record(f: Omit<Finding, 'id'>): void {
  const entry: Finding = { id: findings.length + 1, ...f }
  findings.push(entry)
  const tag = f.held ? 'OK    ' : 'ABERTO'
  console.log(`[${tag}] (${f.severity.padEnd(8)}) ${f.role.padEnd(10)} ${f.title} :: ${f.detail}`)
}

// Espera que a ação seja BLOQUEADA: erro OU 0 linhas afetadas (UPDATE/DELETE
// filtrados pela USING não dão erro — precisam de .select() para devolver linhas).
export async function expectBlocked(
  title: string,
  severity: Severity,
  role: string,
  p: PromiseLike<{ data: unknown; error: unknown }>,
): Promise<void> {
  const { data, error } = await settle(p)
  if (error) {
    record({ title, severity, role, held: true, detail: 'bloqueado (erro): ' + (error.message ?? '') })
  } else if (Array.isArray(data) && data.length === 0) {
    record({ title, severity, role, held: true, detail: 'bloqueado (0 linhas afetadas)' })
  } else {
    record({ title, severity, role, held: false, detail: '*** PASSOU — devia ser bloqueado ***' })
  }
}

export async function expectClaimBlocked(
  title: string,
  severity: Severity,
  role: string,
  p: PromiseLike<{ data: unknown; error: unknown }>,
): Promise<void> {
  const { data, error } = await settle(p)
  const res = claimResult(data)
  if (error) {
    record({ title, severity, role, held: true, detail: 'bloqueado/erro' })
  } else if (res && res.ok === false) {
    record({ title, severity, role, held: true, detail: `bloqueado: ${String(res.reason)}` })
  } else {
    record({ title, severity, role, held: false, detail: '*** claim PASSOU — devia bloquear ***' })
  }
}

export function backupNow(): void {
  console.log('A criar snapshot de segurança (npm run db:backup)...')
  execFileSync('npm', ['run', 'db:backup'], { stdio: 'inherit' })
}

export function writeReport(name: string): number {
  const fails = findings.filter((f) => !f.held)
  mkdirSync('qa-artifacts', { recursive: true })
  const out = {
    generatedFor: name,
    totalProbes: findings.length,
    defensesHeld: findings.length - fails.length,
    vulnerabilitiesOpen: fails.length,
    findings,
  }
  writeFileSync(`qa-artifacts/${name}-findings.json`, JSON.stringify(out, null, 2))

  console.log('\n──────── RESUMO ' + name.toUpperCase() + ' ────────')
  console.log(`Provas: ${findings.length}  |  Defesas OK: ${findings.length - fails.length}  |  ABERTAS: ${fails.length}`)
  if (fails.length > 0) {
    console.log('Vulnerabilidades abertas:')
    for (const f of fails) console.log(`  • (${f.severity}) ${f.role} — ${f.title}: ${f.detail}`)
  }
  console.log(`Relatório JSON: qa-artifacts/${name}-findings.json`)
  return fails.length
}

export function resetFindings(): void {
  findings.length = 0
}
