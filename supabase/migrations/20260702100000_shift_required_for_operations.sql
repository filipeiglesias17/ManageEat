-- Turno obrigatório para operar: o empregado conseguia abrir uma mesa sem picar
-- entrada). Quem trabalha a sala (empregado/gerente) só pode criar sessões,
-- fazer/cancelar pedidos, mexer em chamadas e cobrar com o SEU turno aberto.
-- O admin (dono) fica isento  incluindo cobrar sem turno. A cozinha fica
-- isenta (é uma conta partilhada que vive aberta nos ecrãs da cozinha, não uma
-- pessoa). Cliente/anónimo nunca têm turno e não são afetados.
--
-- A UI também bloqueia (aviso + botões desativados), mas a regra a sério vive
-- aqui: RLS + triggers são a fronteira de segurança real do projeto.
--
-- Nota: sessions_validate_update (abrir/fechar mesa, headcount) ganha a mesma
-- guarda na migração seguinte (20260702110000), que redefine essa função uma
-- única vez com esta regra + a guarda de pedidos por entregar.

--  1) Helpers
-- security definer: os triggers correm com o auth.uid() de quem escreve, e um
-- anónimo/cliente não pode ler shifts pela RLS  o helper lê por cima dela
-- (padrão do profile_role). O índice parcial shifts_single_open_idx
-- (opened_by where status='open') torna este exists barato.
create or replace function public.has_open_shift(p_uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.shifts
    where opened_by = p_uid and status = 'open'
  )
$$;

-- Regra num único sítio: empregado e gerente precisam de turno aberto; todos
-- os outros (admin, cozinha, cliente, anónimo) passam. O curto-circuito do
-- case evita sequer consultar shifts para quem está isento.
create or replace function public.operational_shift_ok()
returns boolean language sql stable set search_path = '' as $$
  select case
    when public.is_empregado() or public.is_gerente()
      then public.has_open_shift(auth.uid())
    else true
  end
$$;

--  2) sessions: criar sessão/mesa exige turno
-- Corpo copiado na íntegra de 20260626120000 (account_safety_guards); muda
-- apenas a guarda no topo, antes dos efeitos laterais (resolução automática de chamadas
-- e auto-close de expiradas), para um insert negado não deixar rasto.
create or replace function public.sessions_validate_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  st public.settings;
begin
  -- Empregado ou gerente sem turno aberto não cria uma mesa.
  if not public.operational_shift_ok() then
    raise exception 'sessions: pica a entrada para começar a operar';
  end if;

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

--  3) orders: enviar pedido exige turno
-- Corpo copiado na íntegra de 20260623100000 (rodizio_entry_account_window);
-- muda apenas a guarda, logo a seguir aos campos controlados pelo servidor. Cliente e
-- anónimo (QR) passam pelo helper sem tocar em shifts.
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

  -- Staff de sala sem turno aberto não envia pedidos.
  if not public.operational_shift_ok() then
    raise exception 'orders: pica a entrada para começar a operar';
  end if;

  if (new.discount_type is not null or new.discount_value is not null)
     and not public.is_staff() then
    raise exception 'orders: desconto só pode ser aplicado por staff';
  end if;

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
      raise exception 'orders: snapshot de rodízio inválido';
    end if;
    if sess.mode is distinct from 'rodizio' then
      raise exception 'orders: snapshot de rodízio não corresponde à sessão';
    end if;

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

  if public.is_cliente() then
    my_table := public.profile_table_number();
    if my_table is null then
      raise exception 'orders: conta cliente sem mesa associada';
    end if;
    if sess.table_number <> my_table then
      raise exception 'orders: cliente só pode pedir para a mesa % do seu perfil', my_table;
    end if;
  end if;

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

--  4) orders: mudar estado / cancelar exige turno
-- Corpo copiado na íntegra de 20260626130000 (orders_empregado_cancel); muda
-- apenas a guarda, depois do caminho C; o resync de confiança da entrada é
-- disparado pelo servidor (set_session_headcount / cancelamento) e não pode
-- ficar preso ao turno de quem o desencadeou. Cobre o caminho A do gerente
-- (transição de estado; cozinha e admin isentos no helper) e o caminho B de
-- cancelamento (empregado/gerente).
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
    raise exception 'orders: resync de entrada inválido';
  end if;

  -- Staff de sala sem turno aberto não altera pedidos.
  if not public.operational_shift_ok() then
    raise exception 'orders: pica a entrada para começar a operar';
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
    -- Avançar/recuar estado é da cozinha/gestão. O empregado não entra aqui  só
    -- pode cancelar (caminho B).
    if (public.is_cozinha() or public.is_admin() or public.is_gerente())
       and pos_from is not null and pos_to is not null and abs(pos_from - pos_to) = 1 then
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

--  5) service_calls: assumir/resolver chamadas exige turno
-- Corpo copiado de 20260620120100 (rls.sql); muda apenas a guarda de turno
-- no topo. O auto-resolve interno de sessions_validate_insert também dispara
-- este trigger, mas quem lá chega está isento ou já passou a guarda do
-- INSERT de sessões  nunca fica preso.
create or replace function public.service_calls_validate_update()
returns trigger language plpgsql set search_path = public as $$
declare
  core_fields_unchanged boolean;
begin
  -- Staff de sala sem turno aberto não atende chamadas.
  if not public.operational_shift_ok() then
    raise exception 'service_calls: pica a entrada para começar a operar';
  end if;

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

--  6) payments: o admin (dono) cobra sem turno
-- Corpo copiado na íntegra de 20260701130000 (shifts_per_employee_timeclock);
-- muda apenas o bloco do shift_id: passa a aceitar shift_id null SE quem cobra
-- for admin (o pagamento fica registado em nome dele, sem turno associado).
-- Um shift_id enviado  por qualquer role  valida-se sempre: tem de estar
-- aberto e ser do próprio.
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

  -- Relógio de ponto: empregado/gerente cobram com o PRÓPRIO turno aberto
  -- liga a receita a quem cobrou. O admin está isento (shift_id null aceite).
  if new.shift_id is null then
    if not public.is_admin() then
      raise exception 'payments: é preciso estar em turno para fechar contas';
    end if;
  else
    select * into payment_shift from public.shifts where id = new.shift_id;
    if not found or payment_shift.status <> 'open' then
      raise exception 'payments: turno inválido ou fechado';
    end if;
    if payment_shift.opened_by <> new.created_by then
      raise exception 'payments: o turno tem de ser do próprio utilizador';
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
