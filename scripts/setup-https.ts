// Gera o certificado TLS local (mkcert) que liga HTTPS na LAN do restaurante.
//
// Porquê: na WiFi do restaurante os telemóveis/tablets falam com o Supabase
// local. Em HTTP, qualquer um na mesma rede pode "ouvir" passwords, tokens e
// pedidos. O mkcert cria uma autoridade de certificação (CA) local de confiança
// e emite um certificado para `localhost`, `127.0.0.1` e o IP da LAN — assim o
// Vite e o Supabase servem `https://` e o tráfego viaja encriptado.
//
// Idempotente: corre-o as vezes que quiseres (ex.: o IP da LAN mudou). Reescreve
// os certs em `certs/` (que está no .gitignore — a chave privada NUNCA vai para
// o git). Depois disto, cada DISPOSITIVO ainda tem de confiar na CA uma vez —
// os passos por aparelho são impressos no fim deste script.
//
// Uso:  npm run setup:https
//
// Pré-requisito: mkcert instalado (`brew install mkcert nss`). O `nss` é preciso
// para o Firefox confiar na CA no desktop.

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(import.meta.dirname, '..')
const certsDir = path.join(projectRoot, 'certs')
const certPath = path.join(certsDir, 'lan-cert.pem')
const keyPath = path.join(certsDir, 'lan-key.pem')
const rootCaDest = path.join(certsDir, 'rootCA.pem')

// ── 1) mkcert tem de estar instalado ───────────────────────────────────────
function assertMkcertInstalled(): void {
  try {
    execFileSync('mkcert', ['-version'], { stdio: 'ignore' })
  } catch {
    console.error('✖ mkcert não encontrado no PATH.')
    console.error('  Instala com:  brew install mkcert nss')
    console.error('  (o nss é preciso para o Firefox confiar na CA no desktop)')
    process.exit(1)
  }
}

// ── 2) Todos os IPv4 reais da máquina entram como SAN do certificado ────────
// Incluímos TODOS os IPs não-internos (não só o "melhor"): o router pode dar à
// máquina um IP diferente conforme a interface (Ethernet vs WiFi), e o cert tem
// de ser válido para qualquer um deles sem regenerar.
function localIPv4Addresses(): string[] {
  const interfaces = os.networkInterfaces()
  const addresses: string[] = []
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        addresses.push(entry.address)
      }
    }
  }
  return addresses
}

function run(): void {
  assertMkcertInstalled()

  // mkcert -install: cria a CA local (se não existir) e instala-a na truststore
  // DESTA máquina, para o browser do desktop confiar. É idempotente. Na 1ª vez
  // pode pedir a password do sistema (escreve no keychain) — é esperado.
  //
  // Se falhar NÃO abortamos: emitir certificados só precisa da CAROOT, e o
  // -install pode falhar em contextos sem terminal (ex.: launcher em
  // auto-arranque, que não consegue pedir a password do sudo) mesmo com a CA
  // já confiada nesta máquina e nos aparelhos do staff.
  console.log('• A garantir que a CA local do mkcert está instalada (mkcert -install)…')
  try {
    execFileSync('mkcert', ['-install'], { stdio: 'inherit' })
  } catch {
    console.warn('! Não consegui (re)confirmar a CA na truststore do sistema — continuo a emitir os certificados.')
    console.warn('  Se é a PRIMEIRA vez nesta máquina, corre depois num Terminal:  mkcert -install')
  }

  if (!existsSync(certsDir)) {
    mkdirSync(certsDir, { recursive: true })
  }

  const sans = ['localhost', '127.0.0.1', '::1', ...localIPv4Addresses()]
  console.log(`• A emitir certificado para: ${sans.join(', ')}`)
  execFileSync('mkcert', ['-cert-file', certPath, '-key-file', keyPath, ...sans], {
    stdio: 'inherit',
  })

  // Copiar o rootCA.pem (CA pública) para certs/: é o que o NODE_EXTRA_CA_CERTS
  // dos scripts (gate:rules, seed, attack:*) usa para confiar no Supabase HTTPS,
  // e é o ficheiro que vais instalar nos telemóveis (device-trust).
  const caRoot = execFileSync('mkcert', ['-CAROOT']).toString().trim()
  const rootCaSource = path.join(caRoot, 'rootCA.pem')
  copyFileSync(rootCaSource, rootCaDest)

  console.log('\n✔ Certificados prontos em certs/:')
  console.log('    lan-cert.pem / lan-key.pem  (servidos pelo Vite + Supabase)')
  console.log('    rootCA.pem                  (CA pública — para device-trust)')
  console.log('\nPróximos passos:')
  console.log('  1) Arrancar o mini-proxy TLS do staff:  npm run tls:proxy  (deixa a correr)')
  console.log('  2) Confiar na CA nos aparelhos do STAFF (não nos dos clientes):')
  console.log('     envia certs/rootCA.pem para o aparelho e instala-o (Definições → Certificados)')
}

run()
