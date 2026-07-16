// Seed do Supabase local: cria as contas iniciais (auth.users + profiles) e um
// menu de exemplo. Usa a SERVICE_ROLE (ignora a RLS) — por isso só corre no
// terminal, contra o Supabase LOCAL.
//
// Uso:  npx tsx scripts/seed.ts
//
// Pré-requisitos (.env.local):
//   SUPABASE_URL                (ou VITE_SUPABASE_URL; default 127.0.0.1:54321)
//   SUPABASE_SERVICE_ROLE_KEY   (de `npx supabase status`)
//
// É idempotente: re-correr não duplica (contas já existentes são reutilizadas,
// profiles e menu fazem upsert).
//
// GUARDA: se a BD parecer estar EM USO (pedidos/pagamentos, contas ou menu fora
// do demo, ou definições já configuradas) o seed recusa, para não sobrescrever
// uma instalação real. Força com `npm run seed -- --force` só de propósito.

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { readFile } from 'node:fs/promises'

dotenv.config({ path: '.env.local' })

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!serviceKey) {
  console.error('Falta SUPABASE_SERVICE_ROLE_KEY no .env.local (vê `npx supabase status`).')
  process.exit(1)
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ⚠️  Credenciais só para desenvolvimento local. Muda antes de qualquer uso real.
const PW = process.env.SEED_PASSWORD ?? 'manageeat2026!'

type SeedUser = {
  username: string
  role: 'admin' | 'gerente' | 'empregado' | 'cliente' | 'cozinha'
  tableNumber?: number
}

const users: SeedUser[] = [
  { username: 'admin',     role: 'admin'     },
  { username: 'gerente',   role: 'gerente'   },
  { username: 'empregado', role: 'empregado' },
  // A conta cliente é um tablet fixo numa mesa — nasce já com a mesa 1.
  { username: 'cliente',   role: 'cliente', tableNumber: 1 },
  { username: 'cozinha',   role: 'cozinha'   },
]

function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@manageeat.local`
}

async function findAuthUserByEmail(email: string): Promise<string | null> {
  const perPage = 100
  let page = 1

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw error

    const existing = data.users.find((u) => u.email === email)
    if (existing) return existing.id

    if (data.users.length < perPage) return null
    page += 1
  }
}

// Cria o user no Auth (ou reutiliza se já existe) e devolve o uid.
async function ensureAuthUser(email: string): Promise<string> {
  try {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PW,
      email_confirm: true, // emails técnicos, sem confirmação por email
    })
    if (!error && data.user) return data.user.id
  } catch {
    // O Supabase pode lançar AuthApiError quando o email já existe.
    // Continuamos para o lookup idempotente abaixo.
  }

  // Já existe: procurar na lista de users pelo email.
  const existingId = await findAuthUserByEmail(email)
  if (!existingId) throw new Error(`Não foi possível criar nem encontrar ${email}`)

  // Garante que o seed local continua a servir para login mesmo que a password
  // tenha sido mudada durante testes manuais.
  const { error: updateError } = await admin.auth.admin.updateUserById(existingId, {
    password: PW,
    email_confirm: true,
  })
  if (updateError) throw updateError

  return existingId
}

async function seedUsers() {
  for (const user of users) {
    const email = usernameToEmail(user.username)
    const uid = await ensureAuthUser(email)
    const { error } = await admin.from('profiles').upsert({
      id: uid,
      username: user.username,
      role: user.role,
      active: true,
      created_at: new Date().toISOString(),
      table_number: user.tableNumber ?? null,
    }, { onConflict: 'id' })
    if (error) throw error
    console.log(`✓ ${user.username} (${user.role})`)
  }
}

// Menu mínimo de exemplo, para a app não arrancar vazia. As tabelas usam id
// uuid, por isso o seed usa uuids fixos (idempotente via upsert onConflict id).
// menu_items.category_id é text, logo guarda o uuid da categoria como string.
const CAT_ENTRADAS = '00000000-0000-0000-0000-000000000001'
const CAT_PRATOS = '00000000-0000-0000-0000-000000000002'
const CAT_BEBIDAS = '00000000-0000-0000-0000-000000000003'
const MENU_IMAGES_BUCKET = 'menu-images'
const STORAGE_PUBLIC_PATH = `/storage/v1/object/public/${MENU_IMAGES_BUCKET}`

const DEMO_MENU_IMAGE_FILES = [
  { source: 'public/demo-menu/camarao-panado.png', objectPath: 'demo/camarao-panado.png', contentType: 'image/png' },
  { source: 'public/demo-menu/sushi-12-pecas.png', objectPath: 'demo/sushi-12-pecas.png', contentType: 'image/png' },
  { source: 'public/demo-menu/coca-cola-33cl.webp', objectPath: 'demo/coca-cola-33cl.webp', contentType: 'image/webp' },
]

const DEMO_MENU_ITEMS = [
  {
    id: '00000000-0000-0000-0000-000000000016',
    name: 'Camarão Panado',
    description: 'Camarão crocante com maionese picante',
    price: 6.5,
    category_id: CAT_ENTRADAS,
    available: true,
    discount: null,
    vat_rate: 13,
    image: `${STORAGE_PUBLIC_PATH}/demo/camarao-panado.png`,
  },
  {
    id: '00000000-0000-0000-0000-000000000012',
    name: 'Sushi 12 peças',
    description: 'Seleção do chef',
    price: 14.9,
    category_id: CAT_PRATOS,
    available: true,
    discount: null,
    vat_rate: 13,
    image: `${STORAGE_PUBLIC_PATH}/demo/sushi-12-pecas.png`,
  },
  {
    id: '00000000-0000-0000-0000-000000000031',
    name: 'Coca-Cola 33cl',
    description: '',
    price: 2.5,
    category_id: CAT_BEBIDAS,
    available: true,
    discount: null,
    vat_rate: 23,
    image: `${STORAGE_PUBLIC_PATH}/demo/coca-cola-33cl.webp`,
  },
]

async function seedMenuImages() {
  for (const image of DEMO_MENU_IMAGE_FILES) {
    const contents = await readFile(image.source)
    const { error } = await admin.storage
      .from(MENU_IMAGES_BUCKET)
      .upload(image.objectPath, contents, { contentType: image.contentType, upsert: true })
    if (error) throw error
  }
}

async function seedMenu() {
  const { error: catErr } = await admin
    .from('categories')
    .upsert([
      { id: CAT_ENTRADAS, name: 'Entradas', color: '#f59e0b' },
      { id: CAT_PRATOS, name: 'Pratos', color: '#ef4444' },
      { id: CAT_BEBIDAS, name: 'Bebidas', color: '#3b82f6' },
    ], { onConflict: 'id' })
  if (catErr) throw catErr

  await seedMenuImages()

  const { error: itemErr } = await admin
    .from('menu_items')
    .upsert(DEMO_MENU_ITEMS, { onConflict: 'id' })
  if (itemErr) throw itemErr

  const { error: setErr } = await admin.from('settings').upsert({
    id: 'restaurant',
    mode: 'normal',
    entry_price: 0,
    default_vat_rate: 13,
  }, { onConflict: 'id' })
  if (setErr) throw setErr

  console.log('✓ menu de exemplo + settings')
}

// IDs fixos dos itens de exemplo (ver seedMenu) — para distinguir o menu demo
// de um menu real. Os dois IDs antigos continuam aceites pela guarda para que
// uma instalação criada com o seed anterior possa ser atualizada sem --force.
const DEMO_ITEM_IDS = [
  ...DEMO_MENU_ITEMS.map((item) => item.id),
  '00000000-0000-0000-0000-000000000011', // antigo Edamame
  '00000000-0000-0000-0000-000000000013', // antiga Água 0.5L
]

// A BD parece estar EM USO por um restaurante real? O seed sobrescreve as
// settings e volta a criar os dados demo — como o db:reset, não deve poder
// disparar por engano sobre produção. Ao contrário do db:reset (que apaga),
// aqui basta detetar sinais de uso real e bloquear salvo --force explícito.
async function looksInUse(): Promise<{ inUse: boolean; reason: string }> {
  // 1) Já houve operação (pedidos ou pagamentos) → é uma BD a sério.
  const orders = await admin.from('orders').select('id', { count: 'exact', head: true })
  if ((orders.count ?? 0) > 0) return { inUse: true, reason: 'já há pedidos registados' }
  const payments = await admin.from('payments').select('id', { count: 'exact', head: true })
  if ((payments.count ?? 0) > 0) return { inUse: true, reason: 'já há pagamentos registados' }

  // 2) Existem contas que não são as do demo → alguém criou utilizadores reais
  //    (inclui o admin da primeira instalação, se tiver escolhido outro nome).
  const demoUsernames = new Set(users.map((u) => u.username))
  const profiles = await admin.from('profiles').select('username')
  const realAccounts = (profiles.data ?? []).filter((p) => !demoUsernames.has(p.username as string))
  if (realAccounts.length > 0) return { inUse: true, reason: `há ${realAccounts.length} conta(s) fora do demo` }

  // 3) O menu já tem itens além dos exemplos atuais/legados → menu real.
  const items = await admin.from('menu_items').select('id')
  const realItems = (items.data ?? []).filter((i) => !DEMO_ITEM_IDS.includes(i.id as string))
  if (realItems.length > 0) return { inUse: true, reason: `há ${realItems.length} item(ns) de menu além do demo` }

  // 4) As definições foram configuradas (modo rodízio ou preço de entrada) →
  //    o restaurante já se configurou; o seed reporia tudo a normal/0.
  const settings = await admin.from('settings').select('mode, entry_price').eq('id', 'restaurant').maybeSingle()
  const st = settings.data as { mode?: string; entry_price?: number } | null
  if (st && (st.mode !== 'normal' || (st.entry_price ?? 0) > 0)) {
    return { inUse: true, reason: 'as definições do restaurante já foram alteradas' }
  }

  return { inUse: false, reason: '' }
}

async function main() {
  const force = process.argv.includes('--force')
  const { inUse, reason } = await looksInUse()
  if (inUse && !force) {
    console.error(`⚠️  A base de dados parece estar EM USO (${reason}).`)
    console.error('O seed sobrescreve as definições e volta a criar as contas/menu demo,')
    console.error('por isso está bloqueado para não estragar uma instalação real.')
    console.error('Se tens mesmo a certeza (ambiente de desenvolvimento), corre:')
    console.error('  npm run seed -- --force')
    process.exit(1)
  }

  await seedUsers()
  await seedMenu()
  console.log('Seed concluído.')
  process.exit(0)
}

main().catch((err) => {
  console.error('ERRO no seed:', err)
  process.exit(1)
})
