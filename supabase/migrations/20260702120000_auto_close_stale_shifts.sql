-- D7 — Auto-fecho de turnos esquecidos, configurável pelo admin.
-- Quem não pica a saída e vai para casa deixava o turno a contar horas para
-- sempre. Agora o admin define um máximo de horas nas definições do
-- restaurante (vazio = desligado); turnos abertos há mais do que isso fecham
-- sozinhos com uma marca visível "saída não picada — fecho automático" no
-- painel de turnos, e com hora de saída determinística = entrada + limite
-- (não se inventam horas para além do teto).
--
-- Sem cron: a função close_stale_shifts() é chamada de forma oportunística
-- pela app (arranque, antes de picar entrada, ao abrir o painel de turnos).

-- ── 1) Colunas novas ─────────────────────────────────────────────────────────
-- Colunas em tabelas existentes não precisam de grants (só tabelas novas).
alter table public.settings add column if not exists max_shift_hours numeric;
alter table public.shifts add column if not exists auto_closed boolean not null default false;

-- Teto de 24h: um turno não atravessa mais de um dia. Frações são permitidas
-- (o audit usa limites de segundos para testar sem esperar horas).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'settings_max_shift_hours_range') then
    alter table public.settings
      add constraint settings_max_shift_hours_range
      check (max_shift_hours is null or (max_shift_hours > 0 and max_shift_hours <= 24));
  end if;
end $$;

-- ── 2) Picar entrada: a marca de auto-fecho é da BD, não do browser ─────────
-- Corpo copiado na íntegra de 20260701130000; muda apenas o auto_closed.
create or replace function public.shifts_validate_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'shifts: só staff pode picar entrada';
  end if;

  if new.opened_by is null or new.opened_by <> auth.uid() then
    raise exception 'shifts: opened_by tem de ser o utilizador atual';
  end if;

  -- A BD é dona dos timestamps do ponto; não aceitar relógios do browser.
  new.opened_at := public.now_iso();

  -- A marca de auto-fecho só nasce dentro de close_stale_shifts().
  new.auto_closed := false;

  if new.status = 'closed' then
    if new.closed_by is null or new.closed_by <> auth.uid() then
      raise exception 'shifts: closed_by tem de ser o utilizador atual';
    end if;
    new.closed_at := public.now_iso();
  else
    -- Turno aberto nasce sem fecho.
    new.closed_at := null;
    new.closed_by := null;
  end if;

  return new;
end;
$$;

-- ── 3) Picar saída: caminho de confiança para o auto-fecho ──────────────────
-- Corpo copiado na íntegra de 20260701130000; acrescenta-se o caminho do GUC
-- app.allow_shift_auto_close (padrão do app.allow_session_snapshot_reopen —
-- só close_stale_shifts() o liga, um browser não corre SQL arbitrário) e a
-- proteção do auto_closed no fecho manual. NOTA: o GUC lê-se com coalesce —
-- num GUC nunca definido o current_setting devolve NULL e `not NULL` engole
-- o if (bug corrigido em 20260702113000).
create or replace function public.shifts_validate_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Caminho de confiança do auto-fecho: aceita só open→closed com a marca, e
  -- NÃO sobrepõe now_iso() — o closed_at determinístico (entrada + limite)
  -- vem calculado pela função. closed_by fica o próprio dono do turno (não há
  -- ninguém a picar; o "quem" verdadeiro é a marca auto_closed).
  if coalesce(current_setting('app.allow_shift_auto_close', true), 'off') = 'on' then
    if old.status <> 'open' or new.status <> 'closed' or new.auto_closed is not true then
      raise exception 'shifts: auto-fecho inválido';
    end if;
    new.opened_at := old.opened_at;
    new.opened_by := old.opened_by;
    return new;
  end if;

  if not (old.opened_by = auth.uid() or public.is_admin() or public.is_gerente()) then
    raise exception 'shifts: só o próprio ou um responsável pode fechar o turno';
  end if;

  -- Um registo de ponto fechado é imutável (auditoria de horas): nem reabre
  -- nem se retocam os tempos depois do fecho.
  if old.status = 'closed' then
    raise exception 'shifts: turno fechado não se altera';
  end if;

  if new.status <> 'closed' then
    raise exception 'shifts: a única alteração permitida é picar a saída';
  end if;

  -- A entrada é imutável e quem fecha assume a autoria: num fecho forçado o
  -- closed_by fica o admin/gerente que forçou (auditoria correta). A hora de
  -- saída é sempre da BD. O fecho manual nunca ganha a marca de auto-fecho.
  new.opened_at := old.opened_at;
  new.opened_by := old.opened_by;
  new.auto_closed := old.auto_closed;
  if new.closed_by is null or new.closed_by <> auth.uid() then
    raise exception 'shifts: closed_by tem de ser o utilizador atual';
  end if;
  new.closed_at := public.now_iso();

  return new;
end;
$$;

-- ── 4) O varredor: fecha turnos abertos há mais do que o limite ─────────────
-- Oportunístico: qualquer staff autenticado pode disparar (a app chama no
-- arranque, antes de picar entrada e no painel de turnos). security definer
-- porque fecha turnos de OUTROS utilizadores — a RLS normal não deixaria um
-- empregado tocar no turno esquecido de um colega.
create or replace function public.close_stale_shifts()
returns integer language plpgsql security definer set search_path = public as $$
declare
  st public.settings;
  closed_count integer := 0;
begin
  if not public.is_staff() then
    return 0;
  end if;

  select * into st from public.settings where id = 'restaurant';
  if not found or st.max_shift_hours is null or st.max_shift_hours <= 0 then
    return 0;
  end if;

  perform set_config('app.allow_shift_auto_close', 'on', true);
  update public.shifts s
  set status = 'closed',
      auto_closed = true,
      closed_by = s.opened_by,
      -- Hora determinística e mínima: entrada + limite (nunca no futuro — o
      -- where só apanha turnos que já passaram o limite).
      closed_at = to_char(
        timezone('utc', s.opened_at::timestamptz + make_interval(secs => (st.max_shift_hours * 3600)::double precision)),
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
  where s.status = 'open'
    and s.opened_at::timestamptz + make_interval(secs => (st.max_shift_hours * 3600)::double precision) <= now();
  get diagnostics closed_count = row_count;
  perform set_config('app.allow_shift_auto_close', 'off', true);
  return closed_count;
end;
$$;

grant execute on function public.close_stale_shifts() to authenticated;
