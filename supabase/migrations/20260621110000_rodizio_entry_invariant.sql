-- Invariante da entrada de rodízio.
--
-- A entrada (entry_price + headcount) é denormalizada num único pedido ativo da
-- sessão (Conceito 54) para os relatórios (stats.ts) e o SAF-T poderem ler a
-- receita de entrada a partir dos pedidos, sem deduplicar sessões em memória.
-- Mas a CONTA (account.ts) e o trigger de PAGAMENTO leem a entrada da SESSÃO.
-- Se o snapshot do pedido divergir da sessão, os relatórios ficam abaixo do que
-- foi cobrado. Dois caminhos partiam a invariante:
--   1) editar o headcount a meio do serviço deixava o pedido com o valor antigo;
--   2) cancelar o pedido portador perdia a entrada (nenhum outro a reassumia).
--
-- Solução: manter o pedido portador sempre verdadeiro com escritas server-side
-- de confiança, sinalizadas por um flag transação-local. Espelha o padrão já
-- usado em void_payment + app.allow_session_snapshot_reopen.

-- ── 1) orders_validate_update: caminho de confiança para o resync ────────────
-- Acrescenta, no topo, um ramo que só corre quando o servidor liga o flag
-- app.allow_entry_resync. Aí permite mexer apenas em entry_price/headcount
-- (tudo o resto fica igual). Os caminhos A (status) e B (cancelamento) ficam
-- inalterados. O browser nunca consegue ligar este flag (PostgREST não expõe
-- set_config), por isso continua a não poder forjar a entrada.
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
    if pos_from is not null and pos_to is not null and abs(pos_from - pos_to) = 1 then
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

-- ── 2) Reatribuir a entrada quando o pedido portador é cancelado ─────────────
-- AFTER UPDATE: se o pedido que carregava a entrada passa a 'cancelled', move a
-- entrada para o pedido ativo mais antigo que ainda não a carrega. Se não houver
-- nenhum, não faz nada (a próxima inserção auto-cura via has_active_order no
-- orders_validate_insert). As updates internas não voltam a disparar este ramo
-- (não há nova transição para 'cancelled'), por isso a recursão é limitada.
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

drop trigger if exists orders_resync_entry_on_cancel_trg on public.orders;
create trigger orders_resync_entry_on_cancel_trg
  after update on public.orders
  for each row execute function public.orders_resync_entry_on_cancel();

-- ── 3) Editar o headcount a meio do serviço (propagando ao pedido portador) ──
-- Substitui o UPDATE direto que o db.ts fazia. Faz as duas escritas numa só
-- transação: a sessão (fonte de verdade para conta/pagamento) e o pedido
-- portador (fonte de verdade para relatórios/SAF-T), mantendo-os iguais.
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

  -- Mantém o snapshot do pedido portador igual à sessão (invariante de relatórios).
  perform set_config('app.allow_entry_resync', 'on', true);
  update public.orders
    set headcount = p_headcount
    where session_id = p_session_id
      and entry_price is not null
      and status <> 'cancelled';
  perform set_config('app.allow_entry_resync', 'off', true);
end;
$$;

grant execute on function public.set_session_headcount(text, integer) to authenticated;
