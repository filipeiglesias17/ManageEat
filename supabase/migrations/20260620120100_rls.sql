-- ─────────────────────────────────────────────────────────────────────────
-- Segurança: RLS + triggers de validação.
--
-- A fronteira de segurança real está AQUI. O padrão:
--   • Papéis  → funções helper `security definer` que lêem public.profiles pelo
--     auth.uid() (security definer evita recursão de RLS ao ler a própria tabela).
--   • Autorização por linha → políticas RLS (select/insert/update/delete).
--   • Validações de forma simples → CHECK constraints (no schema).
--   • Validações cruzadas/condicionais (mesa==sessão, snapshot de rodízio,
--     transição de estado, diffs por campo) → triggers BEFORE que dão RAISE.
--
-- Diferença importante: a rota pública de QR lê sessões via RPC, sem receber
-- `access_code_hash`, e a tabela `sessions` fica só para staff.
-- ─────────────────────────────────────────────────────────────────────────

-- ── Helpers de papel ───────────────────────────────────────────────────────
-- profile_role(): role do utilizador atual SE estiver ativo (senão null).
-- security definer → ignora a RLS de profiles (impede recursão e dá o role
-- mesmo a quem só pode ler o próprio perfil).

create or replace function public.profile_role()
returns text language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid() and active is true
$$;

create or replace function public.profile_table_number()
returns integer language sql stable security definer set search_path = '' as $$
  select table_number from public.profiles where id = auth.uid() and active is true
$$;

create or replace function public.is_admin()
returns boolean language sql stable set search_path = '' as $$
  select public.profile_role() = 'admin'
$$;

create or replace function public.is_gerente()
returns boolean language sql stable set search_path = '' as $$
  select public.profile_role() = 'gerente'
$$;

create or replace function public.is_empregado()
returns boolean language sql stable set search_path = '' as $$
  select public.profile_role() = 'empregado'
$$;

create or replace function public.is_cozinha()
returns boolean language sql stable set search_path = '' as $$
  select public.profile_role() = 'cozinha'
$$;

create or replace function public.is_cliente()
returns boolean language sql stable set search_path = '' as $$
  select public.profile_role() = 'cliente'
$$;

-- Gerente é staff operacional (herda leituras e escritas já scoped a staff).
create or replace function public.is_staff()
returns boolean language sql stable set search_path = '' as $$
  select public.profile_role() in ('admin', 'gerente', 'empregado', 'cozinha')
$$;

-- Staff operacional que pode tratar chamadas de mesa. A cozinha lê pedidos e
-- chamadas, mas não assume/resoluciona pedidos de sala.
create or replace function public.is_floor_staff()
returns boolean language sql stable set search_path = '' as $$
  select public.profile_role() in ('admin', 'gerente', 'empregado')
$$;

-- ISO UTC em texto para manter compatibilidade com os tipos atuais (`string`).
-- Centralizar aqui evita aceitar relógios forjados do browser.
create or replace function public.now_iso()
returns text language sql stable set search_path = '' as $$
  select to_char(timezone('utc', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- Roles que o gerente pode gerir (nunca admin nem outro gerente).
create or replace function public.is_manageable_staff_role(role text)
returns boolean language sql immutable set search_path = '' as $$
  select role in ('empregado', 'cozinha', 'cliente')
$$;

-- Utilizador anónimo (fluxo /mesa via QR). Não lê profiles → sem definer.
create or replace function public.is_anon()
returns boolean language sql stable set search_path = '' as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
$$;

-- O cliente QR só acede aos dados da conta depois de provar o código da sessão.
-- A prova fica em session_clients; isto evita que um anónimo leia pedidos de
-- outras mesas só por conhecer/listar IDs.
create or replace function public.is_session_client(session_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.session_clients sc
    join public.sessions s on s.id = sc.session_id
    where sc.session_id = $1
      and sc.user_id = auth.uid()
      and s.open is true
      and (s.expires_at is null or s.expires_at::timestamptz > now())
  )
$$;

-- Conta cliente fixa (tablet da mesa): só pode usar a sessão aberta da mesa que
-- está no próprio profile. Isto dá session_id também ao fluxo /cliente sem
-- passar pela prova do código QR.
create or replace function public.is_customer_table_session(session_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.sessions s
    where s.id = $1
      and public.profile_role() = 'cliente'
      and s.table_number = public.profile_table_number()
      and s.open is true
      and (s.expires_at is null or s.expires_at::timestamptz > now())
  )
$$;

-- Num QR permanente, o session_id é reutilizado por várias contas. O cliente QR
-- só deve ler pedidos criados depois do opened_at atual da mesa.
create or replace function public.is_current_session_order(session_id text, created_at text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  sess public.sessions;
begin
  select * into sess
  from public.sessions
  where id = $1
    and open is true
    and (expires_at is null or expires_at::timestamptz > now());

  if not found or sess.opened_at is null then
    return false;
  end if;

  return $2::timestamptz >= sess.opened_at::timestamptz;
exception when others then
  return false;
end;
$$;

-- Leitura pública por ID para o QR. É uma RPC de propósito: a RLS do Postgres
-- não distingue "get por ID" de "list", por isso a tabela sessions deixa de ter
-- SELECT público direto. A RPC devolve se há código, mas não devolve o hash.
create or replace function public.get_public_session(session_id text)
returns table (
  id text,
  table_number integer,
  created_at text,
  expires_at text,
  open boolean,
  opened_at text,
  mode text,
  entry_price numeric,
  headcount integer,
  has_access_code boolean,
  code_failed_attempts integer,
  code_locked_until text
) language sql stable security definer set search_path = '' as $$
  select
    s.id,
    s.table_number,
    s.created_at,
    s.expires_at,
    s.open,
    s.opened_at,
    s.mode,
    s.entry_price,
    s.headcount,
    s.access_code_hash is not null as has_access_code,
    coalesce(a.failed_count, 0) as code_failed_attempts,
    a.locked_until as code_locked_until
  from public.sessions s
  left join public.session_code_attempts a
    on a.session_id = s.id
   and a.user_id = auth.uid()
  where s.id = $1
    and (s.expires_at is null or s.expires_at::timestamptz > now())
$$;

-- A rota /cliente não lista sessions diretamente. Pede à BD a sessão aberta da
-- mesa fixa do próprio profile, sem expor access_code_hash.
create or replace function public.get_customer_open_session()
returns table (
  id text,
  table_number integer,
  created_at text,
  expires_at text,
  open boolean,
  opened_at text,
  mode text,
  entry_price numeric,
  headcount integer,
  has_access_code boolean,
  code_failed_attempts integer,
  code_locked_until text
) language sql stable security definer set search_path = '' as $$
  select
    s.id,
    s.table_number,
    s.created_at,
    s.expires_at,
    s.open,
    s.opened_at,
    s.mode,
    s.entry_price,
    s.headcount,
    s.access_code_hash is not null as has_access_code,
    0 as code_failed_attempts,
    null::text as code_locked_until
  from public.sessions s
  where public.profile_role() = 'cliente'
    and s.table_number = public.profile_table_number()
    and s.open is true
    and (s.expires_at is null or s.expires_at::timestamptz > now())
  order by s.opened_at desc nulls last, s.created_at desc
  limit 1
$$;

-- Valida o código no servidor e liga o utilizador atual à sessão. Se ainda não
-- existir código, este primeiro dispositivo cria-o e fica associado à sessão.
create or replace function public.claim_session_with_code(
  p_session_id text,
  p_code_hash text
)
returns table (
  ok boolean,
  reason text,
  failed_count integer,
  locked_until text
) language plpgsql security definer set search_path = public as $$
declare
  sess public.sessions;
  attempt public.session_code_attempts;
  next_failed_count integer;
  max_attempts constant integer := 5;
begin
  if auth.uid() is null then
    return query select false, 'login_necessario', 0, null::text;
    return;
  end if;

  if p_code_hash is null or length(btrim(p_code_hash)) = 0 then
    return query select false, 'codigo_invalido', 0, null::text;
    return;
  end if;

  select * into sess
  from public.sessions
  where id = p_session_id
  for update;

  if not found
     or (sess.expires_at is not null and sess.expires_at::timestamptz <= now()) then
    return query select false, 'sessao_inexistente_ou_expirada', 0, null::text;
    return;
  end if;

  if sess.open is not true then
    return query select false, 'sessao_fechada', 0, null::text;
    return;
  end if;

  select * into attempt
  from public.session_code_attempts
  where session_id = p_session_id and user_id = auth.uid()
  for update;

  if sess.access_code_hash is not null
     and found
     and attempt.locked_until is not null
     and attempt.locked_until::timestamptz > now() then
    return query select false, 'bloqueado', attempt.failed_count, attempt.locked_until;
    return;
  end if;

  if sess.access_code_hash is null then
    update public.sessions
    set access_code_hash = p_code_hash
    where id = p_session_id;
  elsif sess.access_code_hash <> p_code_hash then
    if not found then
      next_failed_count := 1;
    elsif attempt.locked_until is not null and attempt.locked_until::timestamptz <= now() then
      next_failed_count := 1;
    else
      next_failed_count := attempt.failed_count + 1;
    end if;

    insert into public.session_code_attempts (
      session_id,
      user_id,
      failed_count,
      locked_until,
      last_failed_at
    )
    values (
      p_session_id,
      auth.uid(),
      next_failed_count,
      case when next_failed_count >= max_attempts then (now() + interval '5 minutes')::text else null end,
      now()::text
    )
    on conflict (session_id, user_id) do update
      set failed_count = excluded.failed_count,
          locked_until = excluded.locked_until,
          last_failed_at = excluded.last_failed_at;

    if next_failed_count >= max_attempts then
      return query
        select false, 'bloqueado', next_failed_count, (now() + interval '5 minutes')::text;
      return;
    end if;

    return query select false, 'codigo_incorreto', next_failed_count, null::text;
    return;
  end if;

  delete from public.session_code_attempts
  where session_id = p_session_id and user_id = auth.uid();

  insert into public.session_clients (session_id, user_id, created_at)
  values (p_session_id, auth.uid(), now()::text)
  on conflict (session_id, user_id) do nothing;

  return query select true, null::text, 0, null::text;
end;
$$;

-- Staff pode resetar o código para ajudar a mesa. O reset limpa telemóveis
-- associados e tentativas falhadas; o cliente cria/prova novo código a seguir.
create or replace function public.reset_session_access_code(p_session_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() and not public.is_gerente() and not public.is_empregado() then
    raise exception 'sessions: só staff operacional pode resetar o código';
  end if;

  update public.sessions
  set access_code_hash = null
  where id = p_session_id;

  if not found then
    raise exception 'sessions: sessão inexistente';
  end if;

  delete from public.session_clients where session_id = p_session_id;
  delete from public.session_code_attempts where session_id = p_session_id;
end;
$$;

-- ── Ativar RLS ─────────────────────────────────────────────────────────────
alter table public.profiles      enable row level security;
alter table public.categories    enable row level security;
alter table public.menu_items    enable row level security;
alter table public.orders        enable row level security;
alter table public.sessions      enable row level security;
alter table public.session_clients enable row level security;
alter table public.session_code_attempts enable row level security;
alter table public.service_calls enable row level security;
alter table public.settings      enable row level security;
alter table public.shifts        enable row level security;
alter table public.payments      enable row level security;

-- ── Privilégios base (a RLS é que filtra de facto as linhas) ────────────────
-- service_role ignora a RLS, mas continua a precisar de privilégios de tabela
-- (usado pelo seed/migração no terminal).
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant execute on function public.get_public_session(text) to anon, authenticated;
grant execute on function public.get_customer_open_session() to authenticated;
grant execute on function public.claim_session_with_code(text, text) to anon, authenticated;
grant execute on function public.reset_session_access_code(text) to authenticated;

-- ── profiles ───────────────────────────────────────────────────────────────
-- read: próprio, admin ou gerente. create/update/delete: admin (qualquer) ou
-- gerente (só staff não-privilegiado, sem promover — anti-escalonamento).
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_admin() or public.is_gerente());

create policy profiles_insert on public.profiles for insert
  with check (public.is_admin()
    or (public.is_gerente() and public.is_manageable_staff_role(role)));

-- USING avalia o role ANTIGO (conta atual tem de ser staff); WITH CHECK avalia o
-- role NOVO (continua staff → não promove a admin/gerente).
create policy profiles_update on public.profiles for update
  using (public.is_admin()
    or (public.is_gerente() and public.is_manageable_staff_role(role)))
  with check (public.is_admin()
    or (public.is_gerente() and public.is_manageable_staff_role(role)));

create policy profiles_delete on public.profiles for delete
  using (public.is_admin()
    or (public.is_gerente() and public.is_manageable_staff_role(role)));

-- ── categories ─────────────────────────────────────────────────────────────
-- Leitura pública (cliente via QR). Escrita admin/gerente (forma via CHECK).
create policy categories_select on public.categories for select using (true);
create policy categories_insert on public.categories for insert
  with check (public.is_admin() or public.is_gerente());
create policy categories_update on public.categories for update
  using (public.is_admin() or public.is_gerente())
  with check (public.is_admin() or public.is_gerente());
create policy categories_delete on public.categories for delete
  using (public.is_admin() or public.is_gerente());

-- ── menu_items ─────────────────────────────────────────────────────────────
create policy menu_items_select on public.menu_items for select using (true);
create policy menu_items_insert on public.menu_items for insert
  with check (public.is_admin() or public.is_gerente());
create policy menu_items_update on public.menu_items for update
  using (public.is_admin() or public.is_gerente())
  with check (public.is_admin() or public.is_gerente());
create policy menu_items_delete on public.menu_items for delete
  using (public.is_admin() or public.is_gerente());

-- ── settings ───────────────────────────────────────────────────────────────
-- Leitura pública. Escrita só admin. Delete só admin. Forma via CHECK.
create policy settings_select on public.settings for select using (true);
create policy settings_insert on public.settings for insert
  with check (public.is_admin());
create policy settings_update on public.settings for update
  using (public.is_admin())
  with check (public.is_admin());
create policy settings_delete on public.settings for delete
  using (public.is_admin());

-- ── sessions ───────────────────────────────────────────────────────────────
-- SELECT direto só para staff. O cliente QR usa a RPC get_public_session por ID
-- para evitar listagem global e para não expor access_code_hash pela tabela.
-- INSERT: admin/gerente (qualquer) ou empregado (só temporárias, com expires_at).
-- UPDATE direto só staff; a RPC claim_session_with_code trata o código do cliente.
create policy sessions_select on public.sessions for select
  using (public.is_staff());

create policy sessions_insert on public.sessions for insert
  with check (
    public.is_admin()
    or public.is_gerente()
    or (public.is_empregado() and expires_at is not null)
  );

-- Gate só "estar autenticado"; a lógica fina (staff-update vs código-do-cliente)
-- está no trigger sessions_validate_update.
create policy sessions_update on public.sessions for update
  using (public.is_staff())
  with check (public.is_staff());

create policy sessions_delete on public.sessions for delete
  using (public.is_admin() or public.is_gerente() or public.is_empregado());

-- ── session_clients ────────────────────────────────────────────────────────
create policy session_clients_select on public.session_clients for select
  using (public.is_staff() or user_id = auth.uid());

create policy session_clients_delete on public.session_clients for delete
  using (public.is_staff() or user_id = auth.uid());
-- Sem policy de INSERT/UPDATE: clientes entram pela RPC claim_session_with_code.

-- Tentativas de código: leitura própria/staff para diagnóstico; escrita só RPC.
create policy session_code_attempts_select on public.session_code_attempts for select
  using (public.is_staff() or user_id = auth.uid());

create policy session_code_attempts_delete on public.session_code_attempts for delete
  using (public.is_staff() or user_id = auth.uid());

-- ── service_calls ──────────────────────────────────────────────────────────
create policy service_calls_select on public.service_calls for select
  using (public.is_staff());

-- Toda chamada nasce ligada a uma sessão aberta. QR pode chamar empregado antes
-- de provar o código; pedir conta e pedidos continuam a exigir vínculo.
create policy service_calls_insert on public.service_calls for insert
  with check (
    auth.uid() is not null
    and session_id is not null
    and (
      public.is_staff()
      or public.is_customer_table_session(session_id)
      or (type = 'waiter')
      or public.is_session_client(session_id)
    )
  );

create policy service_calls_update on public.service_calls for update
  using (public.is_floor_staff())
  with check (public.is_floor_staff());

create policy service_calls_delete on public.service_calls for delete
  using (public.is_admin());

-- ── orders ─────────────────────────────────────────────────────────────────
-- Staff lê tudo; cliente fixo e cliente QR lêem só pedidos da própria sessão
-- aberta/atual.
create policy orders_select on public.orders for select
  using (
    public.is_staff()
    or (
      orders.session_id is not null
      and public.is_session_client(orders.session_id)
      and public.is_current_session_order(orders.session_id, orders.created_at)
    )
    or (
      orders.session_id is not null
      and public.is_customer_table_session(orders.session_id)
      and public.is_current_session_order(orders.session_id, orders.created_at)
    )
  );

-- create: sempre com sessão aberta. Staff pode pedir em qualquer sessão; cliente
-- fixo só na sessão da sua mesa; QR só depois de provar código. As
-- validações cruzadas (mesa==sessão, desconto só staff, rodízio, mesa do
-- cliente) continuam no trigger orders_validate_insert.
create policy orders_insert on public.orders for insert
  with check (
    auth.uid() is not null
    and session_id is not null
    and (
      public.is_staff()
      or public.is_customer_table_session(session_id)
      or public.is_session_client(session_id)
    )
    and status = 'pending'
  );

-- update: cozinha/admin/gerente. Transição válida OU cancelamento lógico → trigger.
create policy orders_update on public.orders for update
  using (public.is_admin() or public.is_gerente() or public.is_cozinha())
  with check (public.is_admin() or public.is_gerente() or public.is_cozinha());

-- delete físico só admin (a app usa cancelamento lógico).
create policy orders_delete on public.orders for delete
  using (public.is_admin());

-- ── shifts ─────────────────────────────────────────────────────────────────
create policy shifts_select on public.shifts for select using (public.is_staff());
create policy shifts_insert on public.shifts for insert
  with check (public.is_admin() or public.is_gerente());
create policy shifts_update on public.shifts for update
  using (public.is_admin() or public.is_gerente())
  with check (public.is_admin() or public.is_gerente());
create policy shifts_delete on public.shifts for delete
  using (public.is_admin() or public.is_gerente());

-- ── payments ───────────────────────────────────────────────────────────────
-- Leitura staff. Criar: staff operacional, sessão obrigatória e createdBy ==
-- próprio. Delete só admin. Sem update.
create policy payments_select on public.payments for select using (public.is_staff());
create policy payments_insert on public.payments for insert
  with check (public.is_floor_staff() and session_id is not null and created_by = auth.uid());
create policy payments_delete on public.payments for delete using (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────
-- Triggers de validação (o que a RLS não exprime bem)
-- ─────────────────────────────────────────────────────────────────────────

-- orders: validações no INSERT.
create or replace function public.orders_validate_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sess public.sessions;
  st   public.settings;
  my_table integer;
  item jsonb;
  menu_item public.menu_items;
  item_id uuid;
  item_quantity numeric;
  safe_quantity integer;
  unit_price numeric;
  subtotal_after_item_discounts numeric := 0;
  item_discount_type text;
  item_discount_value numeric;
  has_item_discount boolean;
  removed jsonb;
  removed_names text[];
  notes text;
  normalized_item jsonb;
  normalized_items jsonb := '[]'::jsonb;
  has_active_order boolean;
begin
  -- A data oficial do pedido é a data em que a BD aceita o insert, não o relógio
  -- do browser. Campos de cancelamento só nas transições de update.
  new.created_at := public.now_iso();
  new.cancelled_at := null;
  new.cancelled_by := null;
  new.cancel_reason := null;

  -- discountOnlyIfStaff: desconto global só de staff.
  if (new.discount_type is not null or new.discount_value is not null)
     and not public.is_staff() then
    raise exception 'orders: desconto só pode ser aplicado por staff';
  end if;

  -- Toda atividade de mesa nova pertence a uma sessão aberta. Isto deixa a mesa
  -- como contexto operacional único para QR, cliente fixo e empregado.
  if new.session_id is null then
    raise exception 'orders: session_id obrigatório';
  end if;

  select * into sess from public.sessions where id = new.session_id;
  if not found then
    raise exception 'orders: sessão % inexistente', new.session_id;
  end if;
  if new.table_number <> sess.table_number then
    raise exception 'orders: mesa (%) não corresponde à sessão (%)',
      new.table_number, sess.table_number;
  end if;
  if sess.open is not true then
    raise exception 'orders: sessão não está aberta';
  end if;
  if sess.expires_at is not null and sess.expires_at::timestamptz <= now() then
    raise exception 'orders: sessão expirada';
  end if;

  -- Se new.mode = 'rodizio', trata os campos entry_price/headcount e valida as correspondências com a sessão.
  if new.mode = 'rodizio' then
    if sess.mode is distinct from 'rodizio' then
      raise exception 'orders: snapshot de rodízio não corresponde à sessão';
    end if;
    
    if new.entry_price is not null and new.entry_price <> sess.entry_price then
      raise exception 'orders: snapshot de rodízio não corresponde à sessão';
    end if;
    if new.headcount is not null and new.headcount <> sess.headcount then
      raise exception 'orders: snapshot de rodízio não corresponde à sessão';
    end if;
    
    select exists (
      select 1
      from public.orders
      where session_id = new.session_id
        and status <> 'cancelled'
    ) into has_active_order;
    
    if has_active_order then
      new.entry_price := null;
      new.headcount := null;
    else
      new.entry_price := sess.entry_price;
      new.headcount := sess.headcount;
    end if;
  end if;

  -- validOrderRodizioSnapshot: campos de rodízio só num pedido de sessão rodízio
  -- e iguais ao snapshot da sessão.
  if new.mode is not null or new.entry_price is not null or new.headcount is not null then
    if new.mode is distinct from 'rodizio' then
      raise exception 'orders: snapshot de rodízio inválido';
    end if;
    if sess.mode is distinct from 'rodizio' then
      raise exception 'orders: snapshot de rodízio não corresponde à sessão';
    end if;

    -- Se entry_price e headcount forem especificados (primeiro pedido ativo),
    -- validamos que são válidos e batem com o da sessão.
    if new.entry_price is not null or new.headcount is not null then
      if new.entry_price is null or new.entry_price < 0
         or new.headcount is null or new.headcount < 1 then
        raise exception 'orders: snapshot de rodízio inválido';
      end if;
      if new.entry_price <> sess.entry_price
         or new.headcount <> sess.headcount then
        raise exception 'orders: snapshot de rodízio não corresponde à sessão';
      end if;
    end if;
  end if;

  -- clienteOrderTableMatchesProfile: cliente fixo só pede na sessão aberta da
  -- sua mesa de profile.
  if public.is_cliente() then
    my_table := public.profile_table_number();
    if my_table is null then
      raise exception 'orders: conta cliente sem mesa associada';
    end if;
    if sess.table_number <> my_table then
      raise exception 'orders: cliente só pode pedir para a mesa % do seu perfil', my_table;
    end if;
  end if;

  -- O browser envia intenção; a BD grava snapshot confiável. Cada linha é
  -- reconstruída a partir de menu_items para impedir preço/nome/IVA forjados.
  for item in select value from jsonb_array_elements(new.items)
  loop
    if jsonb_typeof(item) is distinct from 'object' then
      raise exception 'orders: cada item tem de ser um objeto';
    end if;

    if exists (
      select 1
      from jsonb_object_keys(item) as key
      where key <> all(array[
        'menuItemId',
        'menuItemName',
        'quantity',
        'price',
        'notes',
        'removedIngredients',
        'itemDiscountType',
        'itemDiscountValue',
        'vatRate'
      ])
    ) then
      raise exception 'orders: item com campo desconhecido';
    end if;

    if item->>'menuItemId' is null or length(btrim(item->>'menuItemId')) = 0 then
      raise exception 'orders: item sem menuItemId';
    end if;

    begin
      item_id := (item->>'menuItemId')::uuid;
    exception when invalid_text_representation then
      raise exception 'orders: menuItemId inválido';
    end;

    select * into menu_item
    from public.menu_items
    where id = item_id;

    if not found then
      raise exception 'orders: item já não existe no menu';
    end if;

    if menu_item.available is not true then
      raise exception 'orders: item "%" ficou indisponível', menu_item.name;
    end if;

    if not (item ? 'quantity') or jsonb_typeof(item->'quantity') is distinct from 'number' then
      raise exception 'orders: quantidade inválida em "%"', menu_item.name;
    end if;

    item_quantity := (item->>'quantity')::numeric;
    if item_quantity <> floor(item_quantity) or item_quantity < 1 or item_quantity > 99 then
      raise exception 'orders: quantidade de "%" tem de estar entre 1 e 99', menu_item.name;
    end if;
    safe_quantity := item_quantity::integer;

    notes := coalesce(item->>'notes', '');
    if length(notes) > 500 then
      raise exception 'orders: notas demasiado longas em "%"', menu_item.name;
    end if;

    removed := coalesce(item->'removedIngredients', '[]'::jsonb);
    if jsonb_typeof(removed) is distinct from 'array' then
      raise exception 'orders: ingredientes removidos inválidos em "%"', menu_item.name;
    end if;

    select coalesce(array_agg(value), array[]::text[])
      into removed_names
    from jsonb_array_elements_text(removed) as value;

    if exists (
      select 1
      from unnest(removed_names) as removed_name
      where removed_name <> all(coalesce(menu_item.removable_ingredients, array[]::text[]))
    ) then
      raise exception 'orders: ingrediente removido inválido em "%"', menu_item.name;
    end if;

    unit_price := menu_item.price * (1 - coalesce(menu_item.discount, 0) / 100);
    has_item_discount := item ? 'itemDiscountType' or item ? 'itemDiscountValue';

    if new.mode = 'rodizio' and coalesce(menu_item.rodizio_available, false) is true then
      if has_item_discount then
        raise exception 'orders: item incluído no rodízio não aceita desconto';
      end if;
      unit_price := 0;
    elsif has_item_discount then
      if not public.is_staff() then
        raise exception 'orders: desconto por item só pode ser aplicado por staff';
      end if;
      if not (item ? 'itemDiscountType') or not (item ? 'itemDiscountValue') then
        raise exception 'orders: desconto por item incompleto em "%"', menu_item.name;
      end if;
      if jsonb_typeof(item->'itemDiscountValue') is distinct from 'number' then
        raise exception 'orders: desconto por item inválido em "%"', menu_item.name;
      end if;

      item_discount_type := item->>'itemDiscountType';
      item_discount_value := (item->>'itemDiscountValue')::numeric;

      if item_discount_type not in ('percent', 'euros') or item_discount_value <= 0 then
        raise exception 'orders: desconto por item inválido em "%"', menu_item.name;
      end if;

      if item_discount_type = 'percent' then
        if item_discount_value > 100 then
          raise exception 'orders: desconto por item não pode passar 100%%';
        end if;
        unit_price := unit_price * (1 - item_discount_value / 100);
      else
        if item_discount_value > unit_price then
          raise exception 'orders: desconto por item não pode ultrapassar o preço';
        end if;
        unit_price := unit_price - item_discount_value;
      end if;
    end if;

    subtotal_after_item_discounts := subtotal_after_item_discounts + (unit_price * safe_quantity);

    normalized_item := jsonb_build_object(
      'menuItemId', menu_item.id::text,
      'menuItemName', menu_item.name,
      'quantity', safe_quantity,
      'price', unit_price
    );

    if notes <> '' then
      normalized_item := normalized_item || jsonb_build_object('notes', notes);
    end if;

    if array_length(removed_names, 1) is not null then
      normalized_item := normalized_item || jsonb_build_object('removedIngredients', removed_names);
    end if;

    if has_item_discount then
      normalized_item := normalized_item || jsonb_build_object(
        'itemDiscountType', item_discount_type,
        'itemDiscountValue', item_discount_value
      );
    end if;

    if menu_item.vat_rate is not null then
      normalized_item := normalized_item || jsonb_build_object('vatRate', menu_item.vat_rate);
    end if;

    normalized_items := normalized_items || jsonb_build_array(normalized_item);
  end loop;

  if (new.discount_type is null) <> (new.discount_value is null) then
    raise exception 'orders: desconto global incompleto';
  end if;

  if new.discount_type is not null then
    if new.discount_value <= 0 then
      raise exception 'orders: desconto global inválido';
    end if;
    if new.discount_type = 'percent' and new.discount_value > 100 then
      raise exception 'orders: desconto global não pode passar 100%%';
    end if;
    if new.discount_type = 'euros' and new.discount_value > subtotal_after_item_discounts then
      raise exception 'orders: desconto global não pode ultrapassar o subtotal';
    end if;
  end if;

  new.items := normalized_items;

  return new;
end;
$$;

create trigger orders_validate_insert_trg
  before insert on public.orders
  for each row execute function public.orders_validate_insert();

-- orders: validações no UPDATE (transição de 1 passo OU cancelamento lógico).
create or replace function public.orders_validate_update()
returns trigger language plpgsql set search_path = public as $$
declare
  others_unchanged_status boolean;
  others_unchanged_cancel boolean;
  flow text[] := array['pending', 'preparing', 'ready', 'delivered'];
  pos_from integer;
  pos_to integer;
begin
  -- Caminho A: só `status` muda.
  others_unchanged_status :=
        new.id is not distinct from old.id
    and new.request_id is not distinct from old.request_id
    and new.table_number is not distinct from old.table_number
    and new.source is not distinct from old.source
    and new.session_id is not distinct from old.session_id
    and new.items is not distinct from old.items
    and new.created_at is not distinct from old.created_at
    and new.discount_type is not distinct from old.discount_type
    and new.discount_value is not distinct from old.discount_value
    and new.entry_price is not distinct from old.entry_price
    and new.headcount is not distinct from old.headcount
    and new.mode is not distinct from old.mode
    and new.cancelled_at is not distinct from old.cancelled_at
    and new.cancelled_by is not distinct from old.cancelled_by
    and new.cancel_reason is not distinct from old.cancel_reason;

  if others_unchanged_status and new.status is distinct from old.status then
    pos_from := array_position(flow, old.status);
    pos_to := array_position(flow, new.status);
    if pos_from is not null and pos_to is not null and abs(pos_from - pos_to) = 1 then
      return new;
    end if;
    raise exception 'orders: transição de estado inválida (% -> %)', old.status, new.status;
  end if;

  -- Caminho B: cancelamento lógico (só status + campos de cancelamento).
  others_unchanged_cancel :=
        new.id is not distinct from old.id
    and new.request_id is not distinct from old.request_id
    and new.table_number is not distinct from old.table_number
    and new.source is not distinct from old.source
    and new.session_id is not distinct from old.session_id
    and new.items is not distinct from old.items
    and new.created_at is not distinct from old.created_at
    and new.discount_type is not distinct from old.discount_type
    and new.discount_value is not distinct from old.discount_value
    and new.entry_price is not distinct from old.entry_price
    and new.headcount is not distinct from old.headcount
    and new.mode is not distinct from old.mode;

  if others_unchanged_cancel
     and old.status in ('pending', 'preparing', 'ready')
     and new.status = 'cancelled'
     and new.cancelled_at is not null
     and new.cancelled_by = auth.uid()
     and new.cancel_reason is not null then
    return new;
  end if;

  raise exception 'orders: update não permitido';
end;
$$;

create trigger orders_validate_update_trg
  before update on public.orders
  for each row execute function public.orders_validate_update();

-- sessions: snapshot de rodízio no INSERT (valida contra settings).
create or replace function public.sessions_validate_insert()
returns trigger language plpgsql set search_path = public as $$
declare
  st public.settings;
begin
  if new.mode is not null or new.entry_price is not null or new.headcount is not null then
    if new.mode is distinct from 'rodizio'
       or new.entry_price is null or new.entry_price <= 0
       or new.headcount is null or new.headcount < 1 then
      raise exception 'sessions: snapshot de rodízio inválido';
    end if;
    select * into st from public.settings where id = 'restaurant';
    if not found or st.mode not in ('rodizio', 'mixed') or new.entry_price <> st.entry_price then
      raise exception 'sessions: rodízio não corresponde às settings';
    end if;
  end if;
  return new;
end;
$$;

create trigger sessions_validate_insert_trg
  before insert on public.sessions
  for each row execute function public.sessions_validate_insert();

-- sessions: UPDATE = staff (estado/snapshot) OU cliente (define código 1x).
create or replace function public.sessions_validate_update()
returns trigger language plpgsql set search_path = public as $$
declare
  st public.settings;
  staff_fields_only boolean;
  client_code_only boolean;
begin
  -- Caminho staff: só open/opened_at/mode/entry_price/headcount/access_code_hash
  -- podem mudar (id/table_number/created_at/expires_at intactos).
  staff_fields_only :=
        new.id is not distinct from old.id
    and new.table_number is not distinct from old.table_number
    and new.created_at is not distinct from old.created_at
    and new.expires_at is not distinct from old.expires_at;

  if public.is_staff() and staff_fields_only and new.open is not null then
    if new.mode is not null or new.entry_price is not null or new.headcount is not null then
      if new.mode is distinct from 'rodizio'
         or new.entry_price is null or new.entry_price <= 0
         or new.headcount is null or new.headcount < 1 then
        raise exception 'sessions: snapshot de rodízio inválido';
      end if;
      select * into st from public.settings where id = 'restaurant';
      if not found or st.mode not in ('rodizio', 'mixed') or new.entry_price <> st.entry_price then
        raise exception 'sessions: rodízio não corresponde às settings';
      end if;
    end if;

    -- Ao fechar/reiniciar uma mesa, os telemóveis antigos deixam de estar
    -- associados à sessão. O próximo cliente terá de provar/criar novo código.
    if new.open is false or new.access_code_hash is null then
      delete from public.session_clients where session_id = old.id;
      delete from public.session_code_attempts where session_id = old.id;
    end if;

    return new;
  end if;

  -- Caminho cliente: só access_code_hash muda, sessão aberta e ainda sem código.
  client_code_only :=
        new.id is not distinct from old.id
    and new.table_number is not distinct from old.table_number
    and new.created_at is not distinct from old.created_at
    and new.expires_at is not distinct from old.expires_at
    and new.open is not distinct from old.open
    and new.opened_at is not distinct from old.opened_at
    and new.mode is not distinct from old.mode
    and new.entry_price is not distinct from old.entry_price
    and new.headcount is not distinct from old.headcount
    and new.access_code_hash is distinct from old.access_code_hash;

  if client_code_only
     and old.open is true
     and old.access_code_hash is null
     and new.access_code_hash is not null then
    return new;
  end if;

  raise exception 'sessions: update não permitido';
end;
$$;

create trigger sessions_validate_update_trg
  before update on public.sessions
  for each row execute function public.sessions_validate_update();

-- service_calls: session_id obrigatório + mesa==sessão no INSERT.
create or replace function public.service_calls_validate_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sess public.sessions;
  my_table integer;
begin
  -- Estes campos são sempre propriedade da BD. Mesmo que o browser envie outro
  -- valor, a chamada nasce aberta e sem histórico de atendimento.
  new.created_at := public.now_iso();
  new.status := 'open';
  new.acknowledged_at := null;
  new.acknowledged_by := null;
  new.resolved_at := null;
  new.resolved_by := null;

  if new.session_id is null then
    raise exception 'service_calls: session_id obrigatório';
  end if;

  select * into sess from public.sessions where id = new.session_id;
  if not found or new.table_number <> sess.table_number then
    raise exception 'service_calls: mesa não corresponde à sessão';
  end if;
  if sess.open is not true then
    raise exception 'service_calls: sessão não está aberta';
  end if;
  if sess.expires_at is not null and sess.expires_at::timestamptz <= now() then
    raise exception 'service_calls: sessão expirada';
  end if;

  if public.is_cliente() then
    my_table := public.profile_table_number();
    if my_table is null or sess.table_number <> my_table then
      raise exception 'service_calls: cliente só pode chamar para a mesa do perfil';
    end if;
  end if;

  return new;
end;
$$;

create trigger service_calls_validate_insert_trg
  before insert on public.service_calls
  for each row execute function public.service_calls_validate_insert();

-- service_calls: lifecycle simples e auditável.
-- open -> acknowledged -> resolved, com open -> resolved permitido se a equipa
-- tratar a chamada logo sem precisar de um passo intermédio.
create or replace function public.service_calls_validate_update()
returns trigger language plpgsql set search_path = public as $$
declare
  core_fields_unchanged boolean;
begin
  core_fields_unchanged :=
        new.id is not distinct from old.id
    and new.table_number is not distinct from old.table_number
    and new.type is not distinct from old.type
    and new.session_id is not distinct from old.session_id
    and new.created_at is not distinct from old.created_at;

  if not core_fields_unchanged then
    raise exception 'service_calls: só o estado pode mudar';
  end if;

  if old.status = 'resolved' then
    raise exception 'service_calls: chamada resolvida não pode voltar atrás';
  end if;

  if old.status = 'open' and new.status = 'acknowledged' then
    new.acknowledged_at := public.now_iso();
    new.acknowledged_by := auth.uid();
    new.resolved_at := null;
    new.resolved_by := null;
    return new;
  end if;

  if old.status in ('open', 'acknowledged') and new.status = 'resolved' then
    new.acknowledged_at := old.acknowledged_at;
    new.acknowledged_by := old.acknowledged_by;
    new.resolved_at := public.now_iso();
    new.resolved_by := auth.uid();
    return new;
  end if;

  raise exception 'service_calls: transição de estado inválida (% -> %)', old.status, new.status;
end;
$$;

create trigger service_calls_validate_update_trg
  before update on public.service_calls
  for each row execute function public.service_calls_validate_update();

-- payments: ficam ligados à sessão aberta que está a ser fechada. Além de
-- validar sessão/mesa/criador, recalcula o total a partir de snapshots de
-- confiança (entrada de rodízio + receita dos pedidos da sessão) e rejeita se o
-- amount enviado pela app divergir mais de 1 cêntimo. Defesa em profundidade da
-- Invariante de dinheiro: o browser envia intenção, a BD confirma a verdade.
-- É `security definer` para ler sessions/orders sem a RLS (as linhas dos pedidos
-- já vêm normalizadas por orders_validate_insert, por isso a soma é fiável).
create or replace function public.payments_validate_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sess public.sessions;
  entry_total numeric := 0;     -- entrada de rodízio: preço de entrada × nº de pessoas
  orders_revenue numeric := 0;  -- soma da receita (subtotal - desconto) dos pedidos da conta
  expected_total numeric := 0;  -- total recalculado que o amount tem de espelhar
begin
  if new.session_id is null then
    raise exception 'payments: session_id obrigatório';
  end if;

  select * into sess from public.sessions where id = new.session_id;
  if not found or new.table_number <> sess.table_number then
    raise exception 'payments: mesa não corresponde à sessão';
  end if;
  if sess.open is not true then
    raise exception 'payments: sessão não está aberta';
  end if;
  -- NÃO exigimos sessão não-expirada aqui (ao contrário de orders/service_calls).
  -- A TTL (expires_at) é segurança do QR contra consumo novo, não barreira ao
  -- fecho da conta: uma sessão temporária (TTL 4h) pode expirar com a conta ainda
  -- por pagar, e o empregado tem de poder SEMPRE fechar a conta. Basta a sessão
  -- estar aberta (open=true); o closeSession já trata sessões expiradas.
  if new.created_by <> auth.uid() then
    raise exception 'payments: created_by tem de ser o utilizador atual';
  end if;

  -- 1) Entrada de rodízio (espelha accountEntryTotal + entryTotal): só conta
  -- quando a sessão é rodízio e tem preço de entrada e nº de pessoas válidos.
  if sess.mode = 'rodizio'
     and coalesce(sess.entry_price, 0) > 0
     and coalesce(sess.headcount, 0) > 0 then
    entry_total := sess.entry_price * sess.headcount;
  end if;

  -- 2) Receita dos pedidos da conta atual (espelha currentAccountOrders +
  -- orderItemsRevenue). Pedidos cancelados ficam de fora e, se a sessão tiver
  -- opened_at, só entram os pedidos a partir desse momento (igual à conta da UI).
  -- Cada linha usa preço >= 0 e quantidade com floor e teto 9999, tal como
  -- safeUnitPrice/safeQuantity em order-utils.ts.
  select coalesce(sum(order_revenue), 0)
    into orders_revenue
  from (
    select
      order_subtotal
      -- desconto já com clamp em [0, subtotal] (espelha orderDiscountAmount).
      - least(
          greatest(
            case
              when o.discount_type = 'percent'
                then order_subtotal * (coalesce(o.discount_value, 0) / 100)
              else coalesce(o.discount_value, 0)
            end,
            0
          ),
          order_subtotal
        ) as order_revenue
    from public.orders o
    cross join lateral (
      -- subtotal do pedido = soma das linhas (espelha lineTotal/orderSubtotal).
      select coalesce(sum(
               greatest((item->>'price')::numeric, 0)
               * least(floor(greatest((item->>'quantity')::numeric, 0)), 9999)
             ), 0) as order_subtotal
      from jsonb_array_elements(o.items) as item
    ) line_sum
    where o.session_id = new.session_id
      and o.status <> 'cancelled'
      and (sess.opened_at is null or o.created_at::timestamptz >= sess.opened_at::timestamptz)
  ) per_order;

  -- 3) Total = entrada + receita, arredondado a 2 casas (igual à conta da UI).
  expected_total := round(entry_total + orders_revenue, 2);

  if abs(new.amount - expected_total) > 0.01 then
    raise exception 'payments: total (%) não corresponde ao recalculado (%) — confirma a conta de novo',
      new.amount, expected_total;
  end if;

  return new;
end;
$$;

create trigger payments_validate_insert_trg
  before insert on public.payments
  for each row execute function public.payments_validate_insert();

-- ── Realtime ───────────────────────────────────────────────────────────────
-- replica identity full: dá ao Realtime as colunas antigas para aplicar a RLS
-- nos eventos UPDATE/DELETE (senão deletes podiam não chegar aos subscritores).
alter table public.profiles      replica identity full;
alter table public.categories    replica identity full;
alter table public.menu_items    replica identity full;
alter table public.orders        replica identity full;
alter table public.sessions      replica identity full;
alter table public.session_clients replica identity full;
alter table public.session_code_attempts replica identity full;
alter table public.service_calls replica identity full;
alter table public.settings      replica identity full;
alter table public.shifts        replica identity full;
alter table public.payments      replica identity full;

alter publication supabase_realtime add table
  public.profiles,
  public.categories,
  public.menu_items,
  public.orders,
  public.sessions,
  public.session_clients,
  public.session_code_attempts,
  public.service_calls,
  public.settings,
  public.shifts,
  public.payments;
