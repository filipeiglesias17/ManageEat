// Postinstall: re-assina (ad-hoc) o binário da Supabase CLI em macOS.
//
// Porquê: a extração do npm pode corromper a assinatura ad-hoc do binário Go da
// CLI. No Apple Silicon, uma assinatura inválida faz o kernel matar o processo
// logo no arranque ("killed: 9" / SIGKILL), e a CLI fica inutilizável. Um
// `codesign --force --sign -` repõe uma assinatura ad-hoc válida.
//
// É defensivo: só corre em macOS, ignora se o binário/codesign não existirem, e
// NUNCA falha o `npm install` (sai sempre com 0).

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

function run() {
  if (process.platform !== 'darwin') return // só macOS precisa de codesign

  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const archDir = process.arch === 'arm64' ? 'cli-darwin-arm64' : 'cli-darwin-x64'
  const bin = join(root, 'node_modules', '@supabase', archDir, 'bin', 'supabase')

  if (!existsSync(bin)) return // CLI não instalada (ou layout diferente) — ignora

  try {
    // Já válido? Então não mexemos.
    execFileSync('codesign', ['--verify', bin], { stdio: 'ignore' })
    return
  } catch {
    // Assinatura inválida/ausente — re-assinar ad-hoc.
  }

  try {
    execFileSync('codesign', ['--force', '--sign', '-', bin], { stdio: 'ignore' })
    console.log('[fix-supabase-cli] binário da Supabase CLI re-assinado (ad-hoc).')
  } catch (err) {
    console.warn('[fix-supabase-cli] não foi possível re-assinar a CLI:', (err && err.message) || err)
  }
}

run()
