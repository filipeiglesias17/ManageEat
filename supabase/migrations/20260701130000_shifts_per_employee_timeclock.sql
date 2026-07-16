-- Turnos deixam de ser a "caixa" global (1 turno aberto por restaurante) e
-- passam a relógio de PONTO por empregado: picar entrada = abrir o próprio
-- turno; picar saída = fechar. Vários turnos abertos em simultâneo (máx. 1 por
-- pessoa). O chefe (admin/gerente) vê quem está em turno e pode forçar a saída
-- de quem se esqueceu de picar.
--
-- Consequência nos pagamentos: cobrar passa a exigir o PRÓPRIO turno aberto
-- (shift_id obrigatório e opened_by = created_by) — a receita fica ligada a
-- quem cobrou e acabam os pagamentos "órfãos" sem turno. A coluna shift_id
-- continua nullable: pagamentos históricos ficam válidos; a obrigatoriedade
-- vive só no trigger (INSERTs novos).

-- ── 1) Unicidade: de 1 turno global para 1 turno aberto POR utilizador ──────
-- Hoje existe no máximo 1 turno aberto no total (índice antigo), por isso o
-- índice novo nunca colide com dados existentes. Também trava o duplo "picar
-- entrada" do mesmo utilizador em dois dispositivos.
drop index if exists public.shifts_single_open_idx;
create unique index shifts_single_open_idx
  on public.shifts (opened_by) where status = 'open';

-- ── 2) RLS: qualquer staff abre/fecha o SEU turno ───────────────────────────
-- INSERT: cozinha incluída (o chefe quer as horas de toda a gente). O turno é
-- sempre do próprio; o trigger revalida a autoria.
drop policy if exists shifts_insert on public.shifts;
create policy shifts_insert on public.shifts for insert
  with check (public.is_staff() and opened_by = auth.uid());

-- UPDATE: o próprio pica a saída; admin/gerente podem forçar a saída de outro.
-- SELECT (staff lê tudo) e DELETE (admin/gerente) mantêm-se como estavam.
drop policy if exists shifts_update on public.shifts;
create policy shifts_update on public.shifts for update
  using (opened_by = auth.uid() or public.is_admin() or public.is_gerente())
  with check (opened_by = auth.uid() or public.is_admin() or public.is_gerente());

-- ── 3) Picar entrada: staff, autoria própria, hora da BD ────────────────────
-- Igual ao trigger anterior (20260627130000) com o role check alargado de
-- admin/gerente para staff. A hora do ponto continua a ser da BD, não do
-- browser — um registo de horas não forjável.
create or replace function public.shifts_validate_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'shifts: só staff pode picar entrada';
  end if;

  if new.opened_by is null or new.opened_by <> auth.uid() then
    raise exception 'shifts: opened_by tem de ser o utilizador atual';
  end if;

  -- A BD é dona dos timestamps do ponto; não aceitar relógios do browser.
  new.opened_at := public.now_iso();

  if new.status = 'closed' then
    if new.closed_by is null or new.closed_by <> auth.uid() then
      raise exception 'shifts: closed_by tem de ser o utilizador atual';
    end if;
    new.closed_at := public.now_iso();
  else
    -- Turno aberto nasce sem fecho.
    new.closed_at := null;
    new.closed_by := null;
  end if;

  return new;
end;
$$;

-- ── 4) Picar saída: só open → closed, pelo próprio ou por um responsável ────
-- Sai a guarda "não fechar com mesas abertas": fazia sentido para fechar a
-- CAIXA global, não para o ponto — um empregado não fica preso ao serviço por
-- uma mesa aberta. A integridade financeira não depende dela: as contas têm
-- guardas próprias (total recalculado no Postgres, pagamento único por conta,
-- sessão tem de estar aberta).
create or replace function public.shifts_validate_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not (old.opened_by = auth.uid() or public.is_admin() or public.is_gerente()) then
    raise exception 'shifts: só o próprio ou um responsável pode fechar o turno';
  end if;

  -- Um registo de ponto fechado é imutável (auditoria de horas): nem reabre
  -- nem se retocam os tempos depois do fecho.
  if old.status = 'closed' then
    raise exception 'shifts: turno fechado não se altera';
  end if;

  if new.status <> 'closed' then
    raise exception 'shifts: a única alteração permitida é picar a saída';
  end if;

  -- A entrada é imutável e quem fecha assume a autoria: num fecho forçado o
  -- closed_by fica o admin/gerente que forçou (auditoria correta). A hora de
  -- saída é sempre da BD.
  new.opened_at := old.opened_at;
  new.opened_by := old.opened_by;
  if new.closed_by is null or new.closed_by <> auth.uid() then
    raise exception 'shifts: closed_by tem de ser o utilizador atual';
  end if;
  new.closed_at := public.now_iso();

  return new;
end;
$$;

-- ── 5) Pagamentos: cobrar exige o PRÓPRIO turno aberto ──────────────────────
-- Corpo copiado na íntegra de 20260621100000; muda apenas o bloco do shift_id
-- (antes opcional): agora é obrigatório, tem de estar aberto e pertencer a
-- quem regista o pagamento.
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

  -- Relógio de ponto: quem cobra tem de estar em turno, e o turno tem de ser
  -- o seu — liga a receita a quem cobrou e evita pagamentos órfãos.
  if new.shift_id is null then
    raise exception 'payments: é preciso estar em turno para fechar contas';
  end if;
  select * into payment_shift from public.shifts where id = new.shift_id;
  if not found or payment_shift.status <> 'open' then
    raise exception 'payments: turno inválido ou fechado';
  end if;
  if payment_shift.opened_by <> new.created_by then
    raise exception 'payments: o turno tem de ser do próprio utilizador';
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
