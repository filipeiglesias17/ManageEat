-- Redefine sessions_validate_insert to auto-close expired sessions of the same table
create or replace function public.sessions_validate_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  st public.settings;
begin
  -- 1. Resolver chamadas de serviço ativas das sessões expiradas desta mesa
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

  -- 2. Auto-close de sessões expiradas para a mesma mesa
  update public.sessions
  set open = false,
      access_code_hash = null,
      opened_at = null,
      mode = null,
      entry_price = null,
      headcount = null
  where table_number = new.table_number
    and open is true
    and expires_at is not null
    and expires_at::timestamptz <= now();

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
