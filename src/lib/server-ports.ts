// Portas do backend local — uma só fonte de verdade para a app, o mini-proxy TLS
// (scripts/tls-proxy.ts) e a CSP do Vite (vite.config.ts).
//
// Modelo de ligação:
//   • Clientes QR (público): browser na LAN, NÃO confiam no certificado local →
//     falam HTTP direto com o Supabase em SUPABASE_HTTP_PORT.
//   • Staff (com login): aparelhos controlados que confiam na CA do mkcert →
//     falam HTTPS pelo mini-proxy em STAFF_TLS_PORT, por isso passwords e
//     pagamentos viajam encriptados na WiFi.
//
// STAFF_TLS_PORT tem de ficar FORA das portas do Supabase local (54320 shadow,
// 54321 API, 54322 DB, 54323 Studio, 54324 Inbucket, 54327 analytics).
//
// NOTA: o launcher (scripts/launcher/state.mjs) duplica estes valores porque é
// .mjs puro e não consegue importar TypeScript — se mudares aqui, muda lá.
export const SUPABASE_HTTP_PORT = 54321
export const STAFF_TLS_PORT = 54391
