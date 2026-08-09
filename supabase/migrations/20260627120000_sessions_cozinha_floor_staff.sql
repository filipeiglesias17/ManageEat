-- Cozinha é read-only na sala: vê os pedidos (kanban) e muda o estado de orders,
-- mas NÃO gere mesas/sessões. Até aqui, sessions_update e o caminho staff do
-- trigger sessions_validate_update usavam is_staff() (que inclui cozinha), o que
-- deixava a cozinha fechar/reabrir mesas, anular o access_code_hash (expulsando os
-- telemóveis da mesa) e reescrever o snapshot de rodízio. Alinhamos com
-- sessions_delete (rls.sql) e set_session_headcount, que já usam is_floor_staff()
-- (admin + gerente + empregado). O caminho do CLIENTE (definir o código 1x via RPC)
-- fica intacto, tal como o reopen confiável do void_payment (corre como gerente/admin).

drop policy if exists sessions_update on public.sessions;
create policy sessions_update on public.sessions for update
  using (public.is_floor_staff())
  with check (public.is_floor_staff());

create or replace function public.sessions_validate_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  st public.settings;
  staff_fields_only boolean;
  client_code_only boolean;
  trusted_snapshot_reopen boolean := current_setting('app.allow_session_snapshot_reopen', true) = 'on';
begin
  staff_fields_only :=
        new.id is not distinct from old.id
    and new.table_number is not distinct from old.table_number
    and new.created_at is not distinct from old.created_at
    and new.expires_at is not distinct from old.expires_at;

  -- is_floor_staff (não is_staff): a cozinha não gere sessões.
  if public.is_floor_staff() and staff_fields_only and new.open is not null then
    if new.mode is not null or new.entry_price is not null or new.headcount is not null then
      if new.mode is distinct from 'rodizio'
         or new.entry_price is null or new.entry_price <= 0
         or new.headcount is null or new.headcount < 1 then
        raise exception 'sessions: snapshot de rodízio inválido';
      end if;

      if not trusted_snapshot_reopen then
        select * into st from public.settings where id = 'restaurant';
        if not found or st.mode not in ('rodizio', 'mixed') or new.entry_price <> st.entry_price then
          raise exception 'sessions: rodízio não corresponde às settings';
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

  raise exception 'sessions: update não permitido';
end;
$$;
