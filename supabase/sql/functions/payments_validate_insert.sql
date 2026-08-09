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

  -- Empregado e gerente cobram com o próprio turno aberto;
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
