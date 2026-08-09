-- ─────────────────────────────────────────────────────────────────────────
-- Schema do Manage-Eat (Postgres / Supabase local).
--
-- Substitui as coleções do Firestore por tabelas. As colunas mapeiam os tipos
-- em src/@types/* e as listas `keys().hasOnly([...])` que as firestore.rules já
-- impunham. Convenção: colunas em snake_case; o src/lib/db.ts converte de/para
-- camelCase ao ler/escrever.
--
-- Datas: guardadas como `text` (ISO 8601), tal como o Firestore as guardava e
-- como os @types as declaram (`string`). ISO 8601 ordena bem como texto, por
-- isso `order by created_at desc` continua a funcionar sem conversões.
--
-- IDs: os que o cliente gera (orders.request_id, sessions.id, service_calls.id)
-- são `text` PK; os que vinham de addDoc (categories, menu_items, shifts,
-- payments) usam `gen_random_uuid()`.
--
-- A RLS e os triggers de validação vivem na migração seguinte (…_rls.sql).
-- ─────────────────────────────────────────────────────────────────────────

-- ── profiles ───────────────────────────────────────────────────────────────
-- Perfil aplicacional de cada conta. A password vive no Supabase Auth
-- (auth.users); aqui só role/username/estado. PK = id do auth.users.
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text not null,
  role         text not null check (role in ('admin', 'gerente', 'empregado', 'cliente', 'cozinha')),
  active       boolean not null default true,
  created_at   text not null,
  -- Mesa fixa de uma conta `cliente` (tablet numa mesa). Só faz sentido para
  -- role 'cliente'; null nos restantes.
  table_number integer check (table_number is null or table_number >= 1)
);

-- ── categories ─────────────────────────────────────────────────────────────
create table public.categories (
  id    uuid primary key default gen_random_uuid(),
  name  text not null check (length(name) > 0),
  color text
);

-- ── menu_items ─────────────────────────────────────────────────────────────
-- category_id fica `text` (sem FK) para espelhar o Firestore, que não tinha
-- integridade referencial: apagar uma categoria não devia rebentar items.
create table public.menu_items (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  description           text not null,
  price                 numeric not null check (price >= 0),
  category_id           text not null,
  available             boolean not null,
  -- percentagem 0-100, null = sem desconto
  discount              numeric check (discount is null or (discount >= 0 and discount <= 100)),
  removable_ingredients text[],
  tags                  text[],
  rodizio_available     boolean,
  vat_rate              numeric check (vat_rate is null or (vat_rate >= 0 and vat_rate <= 100))
);

-- ── orders ─────────────────────────────────────────────────────────────────
-- PK = request_id (idempotência): o mesmo pedido enviado 2x não cria 2 linhas
-- (o db.ts faz upsert ignore). `items` é jsonb (array de OrderItem).
create table public.orders (
  id             text primary key,
  request_id     text not null,
  table_number   integer not null check (table_number >= 1),
  source         text not null check (source in ('cliente', 'empregado')),
  session_id     text,
  items          jsonb not null check (jsonb_typeof(items) = 'array'
                                       and jsonb_array_length(items) between 1 and 30),
  status         text not null check (status in ('pending', 'preparing', 'ready', 'delivered', 'cancelled')),
  created_at     text not null,
  discount_type  text check (discount_type is null or discount_type in ('percent', 'euros')),
  discount_value numeric,
  entry_price    numeric,
  headcount      integer,
  mode           text check (mode is null or mode in ('normal', 'rodizio')),
  cancelled_at   text,
  cancelled_by   uuid,
  cancel_reason  text,
  -- Espelha a regra requestId == orderId do Firestore.
  constraint orders_request_id_matches_id check (request_id = id)
);

create index orders_created_at_desc_idx on public.orders (created_at desc);
create index orders_session_id_idx on public.orders (session_id);

-- ── sessions (QR) ──────────────────────────────────────────────────────────
-- expires_at null = sessão permanente (QR fixo na mesa, criada pelo admin).
create table public.sessions (
  id               text primary key,
  table_number     integer not null check (table_number >= 1),
  created_at       text not null,
  expires_at       text,
  open             boolean,
  opened_at        text,
  -- Hash do código de 4 dígitos do cliente — nunca o código em claro.
  access_code_hash text,
  mode             text check (mode is null or mode in ('normal', 'rodizio')),
  entry_price      numeric,
  headcount        integer
);

-- Backstop de BD: uma mesa física só pode ter uma conta/sessão aberta de cada
-- vez. Sessões fechadas/idle continuam a existir para histórico ou QR fixo.
create unique index sessions_one_open_per_table_idx on public.sessions (table_number) where open is true;

-- Liga um utilizador autenticado/anónimo à sessão QR depois de provar o código.
-- Sem isto, qualquer sessão autenticada podia ler pedidos de qualquer QR que
-- conseguisse descobrir. A autorização da conta passa por esta tabela.
create table public.session_clients (
  session_id text not null references public.sessions (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at text not null,
  primary key (session_id, user_id)
);

create index session_clients_user_id_idx on public.session_clients (user_id);

-- Tentativas falhadas do código QR por sessão + utilizador anónimo/autenticado.
-- Mantém o código de 4 dígitos usável em restaurante, mas bloqueia brute force
-- básico no servidor.
create table public.session_code_attempts (
  session_id    text not null references public.sessions (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  failed_count  integer not null default 0 check (failed_count >= 0),
  locked_until  text,
  last_failed_at text,
  primary key (session_id, user_id)
);

create index session_code_attempts_user_id_idx on public.session_code_attempts (user_id);

-- ── service_calls ──────────────────────────────────────────────────────────
create table public.service_calls (
  id              text primary key,
  table_number    integer not null check (table_number >= 1),
  type            text not null check (type in ('waiter', 'bill')),
  session_id      text,
  created_at      text not null,
  status          text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  acknowledged_at text,
  acknowledged_by uuid,
  resolved_at     text,
  resolved_by     uuid
);

-- ── settings ───────────────────────────────────────────────────────────────
-- Linha única 'restaurant'. Leitura pública (o cliente precisa do modo/entrada).
create table public.settings (
  id               text primary key default 'restaurant',
  mode             text not null check (mode in ('normal', 'rodizio', 'mixed')),
  entry_price      numeric not null check (entry_price >= 0),
  name             text,
  nif              text,
  address          text,
  default_vat_rate numeric check (default_vat_rate is null or (default_vat_rate >= 0 and default_vat_rate <= 100)),
  -- Em rodízio/mixed a entrada tem de ser > 0 (espelha validRestaurantSettings).
  constraint settings_entry_price_positive_when_not_normal
    check (mode = 'normal' or entry_price > 0)
);

-- ── shifts (turnos) ────────────────────────────────────────────────────────
create table public.shifts (
  id         uuid primary key default gen_random_uuid(),
  opened_at  text not null,
  closed_at  text,
  opened_by  uuid not null,
  closed_by  uuid,
  status     text not null check (status in ('open', 'closed'))
);

create index shifts_status_idx on public.shifts (status);

-- Garante no máximo 1 turno aberto de cada vez (o db.ts já valida, isto fecha a
-- corrida a nível de BD).
create unique index shifts_single_open_idx on public.shifts (status) where status = 'open';

-- ── payments (pagamentos) ──────────────────────────────────────────────────
create table public.payments (
  id           uuid primary key default gen_random_uuid(),
  table_number integer not null check (table_number >= 1),
  session_id   text,
  shift_id     uuid,
  amount       numeric not null check (amount >= 0),
  method       text not null check (method in ('dinheiro', 'cartao', 'outro')),
  created_at   text not null,
  created_by   uuid not null
);

create index payments_created_at_desc_idx on public.payments (created_at desc);
