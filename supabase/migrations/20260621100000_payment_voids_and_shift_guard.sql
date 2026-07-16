-- Operacao/conta hardening:
-- 1) payments keep an auditable void trail instead of physical correction.
-- 2) new payments snapshot the account window they closed, so a void can reopen
--    the same operational account safely.
-- 3) shifts cannot close while there are open tables/sessions.

alter table public.payments add column if not exists voided_at text;
alter table public.payments add column if not exists voided_by uuid;
alter table public.payments add column if not exists void_reason text;
alter table public.payments add column if not exists account_opened_at text;
alter table public.payments add column if not exists account_closed_at text;
alter table public.payments add column if not exists account_mode text;
alter table public.payments add column if not exists account_entry_price numeric;
alter table public.payments add column if not exists account_headcount integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'payments_account_mode_valid'
  ) then
    alter table public.payments
      add constraint payments_account_mode_valid
      check (account_mode is null or account_mode in ('normal', 'rodizio'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'payments_account_headcount_valid'
  ) then
    alter table public.payments
      add constraint payments_account_headcount_valid
      check (account_headcount is null or account_headcount >= 1);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'payments_void_reason_valid'
  ) then
    alter table public.payments
      add constraint payments_void_reason_valid
      check (
        (voided_at is null and voided_by is null and void_reason is null)
        or (
          voided_at is not null
          and voided_by is not null
          and void_reason is not null
          and length(btrim(void_reason)) between 1 and 500
        )
      );
  end if;
end $$;

-- ── Payments: server-owned metadata + account snapshot ────────────────────

create or replace function public.payments_validate_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sess public.sessions;
  payment_shift public.shifts;
  entry_total numeric := 0;
  orders_revenue numeric := 0;
  expected_total numeric := 0;
  unfinished_count integer := 0;
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
  if new.created_by <> auth.uid() then
    raise exception 'payments: created_by tem de ser o utilizador atual';
  end if;

  if new.shift_id is not null then
    select * into payment_shift from public.shifts where id = new.shift_id;
    if not found or payment_shift.status <> 'open' then
      raise exception 'payments: turno inválido ou fechado';
    end if;
  end if;

  select count(*)
    into unfinished_count
  from public.orders o
  where o.session_id = new.session_id
    and o.status in ('pending', 'preparing', 'ready')
    and (sess.opened_at is null or o.created_at::timestamptz >= sess.opened_at::timestamptz);

  if unfinished_count > 0 then
    raise exception 'payments: existem pedidos por concluir nesta conta';
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

  -- A BD é dona dos metadados operacionais. O browser envia intenção; a linha
  -- grava o instante e o intervalo de conta que acabou de ser fechado.
  new.created_at := public.now_iso();
  new.voided_at := null;
  new.voided_by := null;
  new.void_reason := null;
  new.account_opened_at := sess.opened_at;
  new.account_closed_at := new.created_at;
  new.account_mode := coalesce(sess.mode, 'normal');
  new.account_entry_price := sess.entry_price;
  new.account_headcount := sess.headcount;

  return new;
end;
$$;

-- Reabrir uma conta a partir de um pagamento anulado restaura um snapshot
-- histórico. Nesse caso o snapshot não pode depender das settings atuais,
-- porque o restaurante pode ter voltado de rodízio para normal depois do fecho.
create or replace function public.sessions_validate_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  st public.settings;
  staff_fields_only boolean;
  client_code_only boolean;
  trusted_snapshot_reopen boolean := current_setting('app.allow_session_snapshot_reopen', true) = 'on';
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

      if not trusted_snapshot_reopen then
        select * into st from public.settings where id = 'restaurant';
        if not found or st.mode not in ('rodizio', 'mixed') or new.entry_price <> st.entry_price then
          raise exception 'sessions: rodízio não corresponde às settings';
        end if;
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

-- ── Payments: void as auditable correction, optionally reopening account ───

create or replace function public.void_payment(
  p_payment_id uuid,
  p_reason text,
  p_action text default 'void_only'
)
returns table(ok boolean, reopened boolean, action text)
language plpgsql security definer set search_path = public as $$
declare
  pay public.payments;
  sess public.sessions;
  clean_reason text := btrim(coalesce(p_reason, ''));
  should_reopen boolean := p_action in ('reopen_session', 'reopen_and_close');
begin
  if not (public.is_admin() or public.is_gerente()) then
    raise exception 'payments: só admin/gerente podem anular registos';
  end if;

  if p_action not in ('void_only', 'reopen_session', 'reopen_and_close') then
    raise exception 'payments: ação de anulação inválida';
  end if;

  if length(clean_reason) < 1 or length(clean_reason) > 500 then
    raise exception 'payments: motivo de anulação obrigatório';
  end if;

  select * into pay
  from public.payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'payments: registo inexistente';
  end if;

  if pay.voided_at is not null then
    raise exception 'payments: registo já anulado';
  end if;

  if should_reopen then
    if pay.session_id is null
       or pay.account_opened_at is null
       or pay.account_closed_at is null then
      raise exception 'payments: registo antigo sem snapshot para reabrir';
    end if;

    if exists (
      select 1
      from public.payments newer
      where newer.table_number = pay.table_number
        and newer.id <> pay.id
        and newer.created_at::timestamptz > pay.created_at::timestamptz
    ) then
      raise exception 'payments: só o fecho mais recente da mesa pode reabrir a conta';
    end if;

    select * into sess
    from public.sessions
    where id = pay.session_id
    for update;

    if not found then
      raise exception 'payments: sessão original inexistente';
    end if;

    if exists (
      select 1
      from public.sessions s
      where s.table_number = pay.table_number
        and s.open is true
        and s.id <> sess.id
    ) then
      raise exception 'payments: a mesa já tem outra sessão aberta';
    end if;
  end if;

  update public.payments
  set
    voided_at = public.now_iso(),
    voided_by = auth.uid(),
    void_reason = clean_reason
  where id = pay.id;

  if should_reopen then
    perform set_config('app.allow_session_snapshot_reopen', 'on', true);

    update public.sessions
    set
      open = true,
      opened_at = pay.account_opened_at,
      access_code_hash = null,
      mode = case when pay.account_mode = 'rodizio' then 'rodizio' else null end,
      entry_price = case when pay.account_mode = 'rodizio' then pay.account_entry_price else null end,
      headcount = case when pay.account_mode = 'rodizio' then pay.account_headcount else null end
    where id = pay.session_id;

    perform set_config('app.allow_session_snapshot_reopen', 'off', true);
  end if;

  return query select true, should_reopen, p_action;
end;
$$;

grant execute on function public.void_payment(uuid, text, text) to authenticated;

-- ── Shifts: do not close cash while tables are still open ─────────────────

create or replace function public.shifts_validate_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  open_tables text;
begin
  if not (public.is_admin() or public.is_gerente()) then
    raise exception 'shifts: só admin/gerente podem alterar turnos';
  end if;

  if old.status = 'open' and new.status = 'closed' then
    select string_agg('Mesa ' || s.table_number::text, ', ' order by s.table_number)
      into open_tables
    from public.sessions s
    where s.open is true;

    if open_tables is not null then
      raise exception 'shifts: fecha primeiro as mesas abertas: %', open_tables;
    end if;

    if new.closed_by <> auth.uid() then
      raise exception 'shifts: closed_by tem de ser o utilizador atual';
    end if;

    new.closed_at := public.now_iso();
    return new;
  end if;

  if old.status = 'closed' and new.status <> old.status then
    raise exception 'shifts: turno fechado não reabre';
  end if;

  return new;
end;
$$;

drop trigger if exists shifts_validate_update_trg on public.shifts;
create trigger shifts_validate_update_trg
  before update on public.shifts
  for each row execute function public.shifts_validate_update();
