import { getLocale } from './i18n'
import { getCurrentSupabaseUrl } from './supabase'

// Helpers pequenos partilhados por várias páginas/componentes. Foram juntos
// aqui para evitar copiar-colar a mesma lógica (antes estavam repetidos no
// cliente, no empregado e nas sessões do admin).

// Aceita apenas inteiros >= 1. Devolve null quando o valor não é válido.
// Usado em todos os campos "Nº da mesa".
export function parseTableNumber(raw: string): number | null {
  const n = Number(raw)
  if (!raw || !Number.isInteger(n) || n < 1) return null
  return n
}

// Gera um id hexadecimal aleatório com `byteLength` bytes (2 chars por byte).
// Serve para uids de linhas do carrinho (só runtime) e para ids de sessão QR.
// Não precisa de entropia criptográfica forte  só de ser único o suficiente.
export function randomHexId(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// UUID aleatório para o `requestId` dos pedidos (id do documento = idempotência).
//
// O nativo `crypto.randomUUID()` só existe em CONTEXTOS SEGUROS (HTTPS ou
// localhost). No fluxo QR o telemóvel abre a app por `http://<IP-local>`  que
// não é contexto seguro  e `crypto.randomUUID` fica indefinido, rebentando o
// envio do pedido. O `crypto.getRandomValues` (abaixo) funciona em qualquer
// contexto, por isso usamo-lo como fallback gerando um UUID v4 à mão.
export function randomUUID(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()

  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  // Marca a versão (4) e a variante conforme o RFC 4122.
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-')
}

// Hash do código de acesso da sessão QR.
//
// É de propósito um hash SÍNCRONO e simples (variante do cyrb53), NÃO o
// `crypto.subtle.digest`: o telemóvel do cliente abre a app por `http://<IP>`
// contexto não seguro, onde `crypto.subtle` fica indefinido (mesma razão do
// randomUUID acima). Isto é ofuscação/deterrência ao nível da app  evita que o
// código apareça em claro no browser , não criptografia.
export function hashAccessCode(code: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < code.length; i++) {
    const ch = code.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const hash = 4294967296 * (2097151 & h2) + (h1 >>> 0)
  return hash.toString(16)
}

// Porta do dev server Vite (host 0.0.0.0, porta default). Protótipo LAN-only,
// sem deploy  uma constante chega, não precisa de env var.
const LOCAL_WEB_PORT = '5173'

// Hosts que apontam para o próprio dispositivo (não servem para o QR do cliente).
// Cobre IPv4 loopback (127.x), 'localhost' e IPv6 loopback (com e sem brackets).
function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname.startsWith('127.')
  )
}

// IP da LAN para meter no QR. Ordem:
//   1) host do Supabase ATIVO  reflete override manual / último-bom / build, por
//      isso acompanha o IP atual mesmo que o do build esteja desatualizado;
//   2) IP queimado no build (VITE_LOCAL_NETWORK_HOST);
//   3) null quando não há nenhum IP de rede utilizável.
function lanIpForQr(): string | null {
  try {
    const activeHost = new URL(getCurrentSupabaseUrl()).hostname
    if (activeHost && !isLoopbackHostname(activeHost)) return activeHost
  } catch {
    // URL inválido  ignora e tenta o fallback do build.
  }
  const baked = import.meta.env.VITE_LOCAL_NETWORK_HOST
  if (baked && !isLoopbackHostname(baked)) return baked
  return null
}

// URL que o cliente abre ao ler o QR. Tem de ser http://<IP-LAN>:<porta-web> para
// o telemóvel do cliente (sem app) abrir no browser  nunca capacitor:// nem o IP
// sem porta. Dentro da app nativa, window.location é capacitor://localhost (iOS)
// ou https://localhost (Android), por isso não serve para construir o link.
// Em http puro de propósito: o dev server Vite serve http na LAN e o cliente abre
// por http (mesma razão de evitarmos crypto.subtle/randomUUID nativo acima).
export function sessionUrl(sessionId: string): string {
  // Rota canónica EN. Os QR já impressos com /mesa/:id continuam a funcionar
  // (o router redireciona /mesa → /table preservando o id).
  const path = `/table/${sessionId}`
  const isCapacitor = typeof window !== 'undefined' && !!window.Capacitor
  const hostname = window.location.hostname

  // Browser já servido por um host de rede real: a origin já é o URL público
  // correto (mantém porta e protocolo da página). Ex.: http://192.168.1.50:5173.
  if (!isCapacitor && !isLoopbackHostname(hostname)) {
    return `${window.location.origin}${path}`
  }

  // App nativa (capacitor://localhost / https://localhost) ou dev em loopback:
  // construir http://<IP-LAN>:<porta-web>. Em Capacitor window.location.port é
  // '' → cai no LOCAL_WEB_PORT; no browser loopback usa a porta da página.
  const lanIp = lanIpForQr()
  if (lanIp) {
    const webPort = window.location.port || LOCAL_WEB_PORT
    return `http://${lanIp}:${webPort}${path}`
  }

  // Sem IP da LAN conhecido (ex.: sem rede, build com host 'localhost'): melhor
  // esforço com a origin atual. O QR pode não ser abrível, mas não há candidato
  // melhor neste cenário.
  return `${window.location.origin}${path}`
}

// Hora local (HH:MM, ou HH:MM:SS com seconds=true). Centralizado para não
// repetir o mesmo `toLocaleTimeString` em várias páginas e para devolver ""
// em vez de "Invalid Date" quando o createdAt vier corrompido.
export function formatTime(iso: string, seconds = false): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString(getLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds && { second: '2-digit' }),
  })
}

// Data local (DD/MM/AAAA). Devolve "" para datas inválidas.
export function formatDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(getLocale())
}

// Data + hora local. Útil em tabelas/exportações onde queremos uma leitura
// humana e consistente, sem arriscar "Invalid Date" no ecrã.
export function formatDateTime(iso: string, options?: Intl.DateTimeFormatOptions): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString(getLocale(), options)
}

// Duração em texto humano a partir de milissegundos: "2h 05m" por defeito, ou
// "2h 05m 12s" com `seconds`. Usado nas durações do ponto (histórico de turnos
// e cronómetro ao vivo da barra de turno). Negativos ficam a 0.
export function formatDuration(ms: number, options?: { seconds?: boolean }): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const base = `${hours}h ${String(minutes).padStart(2, '0')}m`
  if (!options?.seconds) return base
  const seconds = totalSeconds % 60
  return `${base} ${String(seconds).padStart(2, '0')}s`
}

//  Moeda
//
// Formatação ÚNICA de moeda para APRESENTAÇÃO (ex: "12,50 €" em PT). NÃO usar
// em campos de input: esses são reparseados com Number e a vírgula decimal
// partiria o parse (ver formatPrice em validation.ts, que devolve "12.50" sem
// símbolo). O Intl.NumberFormat é caro de construir, por isso há um por locale,
// criado na primeira utilização e reutilizado (o idioma pode trocar em runtime).
const EURO_FORMATS = new Map<string, Intl.NumberFormat>()

function euroFormat(): Intl.NumberFormat {
  const locale = getLocale()
  let format = EURO_FORMATS.get(locale)
  if (!format) {
    format = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' })
    EURO_FORMATS.set(locale, format)
  }
  return format
}

export function formatEuro(value: number): string {
  if (!Number.isFinite(value)) return euroFormat().format(0)
  return euroFormat().format(value)
}

// Distingue "não há ligação ao servidor" de um erro de validação (ex.: carrinho
// inválido). Sem isto, uma escrita que falha por falta de rede mostrava uma
// mensagem a pedir para "corrigir o carrinho"  confuso, porque o carrinho
// estava certo, só a ligação é que falhou. Cobre os dois casos mais comuns:
// - fetch falhado (offline/Wi-Fi fraco): TypeError "Failed to fetch" no browser.
// - erro do Supabase Auth para pedidos que não chegaram ao servidor.
export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'AuthRetryableFetchError') return true
  return error.message.toLowerCase().includes('failed to fetch')
}
