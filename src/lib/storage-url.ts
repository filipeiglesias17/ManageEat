const PUBLIC_STORAGE_PATH = '/storage/v1/object/public/'

// A BD guarda apenas o caminho público do objeto, nunca o protocolo/host/porta
// do servidor do momento. Assim a mesma imagem funciona quando o IP da rede
// muda e em web, iOS e Android.
export function toStablePublicStorageReference(value: string): string {
  if (value.startsWith(PUBLIC_STORAGE_PATH)) return value

  try {
    const parsed = new URL(value)
    if (!parsed.pathname.startsWith(PUBLIC_STORAGE_PATH)) return value
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return value
  }
}

// Constrói o URL no momento do render usando o servidor Supabase ao qual este
// dispositivo está realmente ligado. URLs externas e assets locais continuam
// intactos para manter compatibilidade com dados antigos.
export function resolvePublicStorageReference(value: string, supabaseUrl: string): string {
  const reference = toStablePublicStorageReference(value)
  if (!reference.startsWith(PUBLIC_STORAGE_PATH)) return value

  try {
    return `${new URL(supabaseUrl).origin}${reference}`
  } catch {
    return value
  }
}

