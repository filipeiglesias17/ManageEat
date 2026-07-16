-- Códigos de erro em vez de texto PT nos `raise exception` (RLS/triggers).
--
-- Problema que resolve: até agora as mensagens de `raise exception` eram texto
-- PT fixo ('orders: sessão não está aberta'). O browser lançava esse texto tal
-- e qual (ver `throwOnError` em src/lib/db/base.ts) — não havia forma de
-- traduzir para EN nem de mostrar uma mensagem mais amigável sem duplicar a
-- regra de negócio no cliente. O padrão já existia para o código QR
-- (`claim_session_with_code` devolve 'codigo_incorreto', 'bloqueado', etc. —
-- ver supabase/migrations/20260620120100_rls.sql) — esta migração generaliza-o.
--
-- A partir daqui as funções abaixo lançam um CÓDIGO-MÁQUINA estável em
-- snake_case (`err_<área>_<motivo>`, ex.: 'err_order_session_closed'), com
-- parâmetro opcional depois de um '|' (ex.: 'err_order_item_unavailable|Pizza').
-- `throwOnError` (src/lib/db/base.ts) reconhece o padrão e lança um
-- `AppDbError` cuja mensagem legível vem do dicionário i18n
-- (src/lib/i18n/pt|en/errors.ts) — texto PT/EN escolhido no cliente, nunca
-- hard-coded no Postgres. Mensagens que NÃO batem no padrão continuam a passar
-- tal e qual (nenhuma outra função foi tocada).
--
-- `err_invalid_operation` é o código partilhado para invariantes internas que a
-- UI normal nunca dispara (formas de payload impossíveis vindas de um cliente
-- forjado, caminhos só acessíveis por GUC do servidor). Todas as mensagens que
-- ajudam o staff a perceber o que aconteceu (turno, sessão fechada/expirada,
-- descontos, quantidades, rate-limit, pedidos por entregar, rodízio) mantêm
-- código 1:1.
--
-- Só a MENSAGEM muda — toda a lógica (condições, side-effects, ordem dos
-- checks) fica byte-a-byte igual à última definição de cada função.

-- ── 1) As 4 funções canónicas (fonte única em supabase/sql/functions/*.sql) ──
-- Corpos colados byte-a-byte dos ficheiros canónicos (o golden-test
-- src/lib/sql/canonical-functions.test.ts garante que não divergem).

-- ── orders_validate_insert (fonte: supabase/sql/functions/orders_validate_insert.sql) ──────────
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
  new.created_at := public.now_iso();
  new.cancelled_at := null;
  new.cancelled_by := null;
  new.cancel_reason := null;

  -- D1: staff de sala sem turno picado não envia pedidos.
  if not public.operational_shift_ok() then
    raise exception 'err_shift_required';
  end if;

  if (new.discount_type is not null or new.discount_value is not null)
     and not public.is_staff() then
    raise exception 'err_order_discount_staff_only';
  end if;

  if new.session_id is null then
    raise exception 'err_order_session_required';
  end if;

  select * into sess from public.sessions where id = new.session_id;
  if not found then
    raise exception 'err_order_session_not_found';
  end if;
  if new.table_number <> sess.table_number then
    raise exception 'err_order_table_mismatch';
  end if;
  if sess.open is not true then
    raise exception 'err_order_session_closed';
  end if;
  if sess.expires_at is not null and sess.expires_at::timestamptz <= now() then
    raise exception 'err_order_session_expired';
  end if;

  if new.mode = 'rodizio' then
    if sess.mode is distinct from 'rodizio' then
      raise exception 'err_rodizio_snapshot_mismatch';
    end if;

    if new.entry_price is not null and new.entry_price <> sess.entry_price then
      raise exception 'err_rodizio_snapshot_mismatch';
    end if;
    if new.headcount is not null and new.headcount <> sess.headcount then
      raise exception 'err_rodizio_snapshot_mismatch';
    end if;

    select exists (
      select 1
      from public.orders
      where session_id = new.session_id
        and status <> 'cancelled'
        and (
          sess.opened_at is null
          or created_at::timestamptz >= sess.opened_at::timestamptz
        )
    ) into has_active_order;

    if has_active_order then
      new.entry_price := null;
      new.headcount := null;
    else
      new.entry_price := sess.entry_price;
      new.headcount := sess.headcount;
    end if;
  end if;

  if new.mode is not null or new.entry_price is not null or new.headcount is not null then
    if new.mode is distinct from 'rodizio' then
      raise exception 'err_rodizio_snapshot_invalid';
    end if;
    if sess.mode is distinct from 'rodizio' then
      raise exception 'err_rodizio_snapshot_mismatch';
    end if;

    if new.entry_price is not null or new.headcount is not null then
      if new.entry_price is null or new.entry_price < 0
         or new.headcount is null or new.headcount < 1 then
        raise exception 'err_rodizio_snapshot_invalid';
      end if;
      if new.entry_price <> sess.entry_price
         or new.headcount <> sess.headcount then
        raise exception 'err_rodizio_snapshot_mismatch';
      end if;
    end if;
  end if;

  if public.is_cliente() then
    my_table := public.profile_table_number();
    if my_table is null then
      raise exception 'err_order_customer_no_table';
    end if;
    if sess.table_number <> my_table then
      raise exception 'err_order_customer_table_mismatch|%', my_table;
    end if;
  end if;

  for item in select value from jsonb_array_elements(new.items)
  loop
    if jsonb_typeof(item) is distinct from 'object' then
      raise exception 'err_invalid_operation';
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
      raise exception 'err_invalid_operation';
    end if;

    if item->>'menuItemId' is null or length(btrim(item->>'menuItemId')) = 0 then
      raise exception 'err_invalid_operation';
    end if;

    begin
      item_id := (item->>'menuItemId')::uuid;
    exception when invalid_text_representation then
      raise exception 'err_invalid_operation';
    end;

    select * into menu_item
    from public.menu_items
    where id = item_id;

    if not found then
      raise exception 'err_order_item_not_found';
    end if;

    if menu_item.available is not true then
      raise exception 'err_order_item_unavailable|%', menu_item.name;
    end if;

    if not (item ? 'quantity') or jsonb_typeof(item->'quantity') is distinct from 'number' then
      raise exception 'err_order_quantity_invalid|%', menu_item.name;
    end if;

    item_quantity := (item->>'quantity')::numeric;
    if item_quantity <> floor(item_quantity) or item_quantity < 1 or item_quantity > 99 then
      raise exception 'err_order_quantity_out_of_range|%', menu_item.name;
    end if;
    safe_quantity := item_quantity::integer;

    notes := coalesce(item->>'notes', '');
    if length(notes) > 500 then
      raise exception 'err_order_notes_too_long|%', menu_item.name;
    end if;

    removed := coalesce(item->'removedIngredients', '[]'::jsonb);
    if jsonb_typeof(removed) is distinct from 'array' then
      raise exception 'err_invalid_operation';
    end if;

    select coalesce(array_agg(value), array[]::text[])
      into removed_names
    from jsonb_array_elements_text(removed) as value;

    if exists (
      select 1
      from unnest(removed_names) as removed_name
      where removed_name <> all(coalesce(menu_item.removable_ingredients, array[]::text[]))
    ) then
      raise exception 'err_order_removed_ingredient_invalid|%', menu_item.name;
    end if;

    unit_price := menu_item.price * (1 - coalesce(menu_item.discount, 0) / 100);
    has_item_discount := item ? 'itemDiscountType' or item ? 'itemDiscountValue';

    if new.mode = 'rodizio' and coalesce(menu_item.rodizio_available, false) is true then
      if has_item_discount then
        raise exception 'err_order_rodizio_item_no_discount';
      end if;
      unit_price := 0;
    elsif has_item_discount then
      if not public.is_staff() then
        raise exception 'err_order_item_discount_staff_only';
      end if;
      if not (item ? 'itemDiscountType') or not (item ? 'itemDiscountValue') then
        raise exception 'err_order_item_discount_incomplete|%', menu_item.name;
      end if;
      if jsonb_typeof(item->'itemDiscountValue') is distinct from 'number' then
        raise exception 'err_order_item_discount_invalid|%', menu_item.name;
      end if;

      item_discount_type := item->>'itemDiscountType';
      item_discount_value := (item->>'itemDiscountValue')::numeric;

      if item_discount_type not in ('percent', 'euros') or item_discount_value <= 0 then
        raise exception 'err_order_item_discount_invalid|%', menu_item.name;
      end if;

      if item_discount_type = 'percent' then
        if item_discount_value > 100 then
          raise exception 'err_order_item_discount_over_100';
        end if;
        unit_price := unit_price * (1 - item_discount_value / 100);
      else
        if item_discount_value > unit_price then
          raise exception 'err_order_item_discount_exceeds_price';
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
    raise exception 'err_order_discount_incomplete';
  end if;

  if new.discount_type is not null then
    if new.discount_value <= 0 then
      raise exception 'err_order_discount_invalid';
    end if;
    if new.discount_type = 'percent' and new.discount_value > 100 then
      raise exception 'err_order_discount_over_100';
    end if;
    if new.discount_type = 'euros' and new.discount_value > subtotal_after_item_discounts then
      raise exception 'err_order_discount_exceeds_subtotal';
    end if;
  end if;

  new.items := normalized_items;

  return new;
end;
$$;

-- ── orders_validate_update (fonte: supabase/sql/functions/orders_validate_update.sql) ──────────
create or replace function public.orders_validate_update()
returns trigger language plpgsql set search_path = public as $$
declare
  others_unchanged_status boolean;
  others_unchanged_cancel boolean;
  flow text[] := array['pending', 'preparing', 'ready', 'delivered'];
  pos_from integer;
  pos_to integer;
begin
  -- Caminho C (confiança): resync da entrada disparado pelo servidor
  -- (set_session_headcount ou reatribuição no cancelamento). Só entry_price e
  -- headcount podem mudar.
  if current_setting('app.allow_entry_resync', true) = 'on' then
    if new.id is not distinct from old.id
       and new.request_id is not distinct from old.request_id
       and new.table_number is not distinct from old.table_number
       and new.source is not distinct from old.source
       and new.session_id is not distinct from old.session_id
       and new.items is not distinct from old.items
       and new.created_at is not distinct from old.created_at
       and new.discount_type is not distinct from old.discount_type
       and new.discount_value is not distinct from old.discount_value
       and new.status is not distinct from old.status
       and new.mode is not distinct from old.mode
       and new.cancelled_at is not distinct from old.cancelled_at
       and new.cancelled_by is not distinct from old.cancelled_by
       and new.cancel_reason is not distinct from old.cancel_reason then
      return new;
    end if;
    raise exception 'err_invalid_operation';
  end if;

  -- D1: staff de sala sem turno picado não mexe em pedidos.
  if not public.operational_shift_ok() then
    raise exception 'err_shift_required';
  end if;

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
    -- Avançar/recuar estado é da cozinha/gestão. O empregado não entra aqui — só
    -- pode cancelar (caminho B).
    if (public.is_cozinha() or public.is_admin() or public.is_gerente())
       and pos_from is not null and pos_to is not null and abs(pos_from - pos_to) = 1 then
      return new;
    end if;
    raise exception 'err_order_status_transition_invalid';
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

  raise exception 'err_invalid_operation';
end;
$$;

-- ── payments_validate_insert (fonte: supabase/sql/functions/payments_validate_insert.sql) ──────────
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
    raise exception 'err_payment_session_required';
  end if;

  select * into sess from public.sessions where id = new.session_id;
  if not found or new.table_number <> sess.table_number then
    raise exception 'err_payment_table_mismatch';
  end if;
  if sess.open is not true then
    raise exception 'err_payment_session_closed';
  end if;
  if new.created_by <> auth.uid() then
    raise exception 'err_invalid_operation';
  end if;

  -- Relógio de ponto: empregado/gerente cobram com o PRÓPRIO turno aberto —
  -- liga a receita a quem cobrou. O admin está isento (shift_id null aceite).
  if new.shift_id is null then
    if not public.is_admin() then
      raise exception 'err_payment_shift_required';
    end if;
  else
    select * into payment_shift from public.shifts where id = new.shift_id;
    if not found or payment_shift.status <> 'open' then
      raise exception 'err_payment_shift_invalid_or_closed';
    end if;
    if payment_shift.opened_by <> new.created_by then
      raise exception 'err_payment_shift_owner_mismatch';
    end if;
  end if;

  select count(*)
    into unfinished_count
  from public.orders o
  where o.session_id = new.session_id
    and o.status in ('pending', 'preparing', 'ready')
    and (sess.opened_at is null or o.created_at::timestamptz >= sess.opened_at::timestamptz);

  if unfinished_count > 0 then
    raise exception 'err_payment_pending_orders';
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
    raise exception 'err_payment_nothing_to_pay';
  end if;

  if abs(new.amount - expected_total) > 0.01 then
    raise exception 'err_payment_amount_mismatch';
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

-- ── sessions_validate_update (fonte: supabase/sql/functions/sessions_validate_update.sql) ──────────
create or replace function public.sessions_validate_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  st public.settings;
  staff_fields_only boolean;
  client_code_only boolean;
  trusted_snapshot_reopen boolean :=
    coalesce(current_setting('app.allow_session_snapshot_reopen', true), 'off') = 'on';
  pending_count integer;
begin
  staff_fields_only :=
        new.id is not distinct from old.id
    and new.table_number is not distinct from old.table_number
    and new.created_at is not distinct from old.created_at
    and new.expires_at is not distinct from old.expires_at;

  -- is_floor_staff (não is_staff): a cozinha não gere sessões.
  if public.is_floor_staff() and staff_fields_only and new.open is not null then
    -- D1: sem turno picado não se gere a mesa. O reopen do void_payment (GUC)
    -- corre por conta de um gerente/admin a corrigir um pagamento — passa.
    if not trusted_snapshot_reopen and not public.operational_shift_ok() then
      raise exception 'err_shift_required';
    end if;

    -- D6: fechar a conta exige pedidos arrumados (entregues ou cancelados).
    -- Janela da conta atual = pedidos desde old.opened_at (QR permanente
    -- reutiliza a sessão; pedidos de contas antigas não contam).
    if old.open is true and new.open is false then
      select count(*) into pending_count
      from public.orders o
      where o.session_id = old.id
        and o.status in ('pending', 'preparing', 'ready')
        and (old.opened_at is null or o.created_at::timestamptz >= old.opened_at::timestamptz);
      if pending_count > 0 then
        raise exception 'err_session_pending_orders|%', pending_count;
      end if;
    end if;

    if new.mode is not null or new.entry_price is not null or new.headcount is not null then
      if new.mode is distinct from 'rodizio'
         or new.entry_price is null or new.entry_price <= 0
         or new.headcount is null or new.headcount < 1 then
        raise exception 'err_rodizio_snapshot_invalid';
      end if;

      -- Só valida contra as settings quando o snapshot muda de facto (abrir
      -- conta nova em rodízio). Uma conta já aberta vive do snapshot dela.
      if not trusted_snapshot_reopen
         and (new.mode is distinct from old.mode
              or new.entry_price is distinct from old.entry_price) then
        select * into st from public.settings where id = 'restaurant';
        if not found or st.mode not in ('rodizio', 'mixed') or new.entry_price <> st.entry_price then
          raise exception 'err_rodizio_settings_mismatch';
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

  raise exception 'err_invalid_operation';
end;
$$;

-- ── 2) Triggers de turnos (última definição: 20260702120000_auto_close_stale_shifts.sql) ──
-- Corpos copiados na íntegra; muda só a mensagem das raise exception.
create or replace function public.shifts_validate_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'err_shift_staff_only';
  end if;

  if new.opened_by is null or new.opened_by <> auth.uid() then
    raise exception 'err_invalid_operation';
  end if;

  -- A BD é dona dos timestamps do ponto; não aceitar relógios do browser.
  new.opened_at := public.now_iso();

  -- A marca de auto-fecho só nasce dentro de close_stale_shifts().
  new.auto_closed := false;

  if new.status = 'closed' then
    if new.closed_by is null or new.closed_by <> auth.uid() then
      raise exception 'err_invalid_operation';
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

create or replace function public.shifts_validate_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Caminho de confiança do auto-fecho: aceita só open→closed com a marca, e
  -- NÃO sobrepõe now_iso() — o closed_at determinístico (entrada + limite)
  -- vem calculado pela função. closed_by fica o próprio dono do turno (não há
  -- ninguém a picar; o "quem" verdadeiro é a marca auto_closed).
  if coalesce(current_setting('app.allow_shift_auto_close', true), 'off') = 'on' then
    if old.status <> 'open' or new.status <> 'closed' or new.auto_closed is not true then
      raise exception 'err_invalid_operation';
    end if;
    new.opened_at := old.opened_at;
    new.opened_by := old.opened_by;
    return new;
  end if;

  if not (old.opened_by = auth.uid() or public.is_admin() or public.is_gerente()) then
    raise exception 'err_shift_close_forbidden';
  end if;

  -- Um registo de ponto fechado é imutável (auditoria de horas): nem reabre
  -- nem se retocam os tempos depois do fecho.
  if old.status = 'closed' then
    raise exception 'err_shift_already_closed';
  end if;

  if new.status <> 'closed' then
    raise exception 'err_shift_update_forbidden';
  end if;

  -- A entrada é imutável e quem fecha assume a autoria: num fecho forçado o
  -- closed_by fica o admin/gerente que forçou (auditoria correta). A hora de
  -- saída é sempre da BD. O fecho manual nunca ganha a marca de auto-fecho.
  new.opened_at := old.opened_at;
  new.opened_by := old.opened_by;
  new.auto_closed := old.auto_closed;
  if new.closed_by is null or new.closed_by <> auth.uid() then
    raise exception 'err_invalid_operation';
  end if;
  new.closed_at := public.now_iso();

  return new;
end;
$$;

-- ── 3) Rate-limit (última definição: 20260620120200_rate_limit.sql) ──
create or replace function public.orders_rate_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  max_per_window constant integer := 10;
  window_seconds constant integer := 30;
  recent_count integer;
begin
  if new.session_id is not null and public.is_staff() is not true then
    select count(*) into recent_count
    from public.orders
    where session_id = new.session_id
      and created_at::timestamptz > now() - make_interval(secs => window_seconds);

    if recent_count >= max_per_window then
      raise exception 'err_rate_limited_orders';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.service_calls_rate_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  max_per_window constant integer := 5;
  window_seconds constant integer := 30;
  recent_count integer;
begin
  if new.session_id is not null and public.is_staff() is not true then
    select count(*) into recent_count
    from public.service_calls
    where session_id = new.session_id
      and created_at::timestamptz > now() - make_interval(secs => window_seconds);

    if recent_count >= max_per_window then
      raise exception 'err_rate_limited_service_calls';
    end if;
  end if;

  return new;
end;
$$;

-- ── 4) Guarda de fecho de sessão (última definição: 20260702110000_session_close_and_delete_guards.sql) ──
-- sessions_validate_delete: apagar um QR permanente com a conta ainda aberta é
-- negado (o cliente a meio da refeição perderia o acesso à conta).
create or replace function public.sessions_validate_delete()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.expires_at is null and old.open is true then
    raise exception 'err_session_delete_open_account';
  end if;
  return old;
end;
$$;

-- ── 5) service_calls validate (últimas definições por grep) ──
-- service_calls_validate_insert: última em
-- 20260623110000_fix_expired_session_service_calls_and_delete_resync.sql.
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
    raise exception 'err_service_call_session_required';
  end if;

  select * into sess from public.sessions where id = new.session_id;
  if not found or new.table_number <> sess.table_number then
    raise exception 'err_service_call_table_mismatch';
  end if;
  if sess.open is not true then
    raise exception 'err_service_call_session_closed';
  end if;

  -- Permitir chamadas se sess.expires_at for passado, mas apenas se o tipo for 'waiter'
  if sess.expires_at is not null and sess.expires_at::timestamptz <= now() and new.type <> 'waiter' then
    raise exception 'err_service_call_session_expired';
  end if;

  if public.is_cliente() then
    my_table := public.profile_table_number();
    if my_table is null or sess.table_number <> my_table then
      raise exception 'err_service_call_customer_table_mismatch';
    end if;
  end if;

  if exists (
    select 1
    from public.service_calls c
    where c.session_id = new.session_id
      and c.type = new.type
      and c.status in ('open', 'acknowledged')
  ) then
    raise exception 'err_service_call_duplicate_active';
  end if;

  return new;
end;
$$;

-- service_calls_validate_update: última em
-- 20260702100000_shift_required_for_operations.sql.
create or replace function public.service_calls_validate_update()
returns trigger language plpgsql set search_path = public as $$
declare
  core_fields_unchanged boolean;
begin
  -- D1: staff de sala sem turno picado não atende chamadas.
  if not public.operational_shift_ok() then
    raise exception 'err_shift_required';
  end if;

  core_fields_unchanged :=
        new.id is not distinct from old.id
    and new.table_number is not distinct from old.table_number
    and new.type is not distinct from old.type
    and new.session_id is not distinct from old.session_id
    and new.created_at is not distinct from old.created_at;

  if not core_fields_unchanged then
    raise exception 'err_service_call_only_status_changes';
  end if;

  if old.status = 'resolved' then
    raise exception 'err_service_call_resolved_immutable';
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

  raise exception 'err_service_call_status_transition_invalid';
end;
$$;
