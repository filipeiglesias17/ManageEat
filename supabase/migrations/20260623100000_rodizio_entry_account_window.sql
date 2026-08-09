-- Em QR permanente, o mesmo session_id é reutilizado em várias contas. A
-- entrada do rodízio e o headcount têm de pertencer à janela aberta atual
-- (opened_at), não a qualquer pedido antigo da mesma sessão.

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

create or replace function public.orders_resync_entry_on_cancel()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sess public.sessions;
  target_id text;
begin
  if new.status = 'cancelled'
     and old.status is distinct from 'cancelled'
     and old.entry_price is not null then
    select * into sess from public.sessions where id = new.session_id;
    if found and sess.open is true and sess.mode = 'rodizio' then
      select id into target_id
      from public.orders
      where session_id = new.session_id
        and status <> 'cancelled'
        and entry_price is null
        and (
          sess.opened_at is null
          or created_at::timestamptz >= sess.opened_at::timestamptz
        )
      order by created_at asc
      limit 1;

      if target_id is not null then
        perform set_config('app.allow_entry_resync', 'on', true);
        update public.orders
          set entry_price = sess.entry_price, headcount = sess.headcount
          where id = target_id;
        perform set_config('app.allow_entry_resync', 'off', true);
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.set_session_headcount(
  p_session_id text,
  p_headcount integer
)
returns void language plpgsql security definer set search_path = public as $$
declare
  sess public.sessions;
begin
  if not public.is_floor_staff() then
    raise exception 'sessions: só staff de sala pode alterar o headcount';
  end if;
  if p_headcount is null or p_headcount < 1 or p_headcount > 99 then
    raise exception 'sessions: headcount tem de estar entre 1 e 99';
  end if;

  select * into sess from public.sessions where id = p_session_id;
  if not found then
    raise exception 'sessions: sessão inexistente';
  end if;
  if sess.open is not true or sess.mode is distinct from 'rodizio' then
    raise exception 'sessions: headcount só se edita em sessão rodízio aberta';
  end if;

  update public.sessions set headcount = p_headcount where id = p_session_id;

  perform set_config('app.allow_entry_resync', 'on', true);
  update public.orders
    set headcount = p_headcount
    where session_id = p_session_id
      and entry_price is not null
      and status <> 'cancelled'
      and (
        sess.opened_at is null
        or created_at::timestamptz >= sess.opened_at::timestamptz
      );
  perform set_config('app.allow_entry_resync', 'off', true);
end;
$$;

grant execute on function public.set_session_headcount(text, integer) to authenticated;
