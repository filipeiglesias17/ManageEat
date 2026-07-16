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
