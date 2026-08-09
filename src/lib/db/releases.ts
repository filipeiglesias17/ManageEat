import { supabase } from '../supabase'
import type { AppRelease } from '../../@types/release'
import { throwOnError, subscribeTable } from './base'

const RELEASE_ID = 'current'
const APP_BUNDLES_BUCKET = 'app-bundles'

export function rowToRelease(r: Record<string, unknown>): AppRelease {
  const release: AppRelease = {
    version: r.version as string,
    objectPath: r.object_path as string,
    publishedAt: r.published_at as string,
  }
  if (r.checksum != null) release.checksum = r.checksum as string
  if (r.session_key != null) release.sessionKey = r.session_key as string
  if (r.notes != null) release.notes = r.notes as string
  return release
}

// Versão publicada agora no servidor do restaurante (ou null se nunca publicada).
export async function getAppRelease(): Promise<AppRelease | null> {
  const { data, error } = await supabase
    .from('app_release')
    .select('*')
    .eq('id', RELEASE_ID)
    .maybeSingle()
  throwOnError(error)
  if (!data) return null
  return rowToRelease(data as Record<string, unknown>)
}

// Avisa em tempo real quando o admin/programador publica uma nova versão.
export function subscribeAppRelease(
  callback: (release: AppRelease | null) => void,
  onError?: (error: Error) => void,
): () => void {
  return subscribeTable('app_release', getAppRelease, callback, { onError })
}

// URL público do .zip no Storage. Usa o cliente Supabase ativo (já resolvido
// para o IP da LAN deste dispositivo), por isso o telemóvel descarrega do
// servidor do restaurante.
export function bundlePublicUrl(objectPath: string): string {
  return supabase.storage.from(APP_BUNDLES_BUCKET).getPublicUrl(objectPath).data.publicUrl
}
