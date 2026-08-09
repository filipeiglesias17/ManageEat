-- Security hardening after pentest:
-- 1) QR code: keep per-user lockout and add a session-wide lockout to stop
--    distributed brute force with fresh anonymous users.
-- 2) Service calls: keep "call waiter without code" for ergonomics, but block
--    duplicate active calls of the same type in the same session.
-- 3) Menu images: only admin/gerente can write/delete images, matching menu item
--    ownership. Empregado/cozinha no longer mutate catalog assets.
-- 4) Payments: server owns created_at, validates shift_id, and rejects zero-value
--    payments. The amount is still recalculated server-side.

--  QR session-wide lockout

create table if not exists public.session_code_locks (
  session_id     text primary key references public.sessions (id) on delete cascade,
  failed_count   integer not null default 0 check (failed_count >= 0),
  locked_until   text,
  last_failed_at text
);

alter table public.session_code_locks enable row level security;
grant select, insert, update, delete on public.session_code_locks to service_role;

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
    greatest(coalesce(a.failed_count, 0), coalesce(l.failed_count, 0)) as code_failed_attempts,
    case
      when l.locked_until is not null and l.locked_until::timestamptz > now() then l.locked_until
      else a.locked_until
    end as code_locked_until
  from public.sessions s
  left join public.session_code_attempts a
    on a.session_id = s.id
   and a.user_id = auth.uid()
  left join public.session_code_locks l
    on l.session_id = s.id
  where s.id = $1
    and (s.expires_at is null or s.expires_at::timestamptz > now())
$$;

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
  session_lock public.session_code_locks;
  next_user_failed_count integer;
  next_session_failed_count integer;
  max_user_attempts constant integer := 5;
  max_session_attempts constant integer := 10;
  lock_for constant interval := interval '5 minutes';
  user_locked_until text;
  session_locked_until text;
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

  select * into session_lock
  from public.session_code_locks
  where session_id = p_session_id
  for update;

  if sess.access_code_hash is not null
     and found
     and session_lock.locked_until is not null
     and session_lock.locked_until::timestamptz > now() then
    return query select false, 'bloqueado', session_lock.failed_count, session_lock.locked_until;
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
      next_user_failed_count := 1;
    elsif attempt.locked_until is not null and attempt.locked_until::timestamptz <= now() then
      next_user_failed_count := 1;
    else
      next_user_failed_count := attempt.failed_count + 1;
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
      next_user_failed_count,
      case when next_user_failed_count >= max_user_attempts then (now() + lock_for)::text else null end,
      now()::text
    )
    on conflict (session_id, user_id) do update
      set failed_count = excluded.failed_count,
          locked_until = excluded.locked_until,
          last_failed_at = excluded.last_failed_at;

    select * into session_lock
    from public.session_code_locks
    where session_id = p_session_id
    for update;

    if not found then
      next_session_failed_count := 1;
    elsif session_lock.locked_until is not null and session_lock.locked_until::timestamptz <= now() then
      next_session_failed_count := 1;
    else
      next_session_failed_count := session_lock.failed_count + 1;
    end if;

    user_locked_until := case when next_user_failed_count >= max_user_attempts then (now() + lock_for)::text else null end;
    session_locked_until := case when next_session_failed_count >= max_session_attempts then (now() + lock_for)::text else null end;

    insert into public.session_code_locks (
      session_id,
      failed_count,
      locked_until,
      last_failed_at
    )
    values (
      p_session_id,
      next_session_failed_count,
      session_locked_until,
      now()::text
    )
    on conflict (session_id) do update
      set failed_count = excluded.failed_count,
          locked_until = excluded.locked_until,
          last_failed_at = excluded.last_failed_at;

    if next_session_failed_count >= max_session_attempts then
      return query select false, 'bloqueado', next_session_failed_count, session_locked_until;
      return;
    end if;

    if next_user_failed_count >= max_user_attempts then
      return query select false, 'bloqueado', next_user_failed_count, user_locked_until;
      return;
    end if;

    return query select false, 'codigo_incorreto', next_user_failed_count, null::text;
    return;
  end if;

  delete from public.session_code_attempts
  where session_id = p_session_id and user_id = auth.uid();

  delete from public.session_code_locks
  where session_id = p_session_id;

  insert into public.session_clients (session_id, user_id, created_at)
  values (p_session_id, auth.uid(), now()::text)
  on conflict (session_id, user_id) do nothing;

  return query select true, null::text, 0, null::text;
end;
$$;

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
  delete from public.session_code_locks where session_id = p_session_id;
end;
$$;

create or replace function public.sessions_validate_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  st public.settings;
  staff_fields_only boolean;
  client_code_only boolean;
begin
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

    if new.open is false or new.access_code_hash is null then
      delete from public.session_clients where session_id = old.id;
      delete from public.session_code_attempts where session_id = old.id;
      delete from public.session_code_locks where session_id = old.id;
    end if;

    return new;
  end if;

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

--  Service calls anti-abuse

create or replace function public.service_calls_validate_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sess public.sessions;
  my_table integer;
begin
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

  if exists (
    select 1
    from public.service_calls c
    where c.session_id = new.session_id
      and c.type = new.type
      and c.status in ('open', 'acknowledged')
  ) then
    raise exception 'service_calls: já existe uma chamada ativa deste tipo para esta mesa';
  end if;

  return new;
end;
$$;

--  Storage permissions

drop policy if exists "menu-images staff insert" on storage.objects;
drop policy if exists "menu-images staff update" on storage.objects;
drop policy if exists "menu-images staff delete" on storage.objects;

create policy "menu-images manager insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'menu-images' and (public.is_admin() or public.is_gerente()));

create policy "menu-images manager update" on storage.objects
  for update to authenticated
  using (bucket_id = 'menu-images' and (public.is_admin() or public.is_gerente()));

create policy "menu-images manager delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'menu-images' and (public.is_admin() or public.is_gerente()));

--  Payments hardening

create or replace function public.payments_validate_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sess public.sessions;
  payment_shift public.shifts;
  entry_total numeric := 0;
  orders_revenue numeric := 0;
  expected_total numeric := 0;
begin
  new.created_at := public.now_iso();

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
  if new.created_by <> auth.uid() then
    raise exception 'payments: created_by tem de ser o utilizador atual';
  end if;

  if new.shift_id is not null then
    select * into payment_shift from public.shifts where id = new.shift_id;
    if not found or payment_shift.status <> 'open' then
      raise exception 'payments: turno inválido ou fechado';
    end if;
  end if;

  if sess.mode = 'rodizio'
     and coalesce(sess.entry_price, 0) > 0
     and coalesce(sess.headcount, 0) > 0 then
    entry_total := sess.entry_price * sess.headcount;
  end if;

  select coalesce(sum(order_revenue), 0)
    into orders_revenue
  from (
    select
      order_subtotal
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

  expected_total := round(entry_total + orders_revenue, 2);

  if expected_total <= 0 then
    raise exception 'payments: conta sem total a pagar';
  end if;

  if abs(new.amount - expected_total) > 0.01 then
    raise exception 'payments: total (%) não corresponde ao recalculado (%) — confirma a conta de novo',
      new.amount, expected_total;
  end if;

  return new;
end;
$$;
