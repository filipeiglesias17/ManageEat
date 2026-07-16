-- Allow 'waiter' type service calls even on expired sessions
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
  
  -- Permitir chamadas se sess.expires_at for passado, mas apenas se o tipo for 'waiter'
  if sess.expires_at is not null and sess.expires_at::timestamptz <= now() and new.type <> 'waiter' then
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

-- Handle rodízio resync on physical delete
create or replace function public.orders_resync_entry_on_cancel()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sess public.sessions;
  target_id text;
  should_resync boolean := false;
  v_session_id text;
begin
  if TG_OP = 'UPDATE' then
    if new.status = 'cancelled'
       and old.status is distinct from 'cancelled'
       and old.entry_price is not null then
      should_resync := true;
      v_session_id := old.session_id;
    end if;
  elsif TG_OP = 'DELETE' then
    if old.entry_price is not null then
      should_resync := true;
      v_session_id := old.session_id;
    end if;
  end if;

  if should_resync then
    select * into sess from public.sessions where id = v_session_id;
    if found and sess.open is true and sess.mode = 'rodizio' then
      select id into target_id
      from public.orders
      where session_id = v_session_id
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

  if TG_OP = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$$;

-- Recriar trigger para correr em UPDATE e DELETE
drop trigger if exists orders_resync_entry_on_cancel_trg on public.orders;

create trigger orders_resync_entry_on_cancel_trg
  after update or delete on public.orders
  for each row execute function public.orders_resync_entry_on_cancel();
