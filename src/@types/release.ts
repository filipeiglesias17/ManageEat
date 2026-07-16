// Versão da app publicada para atualização OTA (ver supabase/migrations/
// 20260625120000_app_releases.sql e src/lib/ota.ts).
export type AppRelease = {
  version: string        // versão do bundle publicado (= VITE_BUILD_VERSION desse build)
  objectPath: string     // caminho do .zip no bucket Storage 'app-bundles'
  checksum?: string      // checksum de integridade (em E2E, sha256 assinado com a chave privada)
  // Chave de sessão (ivSessionKey) quando o bundle é encriptado E2E (capgo): a app
  // desencripta-a com a publicKey embebida no binário. Ausente = bundle não encriptado.
  sessionKey?: string
  notes?: string
  publishedAt: string
}
