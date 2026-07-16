// Parsing e formatação de números escritos à mão (preços em euros).
// Centralizado para o mesmo input ("12,5", " 3.00 ", "") ser interpretado da
// mesma forma em qualquer ecrã.

// Lê um preço e devolve-o em euros, arredondado aos cêntimos. Aceita vírgula
// decimal e espaços à volta. Devolve null quando está vazio ou não é um número
// — cabe a quem chama decidir (mostrar erro, manter o valor anterior, etc.).
export function parsePrice(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (normalized === '') return null

  const price = Number(normalized)
  if (!Number.isFinite(price)) return null

  return Math.round(price * 100) / 100
}

// Mostra um preço com 2 casas decimais (ex: 5 → "5.00").
export function formatPrice(value: number): string {
  return value.toFixed(2)
}

// ── Servidor de ligação ("Definições de ligação") ──────────────────────────
// Valida uma porta (1–65535). Devolve null se vazia ou inválida.
export function parsePort(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '' || !/^\d+$/.test(trimmed)) return null
  const port = Number(trimmed)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return port
}

// Constrói o URL do servidor a partir de host/IP + porta (http assumido — o
// Supabase local não usa TLS). Tolera o utilizador colar "http://" ou barras.
// Devolve null se o host ficar vazio.
export function buildServerUrl(host: string, port: number): string | null {
  // O teclado numérico do iOS em locale PT dá vírgula em vez de ponto; aceitamos
  // ambos para o utilizador conseguir escrever o IP (192,168,1,67 → 192.168.1.67).
  const cleanHost = host
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
    .replace(/,/g, '.')
  if (cleanHost === '') return null

  // Por hábito, o utilizador pode colar "192.168.1.67:54321" no campo do IP.
  // Se vier porta embutida, usamo-la (e ignoramos o campo Porta) — evita gerar
  // "http://192.168.1.67:54321:54321", que seria inválido.
  const [hostOnly, embeddedPort] = cleanHost.split(':')
  if (hostOnly === '') return null
  const finalPort = embeddedPort && /^\d+$/.test(embeddedPort) ? Number(embeddedPort) : port
  return `http://${hostOnly}:${finalPort}`
}

// Valida/normaliza um URL completo (modo avançado). Devolve o URL sem barra
// final, ou null se não for um http(s) válido.
export function normalizeServerUrl(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}
