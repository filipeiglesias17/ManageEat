import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import os from 'os'
import path from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { SUPABASE_HTTP_PORT, STAFF_TLS_PORT } from './src/lib/server-ports'

const localNetworkHost = getLocalIP()

// O timestamp distingue builds OTA feitos a partir da mesma versão da aplicação.
const pkgVersion = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf-8'),
).version as string
const buildTimestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const buildVersion = `${pkgVersion}+${buildTimestamp}`
// Os clientes QR ligam-se diretamente ao Supabase; o staff usa o proxy TLS.
const supabaseHostnames = ['127.0.0.1', 'localhost', localNetworkHost]
const configuredSupabaseOrigin = getHttpOrigin(process.env.VITE_SUPABASE_URL)
const supabaseHttpSources = [...new Set([
  ...supabaseHostnames.flatMap((h) => [
    `http://${h}:${SUPABASE_HTTP_PORT}`,
    `https://${h}:${STAFF_TLS_PORT}`,
  ]),
  ...(configuredSupabaseOrigin ? [configuredSupabaseOrigin] : []),
])]
const supabaseConnectSources = [
  ...supabaseHttpSources,
  ...supabaseHostnames.flatMap((h) => [`ws://${h}:${SUPABASE_HTTP_PORT}`, `wss://${h}:${STAFF_TLS_PORT}`]),
  ...(configuredSupabaseOrigin ? [toWebSocketOrigin(configuredSupabaseOrigin)] : []),
]

// O launcher duplica este critério porque é JavaScript puro. Alterar ambos em conjunto.
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

  // O QR usa IPv4 porque alguns telemóveis e routers não resolvem nomes .local.
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

function getHttpOrigin(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null
  } catch {
    return null
  }
}

function toWebSocketOrigin(httpOrigin: string): string {
  const url = new URL(httpOrigin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.origin
}

export default defineConfig({
  // Este alias deve coincidir com o mapeamento do tsconfig.app.json.
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
    // O publicador OTA deve usar a mesma versão que ficou no bundle.
    {
      name: 'emit-build-version',
      apply: 'build',
      closeBundle() {
        writeFileSync(path.resolve(import.meta.dirname, 'dist/build-version.txt'), buildVersion)
      },
    },
  ],
  build: {
    // O ExcelJS é carregado apenas durante uma exportação. O limite evita um
    // aviso enganador para este chunk isolado sem esconder aumentos maiores.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Bibliotecas pesadas ficam em chunks próprios para permitir cache e carregamento tardio.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('@supabase')) return 'supabase'
          if (id.includes('recharts') || id.includes('d3-')) return 'charts'
          if (id.includes('jspdf')) return 'pdf'
          // A barra final evita incluir lucide-react ou @radix-ui por engano.
          if (/node_modules\/(react|react-dom|scheduler|react-router)\//.test(id)) {
            return 'react-vendor'
          }
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    // O frontend fica em HTTP na LAN; apenas o tráfego autenticado do staff usa TLS.
    headers: {
      // Uma distribuição endurecida deve substituir unsafe-inline por nonces ou hashes.
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
