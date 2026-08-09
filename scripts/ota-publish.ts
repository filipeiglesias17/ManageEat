// Publica o bundle web atual como uma atualização OTA no Supabase do restaurante.
//
// Faz: zip do dist/ -> ENCRIPTA (E2E v2, capgo) -> upload do zip encriptado para
// o Storage (bucket app-bundles) -> aponta a app_release para essa versão, com o
// checksum ASSINADO e o sessionKey. Os telemóveis (Capacitor + @capgo/capacitor-
// updater) veem a nova versão, descarregam-na da LAN, verificam/desencriptam com a
// publicKey embebida no binário e aplicam-na — sem recompilar a app.
//
// Uso:  npm run ota:publish      (corre `npm run build` primeiro)
//
// Usa a SERVICE_ROLE (ignora a RLS) — por isso SÓ corre no terminal, contra o
// Supabase LOCAL. Pré-requisitos no .env.local: SUPABASE_SERVICE_ROLE_KEY
// (e SUPABASE_URL / VITE_SUPABASE_URL; default 127.0.0.1:54321).
//
// Encriptação E2E: precisa da chave PRIVADA .capgo_key_v2 na raiz (gerada uma vez
// com `npx @capgo/cli key create`, guardada FORA do git e copiada para um gestor
// de passwords). A publicKey correspondente vive em capacitor.config.ts e tem de
// estar embebida no binário nativo instalado nos POS — senão recusam o update.

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { readFileSync, existsSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

dotenv.config({ path: '.env.local' })

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!serviceKey) {
  console.error('Falta SUPABASE_SERVICE_ROLE_KEY no .env.local (vê `npx supabase status`).')
  process.exit(1)
}

const PRIVATE_KEY = '.capgo_key_v2'
if (!existsSync(PRIVATE_KEY)) {
  console.error(
    `Falta a chave privada ${PRIVATE_KEY} na raiz. Gera-a uma vez com ` +
    '`npx @capgo/cli key create` (e guarda-a fora do git), ou restaura-a do teu ' +
    'gestor de passwords. NUNCA a commites.',
  )
  process.exit(1)
}

const BUCKET = 'app-bundles'
const distDir = path.resolve('dist')
const versionFile = path.join(distDir, 'build-version.txt')

if (!existsSync(versionFile)) {
  console.error('Falta dist/build-version.txt. Corre `npm run build` antes (ou usa `npm run ota:publish`).')
  process.exit(1)
}

// A versão tem de ser EXATAMENTE a que ficou injetada neste build (o vite
// escreve-a em dist/build-version.txt), senão o telemóvel não deteta a mudança.
const version = readFileSync(versionFile, 'utf-8').trim()
const objectPath = `bundle-${version.replace(/[^a-zA-Z0-9._-]/g, '_')}.zip`

// Corre o @capgo/cli e devolve o JSON do stdout (com --json o stdout é só JSON;
// recortamos do primeiro { ao último } para tolerar ruído à volta).
function capgo(args: string[]): Record<string, string> {
  const out = execFileSync('npx', ['--no-install', '@capgo/cli', ...args, '--json'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const start = out.indexOf('{')
  const end = out.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error(`@capgo/cli não devolveu JSON: ${out}`)
  return JSON.parse(out.slice(start, end + 1))
}

// 1) Zip do dist/ + checksum (sha256). 2) Encriptar com a chave privada → zip
// encriptado + checksum assinado + ivSessionKey. Os ficheiros temporários ficam
// na raiz (o capgo escreve aí) e são limpos no fim.
const zipRes = capgo(['bundle', 'zip', '--path', 'dist', '--no-code-check'])
const plainZip = zipRes.filename
const encRes = capgo(['bundle', 'encrypt', plainZip, zipRes.checksum, '--key', PRIVATE_KEY])
const encZip = encRes.filename

const zipBuffer = readFileSync(path.resolve(encZip))

function cleanup() {
  for (const file of [plainZip, encZip]) {
    if (!file) continue
    try {
      rmSync(path.resolve(file), { force: true })
    } catch (err) {
      console.warn(`Não consegui limpar ${file}:`, err)
    }
  }
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function main() {
  console.log(`A publicar versão ${version} encriptada (${(zipBuffer.length / 1024).toFixed(0)} KB)...`)

  const { error: uploadErr } = await admin.storage
    .from(BUCKET)
    .upload(objectPath, zipBuffer, { contentType: 'application/zip', upsert: true })
  if (uploadErr) throw uploadErr
  console.log(`✓ upload: ${BUCKET}/${objectPath} (encriptado)`)

  const { error: rowErr } = await admin.from('app_release').upsert({
    id: 'current',
    version,
    object_path: objectPath,
    checksum: encRes.checksum,        // sha256 assinado com a chave privada
    session_key: encRes.ivSessionKey, // chave AES encriptada (E2E)
    published_at: new Date().toISOString(),
  }, { onConflict: 'id' })
  if (rowErr) throw rowErr

  console.log(`✓ app_release apontada para ${version} (assinada E2E)`)
  console.log('Publicado. Os telemóveis reinstalados com a chave pública vão descarregar e verificar a atualização.')
}

main()
  .then(() => { cleanup(); process.exit(0) })
  .catch((err) => { cleanup(); console.error('ERRO no ota-publish:', err); process.exit(1) })
