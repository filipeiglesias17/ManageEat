-- Guardas de segurança da conta (auditoria 2026-06-26, P0):
-- 1) Fecho de conta não-atómico permitia duplo-pagamento e pedido órfão na
--    janela entre createPayment e closeSession. Serializamos com FOR UPDATE na
--    linha da sessão (triggers-guarda) e recusamos um 2.º pagamento/pedido na
--    mesma janela (opened_at). O índice único parcial é o backstop final.
-- 2) Teto de headcount (1..99) por CHECK, já que toda a app assume esse limite.
-- 3) O autoclose de sessões expiradas deixa de destruir contas com consumo por
--    liquidar (perdia a entrada de rodízio sem rasto).
--
-- Estendemos padrões já provados no projeto: void_payment já usa FOR UPDATE.

-- ── 1. Teto de headcount (defesa na própria tabela) ───────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sessions_headcount_range') then
    alter table public.sessions
      add constraint sessions_headcount_range
      check (headcount is null or (headcount >= 1 and headcount <= 99));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'orders_headcount_range') then
    alter table public.orders
      add constraint orders_headcount_range
      check (headcount is null or (headcount >= 1 and headcount <= 99));
  end if;
end $$;

-- ── 2. Backstop: no máximo um pagamento ativo (não anulado) por conta ──────
-- A conta é identificada por (sessão, janela aberta). account_opened_at é
-- gravado por payments_validate_insert; um void preenche voided_at e liberta a
-- janela para o caminho de reabrir+refechar.
create unique index if not exists payments_one_per_account_idx
  on public.payments (session_id, account_opened_at)
  where voided_at is null;

-- ── 3. Guarda no insert de PEDIDOS: serializa e recusa conta já paga ───────
-- Corre antes de orders_validate_insert (nome 'guard' < 'validate'). Trava a
-- linha da sessão para que um pagamento concorrente não passe no meio, e recusa
-- pedidos numa conta já paga (a janela em que a sessão ainda está open=true
-- entre o pagamento e o fecho). Reabrir a conta é o caminho suportado.
create or replace function public.orders_guard_paid_account()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sess public.sessions;
begin
  if new.session_id is null then
    return new; -- orders_validate_insert trata do erro de session_id em falta
  end if;

  select * into sess from public.sessions where id = new.session_id for update;
  if not found then
    return new; -- a validação principal levanta o erro de sessão inexistente
  end if;

  if exists (
    select 1 from public.payments p
    where p.session_id = new.session_id
      and p.account_opened_at is not distinct from sess.opened_at
      and p.voided_at is null
  ) then
    raise exception 'orders: conta já paga — reabre a conta para adicionar pedidos';
  end if;

  return new;
end;
$$;

drop trigger if exists orders_guard_paid_account_trg on public.orders;
create trigger orders_guard_paid_account_trg
  before insert on public.orders
  for each row execute function public.orders_guard_paid_account();

-- ── 4. Guarda no insert de PAGAMENTOS: serializa e recusa pagamento duplo ──
-- Corre antes de payments_validate_insert. Trava a sessão (serializa com
-- pedidos/pagamentos concorrentes) e recusa um 2.º pagamento ativo na mesma
-- janela com um erro legível antes de o índice único disparar.
create or replace function public.payments_guard_double()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sess public.sessions;
begin
  if new.session_id is null then
    return new; -- payments_validate_insert trata do erro de session_id em falta
  end if;

  select * into sess from public.sessions where id = new.session_id for update;
  if not found then
    return new;
  end if;

  -- Exclui o próprio id: um retry idempotente (mesmo requestId) não é "duplo
  -- pagamento" — é a mesma tentativa. Deixa o ON CONFLICT (id) DO NOTHING tratá-lo
  -- como no-op, em vez de erro. Só barra um pagamento com id DIFERENTE.
  if exists (
    select 1 from public.payments p
    where p.session_id = new.session_id
      and p.account_opened_at is not distinct from sess.opened_at
      and p.voided_at is null
      and p.id <> new.id
  ) then
    raise exception 'payments: esta conta já tem um pagamento ativo';
  end if;

  return new;
end;
$$;

drop trigger if exists payments_guard_double_trg on public.payments;
create trigger payments_guard_double_trg
  before insert on public.payments
  for each row execute function public.payments_guard_double();

-- ── 5. Autoclose de sessões expiradas com guarda de conta ─────────────────
-- Só fecha à força sessões expiradas SEM consumo por liquidar. Uma sessão
-- expirada com pedidos não-cancelados ou com entrada de rodízio por cobrar fica
-- aberta para o empregado cobrar/anular; nesse caso a nova sessão na mesma mesa
-- falha com unique violation (sinal de que é preciso fecho manual), em vez de
-- apagar silenciosamente a conta.
create or replace function public.sessions_validate_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  st public.settings;
begin
  -- Resolver chamadas de serviço ativas das sessões expiradas desta mesa.
  update public.service_calls
  set status = 'resolved',
      resolved_at = public.now_iso()
  where session_id in (
    select id from public.sessions
    where table_number = new.table_number
      and open is true
      and expires_at is not null
      and expires_at::timestamptz <= now()
  )
  and status in ('open', 'acknowledged');

  -- Auto-close apenas das sessões expiradas SEM consumo por liquidar.
  update public.sessions s
  set open = false,
      access_code_hash = null,
      opened_at = null,
      mode = null,
      entry_price = null,
      headcount = null
  where s.table_number = new.table_number
    and s.open is true
    and s.expires_at is not null
    and s.expires_at::timestamptz <= now()
    and not exists (
      select 1 from public.orders o
      where o.session_id = s.id
        and o.status <> 'cancelled'
        and (s.opened_at is null or o.created_at::timestamptz >= s.opened_at::timestamptz)
    )
    and not (
      s.mode = 'rodizio'
      and coalesce(s.entry_price, 0) > 0
      and coalesce(s.headcount, 0) > 0
    );

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
