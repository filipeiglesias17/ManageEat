-- Correção de um bug subtil de SQL apanhado pelo audit do D1: um GUC nunca
-- definido na ligação faz current_setting(..., true) devolver NULL, e
-- `NULL = 'on'` dá NULL (não false). Como o valor era usado NEGADO
-- (`if not trusted_snapshot_reopen`), o `if` avaliava NULL e NÃO entrava —
-- ou seja, dependendo da ligação do pool do PostgREST:
--   (a) o check D1 novo (turno para gerir a mesa) era saltado;
--   (b) o check ANTIGO "rodízio corresponde às settings" também era saltado
--       (bypass latente que já existia antes do D1 — ninguém o viu porque só
--       falha em ligações onde o GUC nunca foi tocado).
-- Fix: coalesce(current_setting(...), 'off').
--
-- Aproveita-se para corrigir o alcance do check das settings: ele só faz
-- sentido quando o staff INTRODUZ/MUDA o snapshot (mode/entry_price), não
-- quando só mexe no headcount de uma conta já aberta. Senão, mudar o preço de
-- entrada nas settings a meio do serviço impedia editar o nº de pessoas das
-- contas antigas — que devem viver do snapshot delas (decisão D2).
--
-- Corpo copiado na íntegra de 20260702110000; mudam só estes dois pontos.
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
      raise exception 'sessions: pica a entrada para começar a operar';
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
        raise exception 'sessions: % pedido(s) por entregar nesta conta — entrega ou cancela antes de fechar', pending_count;
      end if;
    end if;

    if new.mode is not null or new.entry_price is not null or new.headcount is not null then
      if new.mode is distinct from 'rodizio'
         or new.entry_price is null or new.entry_price <= 0
         or new.headcount is null or new.headcount < 1 then
        raise exception 'sessions: snapshot de rodízio inválido';
      end if;

      -- Só valida contra as settings quando o snapshot muda de facto (abrir
      -- conta nova em rodízio). Uma conta já aberta vive do snapshot dela.
      if not trusted_snapshot_reopen
         and (new.mode is distinct from old.mode
              or new.entry_price is distinct from old.entry_price) then
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
