-- Guardas de sessões (continuação do D1 + duas regras novas de integridade):
--
-- 1) D1 em sessions UPDATE: abrir/fechar mesa, headcount e reset de código
--    passam a exigir turno aberto (empregado/gerente; admin e cozinha isentos,
--    cliente intocado). O reopen de confiança do void_payment fica de fora —
--    anular um pagamento é correção de gestão, não operação de sala.
-- 2) D6: fechar uma mesa com pedidos por entregar (pending/preparing/ready na
--    conta atual) é negado — espelha a regra que já existe ao cobrar. Senão a
--    cozinha ficava a preparar comida de uma conta que já ninguém vai pagar.
--    Vale para TODOS, incluindo admin: é integridade da conta, não turno.
-- 3) D3: apagar um QR permanente (expires_at null) com a conta aberta é negado
--    — o cliente a meio da refeição perderia o acesso à conta. Fecha-se a
--    conta primeiro.

-- ── 1+2) sessions_validate_update ────────────────────────────────────────────
-- Corpo copiado na íntegra de 20260627120000 (sessions_cozinha_floor_staff);
-- mudam apenas os blocos D1 e D6 no ramo staff. O caminho do CLIENTE (definir
-- o código 1x) fica intacto.
create or replace function public.sessions_validate_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  st public.settings;
  staff_fields_only boolean;
  client_code_only boolean;
  trusted_snapshot_reopen boolean := current_setting('app.allow_session_snapshot_reopen', true) = 'on';
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

-- ── 3) D3: DELETE de QR permanente com conta aberta é negado ─────────────────
-- Não existia nenhum trigger de DELETE em sessions. Sessões temporárias
-- (expires_at preenchido) continuam a poder ser apagadas mesmo abertas — a
-- limpeza de expiradas depende disso.
create or replace function public.sessions_validate_delete()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.expires_at is null and old.open is true then
    raise exception 'sessions: QR permanente com conta aberta — fecha a conta antes de apagar';
  end if;
  return old;
end;
$$;

drop trigger if exists sessions_validate_delete_trg on public.sessions;
create trigger sessions_validate_delete_trg
  before delete on public.sessions
  for each row execute function public.sessions_validate_delete();
