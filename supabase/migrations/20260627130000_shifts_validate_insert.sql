-- shifts só tinha trigger de UPDATE (shifts_validate_update): o closed_by =
-- auth.uid() e os timestamps server-side só corriam no fecho por UPDATE. Logo um
-- admin/gerente podia INSERIR um turno com opened_by/closed_by de OUTRO utilizador
-- e opened_at/closed_at arbitrários (backdating), falseando a auditoria de caixa
-- (quem abriu/fechou e quando). Este trigger fecha o caminho do INSERT.
--
-- Âmbito: validamos AUTORIA (opened_by/closed_by = auth.uid()) e POSSE dos
-- timestamps pela BD (now_iso). O guard de "não fechar a caixa com mesas abertas"
-- continua APENAS no UPDATE (a transição open→closed em shifts_validate_update),
-- que é onde um turno ATIVO é encerrado; um INSERT já 'closed' é um registo novo,
-- sem turno ativo a encerrar, e não pode levar pagamentos (payments exige turno
-- 'open'). Assim não partimos a criação legítima de turnos de teste/históricos.

create or replace function public.shifts_validate_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_gerente()) then
    raise exception 'shifts: só admin/gerente podem abrir turnos';
  end if;

  -- Quem abre o turno é o próprio utilizador (auditoria de caixa), tal como
  -- payments força created_by = auth.uid().
  if new.opened_by is null or new.opened_by <> auth.uid() then
    raise exception 'shifts: opened_by tem de ser o utilizador atual';
  end if;

  -- A BD é dona dos timestamps operacionais; não aceitar texto do browser.
  new.opened_at := public.now_iso();

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

drop trigger if exists shifts_validate_insert_trg on public.shifts;
create trigger shifts_validate_insert_trg
  before insert on public.shifts
  for each row execute function public.shifts_validate_insert();
