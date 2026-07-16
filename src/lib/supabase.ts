import { createClient, type SupabaseClient } from '@supabase/supabase-js'
// Tipos gerados do schema Supabase local (npx supabase gen types typescript
// --local > src/lib/database.types.ts). Só dão segurança em COMPILAÇÃO — não
// mudam runtime. Regenerar sempre que o schema mudar.
import type { Database } from './database.types'
import { normalizeServerUrl } from './validation'
import { bumpServerEpoch } from './server-epoch'
import { SUPABASE_HTTP_PORT, STAFF_TLS_PORT } from './server-ports'
import { resolvePublicStorageReference } from './storage-url'

// Cliente Supabase (substitui o antigo firebase.ts). O backend é o Supabase
// LOCAL (Docker) — Postgres + Auth + Realtime. As credenciais vêm do .env.local:
//   VITE_SUPABASE_URL       (ex.: http://127.0.0.1:54321)
//   VITE_SUPABASE_ANON_KEY  (corre `npx supabase status` para a obter)

// Servidor manual (ecrã "Definições de ligação"): guardado em localStorage.
// Quando existe, ganha sempre sobre a deteção automática (ver network-discovery.ts)
// e é lido já aqui para o PRIMEIRO cliente apontar ao servidor certo, sem reiniciar.
const SERVER_OVERRIDE_KEY = 'manage-eat-server-override'

export function getServerOverride(): string | null {
  if (typeof localStorage === 'undefined') return null
  const value = localStorage.getItem(SERVER_OVERRIDE_KEY)
  return value && value.trim() !== '' ? value : null
}

// Último servidor que respondeu a um health check (ver network-discovery.ts).
// Serve para a app religar sozinha ao endereço conhecido em vez de cair sempre
// no IP queimado no build (que fica desatualizado quando o IP da máquina muda).
const LAST_GOOD_KEY = 'manage-eat-last-good-server'

export function getLastGoodServer(): string | null {
  if (typeof localStorage === 'undefined') return null
  const value = localStorage.getItem(LAST_GOOD_KEY)
  return value && value.trim() !== '' ? value : null
}

// Grava o último servidor bom. Valida (http(s) sem barra final) para não guardar
// lixo que depois seria tentado às cegas no arranque.
export function rememberLastGoodServer(url: string): void {
  if (typeof localStorage === 'undefined') return
  const normalized = normalizeServerUrl(url)
  if (!normalized) return
  localStorage.setItem(LAST_GOOD_KEY, normalized)
}

// ── Modelo de ligação: público (QR) em HTTP vs staff (login) em HTTPS ───────
// Os clientes entram pelo QR (/mesa/*) no browser da LAN e NÃO confiam no
// certificado local → falam HTTP direto com o Supabase. Tudo o resto tem login
// (staff, aparelho controlado que confia na CA) → fala HTTPS pelo mini-proxy TLS
// (scripts/tls-proxy.ts), por isso passwords e pagamentos viajam encriptados.
const PUBLIC_SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? `http://127.0.0.1:${SUPABASE_HTTP_PORT}`

function isPublicQrContext(): boolean {
  if (typeof window === 'undefined') return false
  return window.location.pathname.startsWith('/mesa/')
}

// A partir do URL público (http:54321) deriva o URL do staff (https no proxy).
function toStaffTlsUrl(publicUrl: string): string {
  try {
    const url = new URL(publicUrl)
    url.protocol = 'https:'
    url.port = String(STAFF_TLS_PORT)
    return url.toString().replace(/\/$/, '')
  } catch {
    return publicUrl
  }
}

// URL por omissão conforme o contexto: público → http direto; staff → https proxy.
function defaultSupabaseUrl(): string {
  if (isPublicQrContext()) return PUBLIC_SUPABASE_URL
  return toStaffTlsUrl(PUBLIC_SUPABASE_URL)
}

// Ordem do palpite inicial: no QR (público) é sempre http direto, ignorando
// override/último-bom (um telemóvel de cliente não tem nem deve usar o https do
// staff). No staff: manual > último bom > default do build (https proxy). A
// descoberta async em network-discovery.ts ainda pode trocar se este não responder.
function initialConfiguredUrl(): string {
  if (isPublicQrContext()) return PUBLIC_SUPABASE_URL
  return getServerOverride() ?? getLastGoodServer() ?? defaultSupabaseUrl()
}
let currentSupabaseUrl = resolveSupabaseUrl(initialConfiguredUrl())
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseAnonKey) {
  throw new Error(
    'Falta VITE_SUPABASE_ANON_KEY no .env.local. Arranca o Supabase local com ' +
    '`npx supabase start` e copia a anon key de `npx supabase status`.',
  )
}

// O narrowing do `if (!x) throw` não entra em funções aninhadas
// (getSecondaryClient), por isso fixamos o tipo `string` numa const dedicada.
const anonKey: string = supabaseAnonKey

function resolveSupabaseUrl(configuredUrl: string): string {
  if (typeof window === 'undefined') return configuredUrl

  const isCapacitor = typeof window !== 'undefined' && !!window.Capacitor
  const localNetworkHost = import.meta.env.VITE_LOCAL_NETWORK_HOST

  // Se for Capacitor, forçamos o uso do IP da rede local da máquina de desenvolvimento
  // para permitir ligações ao Supabase local a partir de emuladores/dispositivos.
  if (isCapacitor && localNetworkHost) {
    try {
      const url = new URL(configuredUrl)
      const configuredHostIsLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
      if (configuredHostIsLocal) {
        url.hostname = localNetworkHost
        return url.toString().replace(/\/$/, '')
      }
    } catch {
      // Ignorar erro de parsing de URL
    }
  }

  const pageHost = window.location.hostname
  const pageIsLocal = pageHost === 'localhost' || pageHost === '127.0.0.1'
  if (pageIsLocal) return configuredUrl

  try {
    const url = new URL(configuredUrl)
    const configuredHostIsLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    if (!configuredHostIsLocal) return configuredUrl

    url.hostname = pageHost
    return url.toString().replace(/\/$/, '')
  } catch {
    return configuredUrl
  }
}

// ── "Lembrar sessão" (local vs só-esta-aba) ────────────────────────────────
// O supabase-js guarda a sessão num único storage. Para manter o
// comportamento antigo (Firebase: browserLocalPersistence vs
// browserSessionPersistence), usamos um adaptador que escolhe localStorage
// (sobrevive a fechar o browser) ou sessionStorage (só esta aba) conforme um
// flag. O Login chama setRememberSession() ANTES do signIn para o token ir
// para o storage certo.
const REMEMBER_KEY = 'manage-eat-remember'

function activeStorage(): Storage {
  // Default: lembrar (localStorage). Só 'false' explícito usa sessionStorage.
  const remember = localStorage.getItem(REMEMBER_KEY) !== 'false'
  return remember ? window.localStorage : window.sessionStorage
}

// Em contextos sem DOM (Node, testes) não há window/localStorage. Guardamos aqui
// para o supabase-js poder carregar a sessão sem rebentar: sem storage = sem
// sessão persistida (inócuo fora do browser). No browser o caminho é o normal.
const hybridStorage = {
  getItem: (key: string) => (typeof window === 'undefined' ? null : activeStorage().getItem(key)),
  setItem: (key: string, value: string) => {
    if (typeof window !== 'undefined') activeStorage().setItem(key, value)
  },
  removeItem: (key: string) => {
    if (typeof window !== 'undefined') activeStorage().removeItem(key)
  },
}

export function setRememberSession(remember: boolean): void {
  localStorage.setItem(REMEMBER_KEY, remember ? 'true' : 'false')
}

let activeSupabase = createClient<Database>(currentSupabaseUrl, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // App SPA sem callbacks de OAuth na URL — desligar evita parsing inútil.
    detectSessionInUrl: false,
    storage: hybridStorage,
  },
})

export const supabase = new Proxy(activeSupabase, {
  get(_target, prop) {
    const value = Reflect.get(activeSupabase, prop)
    if (typeof value === 'function') {
      return (value as (...args: unknown[]) => unknown).bind(activeSupabase)
    }
    return value
  },
  set(_target, prop, value) {
    return Reflect.set(activeSupabase, prop, value)
  }
})

export function updateSupabaseServerUrl(newUrl: string): void {
  const resolvedUrl = resolveSupabaseUrl(newUrl)
  // Se o servidor não mudou, NÃO recriamos o cliente — recriar mataria as
  // subscrições Realtime ativas (ficariam órfãs). Só trocamos quando muda mesmo.
  //
  // Quando MUDA, recriar o cliente orfaniza tudo o que estava ligado ao cliente
  // antigo: o listener de auth E as subscrições Realtime de negócio (orders,
  // sessions, profile, service_calls, OTA). Resolvemos isso com bumpServerEpoch()
  // no fim — a "época" sobe, a árvore React remonta (key no AppRoot, main.tsx) e
  // cada subscrição liga-se de novo ao cliente novo. Cobre tanto a troca manual
  // (Definições de ligação) como a automática via 'resume' (IP do Mac mudou).
  if (resolvedUrl === currentSupabaseUrl) return
  currentSupabaseUrl = resolvedUrl

  // Largar o cliente antigo: fechar as subscrições Realtime que tinha abertas
  // para a websocket dele não ficar pendurada a cada troca de servidor. Os
  // componentes vão remontar (bumpServerEpoch) e voltar a subscrever no novo.
  const previousClient = activeSupabase
  void previousClient.removeAllChannels().catch(() => {})

  activeSupabase = createClient<Database>(resolvedUrl, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: hybridStorage,
    },
  })
  activeSecondaryClient = null

  // Avisar a app de que o cliente mudou → remonta a árvore → tudo re-subscreve.
  bumpServerEpoch()
}

// URL que o cliente está mesmo a usar agora (para health checks no arranque/definições).
export function getCurrentSupabaseUrl(): string {
  return currentSupabaseUrl
}

// URL por omissão do build (IP da LAN queimado no VITE_LOCAL_NETWORK_HOST),
// independente de override/last-good. É o último candidato da descoberta. Segue
// o contexto: público → http direto; staff → https pelo proxy.
export function getBuildDefaultUrl(): string {
  return resolveSupabaseUrl(defaultSupabaseUrl())
}

// Define o servidor manual: grava em localStorage e aplica-o já ao cliente.
export function setServerOverride(url: string): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(SERVER_OVERRIDE_KEY, url)
  }
  updateSupabaseServerUrl(url)
}

// Limpa o servidor manual e volta ao servidor por omissão do build (do contexto).
export function clearServerOverride(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(SERVER_OVERRIDE_KEY)
  }
  updateSupabaseServerUrl(defaultSupabaseUrl())
}

// ── Cliente secundário (admin/gerente cria contas) ─────────────────────────
// `signUp` autentica o novo utilizador NO cliente onde corre. Para o admin não
// perder a própria sessão, fazemos o signUp num cliente isolado: persistSession
// false (não escreve no storage) e storageKey próprio. É o equivalente ao
// "secondary app trick" do Firebase.
let activeSecondaryClient: SupabaseClient | null = null
let secondaryClientProxy: SupabaseClient | null = null

function getActiveSecondaryClient(): SupabaseClient {
  if (!activeSecondaryClient) {
    activeSecondaryClient = createClient<Database>(currentSupabaseUrl, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: 'manage-eat-admin-create',
      },
    })
  }
  return activeSecondaryClient
}

export function getSecondaryClient(): SupabaseClient {
  if (!secondaryClientProxy) {
    const initialClient = getActiveSecondaryClient()
    secondaryClientProxy = new Proxy(initialClient, {
      get(_target, prop) {
        const client = getActiveSecondaryClient()
        const value = Reflect.get(client, prop)
        if (typeof value === 'function') {
          return (value as (...args: unknown[]) => unknown).bind(client)
        }
        return value
      },
      set(_target, prop, value) {
        const client = getActiveSecondaryClient()
        return Reflect.set(client, prop, value)
      }
    })
  }
  return secondaryClientProxy
}

// Garante uma sessão (anónima) para o fluxo /mesa: a leitura é pública, mas
// criar pedidos / gravar o código de acesso exige estar autenticado.
export async function ensureAnonymousSession(): Promise<void> {
  const { data } = await supabase.auth.getSession()
  if (!data.session) {
    await supabase.auth.signInAnonymously()
  }
}

// Sem Admin SDK no Firebase, derivávamos um email técnico do username. Mantemos
// a convenção no Supabase Auth (não há email real a pedir ao utilizador).
const EMAIL_DOMAIN = '@manageeat.local'
export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}${EMAIL_DOMAIN}`
}

// ── Imagens do Storage (acesso em rede local) ──────────────────────────────
// As URLs de imagens são guardadas na BD com o host do momento do upload
// (tipicamente http://127.0.0.1:54321). Quando a app é acedida via IP de rede
// (ex: http://192.168.1.x) a partir de um telemóvel, esse host é inatingível.
// Esta função substitui o host por window.location.hostname, tal como faz
// `resolveSupabaseUrl` para a conexão ao Supabase.
export function resolveStorageUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined
  if (typeof window === 'undefined') return url

  // Referências do Supabase Storage seguem SEMPRE o servidor ativo. Isto cobre
  // tanto o formato novo (caminho estável) como URLs antigos com um IP gravado.
  const currentStorageUrl = resolvePublicStorageReference(url, currentSupabaseUrl)
  if (currentStorageUrl !== url || url.startsWith('/storage/v1/object/public/')) {
    return currentStorageUrl
  }

  // Servidor manual definido → as imagens do Storage seguem o mesmo host/porta
  // do override (senão apontavam para o IP do build e davam 404).
  const override = getServerOverride()
  if (override) {
    try {
      const parsed = new URL(url)
      const overrideUrl = new URL(override)
      const storedHostIsLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
      if (storedHostIsLocal) {
        parsed.protocol = overrideUrl.protocol
        parsed.hostname = overrideUrl.hostname
        parsed.port = overrideUrl.port
        return parsed.toString()
      }
    } catch {
      // Ignorar erro de parsing de URL
    }
  }

  const isCapacitor = typeof window !== 'undefined' && !!window.Capacitor
  const localNetworkHost = import.meta.env.VITE_LOCAL_NETWORK_HOST

  if (isCapacitor && localNetworkHost) {
    try {
      const parsed = new URL(url)
      const storedHostIsLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
      if (storedHostIsLocal) {
        parsed.hostname = localNetworkHost
        return parsed.toString()
      }
    } catch {
      // Ignorar erro de parsing de URL
    }
  }

  const pageHost = window.location.hostname
  const pageIsLocal = pageHost === 'localhost' || pageHost === '127.0.0.1'
  if (pageIsLocal) return url

  try {
    const parsed = new URL(url)
    const storedHostIsLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
    if (!storedHostIsLocal) return url
    parsed.hostname = pageHost
    return parsed.toString()
  } catch {
    return url
  }
}
