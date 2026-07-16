import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import os from 'os'
import path from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { SUPABASE_HTTP_PORT, STAFF_TLS_PORT } from './src/lib/server-ports'

const localNetworkHost = getLocalIP()

// Versão do bundle web: versão do package.json + timestamp do build. O
// timestamp garante que cada build produz uma versão nova (mesmo sem mudar o
// package.json), para o OTA detetar a mudança durante o desenvolvimento.
// É injetada como import.meta.env.VITE_BUILD_VERSION (ver src/lib/ota.ts) e
// escrita em dist/build-version.txt para o scripts/ota-publish.ts a ler.
const pkgVersion = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf-8'),
).version as string
const buildTimestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const buildVersion = `${pkgVersion}+${buildTimestamp}`
// Fontes permitidas na CSP (só o Supabase local). Modelo híbrido:
//   • público (clientes QR): HTTP/WS direto ao Supabase em 54321
//   • staff (com login): HTTPS/WSS pelo mini-proxy TLS em 54391
const supabaseHostnames = ['127.0.0.1', 'localhost', localNetworkHost]
const supabaseHttpSources = supabaseHostnames.flatMap((h) => [
  `http://${h}:${SUPABASE_HTTP_PORT}`,
  `https://${h}:${STAFF_TLS_PORT}`,
])
const supabaseConnectSources = [
  ...supabaseHttpSources,
  ...supabaseHostnames.flatMap((h) => [`ws://${h}:${SUPABASE_HTTP_PORT}`, `wss://${h}:${STAFF_TLS_PORT}`]),
]

// NOTA: o launcher (scripts/launcher/steps.mjs, melhorIpLan) duplica esta
// lógica porque é .mjs puro e não consegue importar este ficheiro — se mudares
// o scoring aqui, muda lá.
function getLocalIP(): string {
  const interfaces = os.networkInterfaces()
  const addresses: { name: string; address: string }[] = []

  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      addresses.push({ name, address: entry.address })
    }
  }

  if (addresses.length === 0) return 'localhost'

  // Preferir o IP real da LAN. Hostnames .local dependem de mDNS/Bonjour e
  // muitos telemóveis/routers não os resolvem, por isso o QR usa IPv4 direto.
  const scored = addresses
    .map((candidate) => ({
      ...candidate,
      score: scoreNetworkAddress(candidate.name, candidate.address),
    }))
    .sort((a, b) => b.score - a.score)

  return scored[0].address
}

function scoreNetworkAddress(interfaceName: string, address: string): number {
  const name = interfaceName.toLowerCase()
  const looksLikeVirtualNetwork =
    name.startsWith('utun') ||
    name.startsWith('tun') ||
    name.startsWith('tap') ||
    name.startsWith('wg') ||
    name.startsWith('tailscale') ||
    name.startsWith('zt') ||
    name.startsWith('bridge') ||
    name.startsWith('docker') ||
    name.startsWith('vbox') ||
    name.startsWith('vmnet')

  let score = looksLikeVirtualNetwork ? 0 : 10

  if (address.startsWith('192.168.')) score += 4
  else if (address.startsWith('10.')) score += 3
  else if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(address)) score += 3
  else if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address)) score += 1

  return score
}

export default defineConfig({
  // Alias "@/..." -> "src/...". Tem de espelhar o "paths" do tsconfig.app.json.
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  define: {
    'import.meta.env.VITE_LOCAL_NETWORK_HOST': JSON.stringify(localNetworkHost),
    'import.meta.env.VITE_BUILD_VERSION': JSON.stringify(buildVersion),
  },
  plugins: [
    react(),
    tailwindcss(),
    // Escreve a versão do build para o ota-publish.ts publicar exatamente a
    // mesma string que ficou injetada neste bundle.
    {
      name: 'emit-build-version',
      apply: 'build',
      closeBundle() {
        writeFileSync(path.resolve(import.meta.dirname, 'dist/build-version.txt'), buildVersion)
      },
    },
  ],
  build: {
    rollupOptions: {
      output: {
        // Separar bibliotecas grandes em chunks próprios. O Supabase é usado no
        // arranque; Recharts e jspdf só entram quando o admin abre relatórios.
        // Em chunks à parte, o browser pode cacheá-los entre builds da app.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('@supabase')) return 'supabase'
          if (id.includes('recharts') || id.includes('d3-')) return 'charts'
          if (id.includes('jspdf')) return 'pdf'
          // React + router num chunk estável: o hash não muda quando só mexes em
          // código da app, por isso os updates OTA re-descarregam menos bytes. O
          // regex exige a barra final para não apanhar lucide-react/ nem @radix-ui/.
          if (/node_modules\/(react|react-dom|scheduler|react-router)\//.test(id)) {
            return 'react-vendor'
          }
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    // Front-end servido em HTTP para TODOS (staff e clientes QR): o cliente no
    // browser da LAN não confia num certificado local, e o staff não precisa do
    // front-end em https — basta falar https com o Supabase pelo proxy (uma
    // página http pode chamar uma API https sem "mixed content").
    headers: {
      // CSP — em produção remove 'unsafe-inline' de script-src e usa nonces/hashes
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        `connect-src 'self' ${supabaseConnectSources.join(' ')}`,
        `img-src 'self' data: blob: ${supabaseHttpSources.join(' ')}`,
        "font-src 'self'",
        "frame-src 'self'",
        "frame-ancestors 'none'",
      ].join('; '),
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  },
})
