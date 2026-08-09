// Mini-proxy TLS para o staff: termina HTTPS e reencaminha para o Supabase local
// (HTTP). Porquê: o Supabase local fica em HTTP porque os clientes QR (browser na
// LAN) não conseguem confiar num certificado local. Mas os aparelhos do staff
// (com login, controlados) confiam na CA do mkcert e ligam a este proxy por
// HTTPS, por isso o login e os pagamentos viajam encriptados.
//
// Uso:  npm run tls:proxy        (deixa a correr ao lado do db:start / dev)
// Pré-requisito: npm run setup:https  (gera certs/lan-cert.pem + lan-key.pem)

import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { SUPABASE_HTTP_PORT, STAFF_TLS_PORT } from '../src/lib/server-ports'

const TARGET_HOST = '127.0.0.1'
const certsDir = path.resolve(import.meta.dirname, '..', 'certs')

function loadCerts(): { cert: Buffer; key: Buffer } {
  try {
    return {
      cert: readFileSync(path.join(certsDir, 'lan-cert.pem')),
      key: readFileSync(path.join(certsDir, 'lan-key.pem')),
    }
  } catch {
    console.error('✖ Faltam os certificados em certs/. Corre primeiro:  npm run setup:https')
    process.exit(1)
  }
}

const { cert, key } = loadCerts()

// Pedidos HTTP normais (REST, Auth, Storage): reencaminha método, caminho e
// headers tal e qual para o Supabase em HTTP.
const server = https.createServer({ cert, key }, (req, res) => {
  const proxyReq = http.request(
    {
      host: TARGET_HOST,
      port: SUPABASE_HTTP_PORT,
      method: req.method,
      path: req.url,
      headers: req.headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
      proxyRes.pipe(res)
    },
  )
  proxyReq.on('error', () => {
    if (!res.headersSent) res.writeHead(502)
    res.end('Bad gateway — o Supabase local está a responder? (npm run db:start)')
  })
  req.pipe(proxyReq)
})

// Realtime: o supabase-js liga em wss://.../realtime/v1/websocket. Reencaminhamos
// o upgrade abrindo um socket TCP cru para o Supabase, reenviando a linha de
// pedido + headers, e ligando os dois sentidos. (Sem isto, os dashboards do staff
// perdiam as atualizações em tempo real.)
server.on('upgrade', (req, clientSocket, head) => {
  const backend = net.connect(SUPABASE_HTTP_PORT, TARGET_HOST, () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`]
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`)
    }
    backend.write(lines.join('\r\n') + '\r\n\r\n')
    if (head && head.length) backend.write(head)
    clientSocket.pipe(backend)
    backend.pipe(clientSocket)
  })
  backend.on('error', () => clientSocket.destroy())
  clientSocket.on('error', () => backend.destroy())
})

server.listen(STAFF_TLS_PORT, '0.0.0.0', () => {
  console.log(
    `Proxy TLS do staff: https://0.0.0.0:${STAFF_TLS_PORT}  →  http://${TARGET_HOST}:${SUPABASE_HTTP_PORT}`,
  )
  console.log('Deixa esta janela aberta enquanto trabalhas. Ctrl+C para parar.')
})
