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
