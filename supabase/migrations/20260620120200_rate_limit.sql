-- Rate-limit nos writes de sessões QR anónimas (SECURITY_REPORT.md finding #8).
--
-- Porquê: um cliente QR (autenticado como anónimo) já passa pelas validações dos
-- triggers orders_validate_insert / service_calls_validate_insert, mas nada o
-- impede de inundar a mesa com pedidos/chamadas a partir das DevTools. Estes dois
-- triggers extra contam quantos writes recentes existem na MESMA sessão numa janela
-- curta e bloqueiam rajadas.
--
-- Decisões:
--  - Só afeta utilizadores não-staff com `session_id` (QR anónimo e cliente
--    fixo). Staff operacional fica isento — lança muitos pedidos legítimos.
--  - Conta por sessão (a mesa toda) numa janela curta. É um travão anti-rajada, não
--    um limite por pessoa: uma mesa real nunca faz 10 pedidos em 30 segundos, mas um
--    script via DevTools faria centenas.
--  - Triggers SEPARADOS, não mexem nas funções de validação — risco baixo e leitura
--    simples. Só lêem linhas já existentes, por isso a ordem entre triggers é
--    indiferente para a contagem.

-- Pedidos: máx. 10 por sessão em 30 segundos.
create or replace function public.orders_rate_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  max_per_window constant integer := 10;
  window_seconds constant integer := 30;
  recent_count integer;
begin
  if new.session_id is not null and public.is_staff() is not true then
    select count(*) into recent_count
    from public.orders
    where session_id = new.session_id
      and created_at::timestamptz > now() - make_interval(secs => window_seconds);

    if recent_count >= max_per_window then
      raise exception 'orders: demasiados pedidos seguidos nesta mesa; aguarda um momento';
    end if;
  end if;

  return new;
end;
$$;

create trigger orders_rate_limit_trg
  before insert on public.orders
  for each row execute function public.orders_rate_limit();

-- Chamadas de serviço: máx. 5 por sessão em 30 segundos.
create or replace function public.service_calls_rate_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  max_per_window constant integer := 5;
  window_seconds constant integer := 30;
  recent_count integer;
begin
  if new.session_id is not null and public.is_staff() is not true then
    select count(*) into recent_count
    from public.service_calls
    where session_id = new.session_id
      and created_at::timestamptz > now() - make_interval(secs => window_seconds);

    if recent_count >= max_per_window then
      raise exception 'service_calls: demasiadas chamadas seguidas; aguarda um momento';
    end if;
  end if;

  return new;
end;
$$;

create trigger service_calls_rate_limit_trg
  before insert on public.service_calls
  for each row execute function public.service_calls_rate_limit();
