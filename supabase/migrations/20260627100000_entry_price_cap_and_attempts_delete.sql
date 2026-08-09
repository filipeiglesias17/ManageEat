-- Auditoria 2026-06-27, P1 (quick wins):
-- 1) Lockout QR: a policy de DELETE das tentativas permitia ao próprio
--    utilizador (anónimo incluído) apagar a sua linha e limpar o contador de 5
--    tentativas (rls-definer-privesc-0). A limpeza legítima é feita pelos RPC
--    SECURITY DEFINER (claim/reset) e pelo cascade ao fechar a sessão, por isso
--    restringimos a policy a staff. É defesa, não funcionalidade: nada de bom
--    depende de o anónimo apagar as próprias tentativas.
-- 2) Teto da entrada de rodízio: entry_price só tinha piso (>= 0). Um valor
--    absurdo por engano nas settings inflava a conta e os relatórios
--    (money-account-1). Pomos um teto razoável (999 €/pessoa) na fonte (settings)
--    e na sessão  espelha o teto 1..99 já existente no headcount.

--  1. DELETE de session_code_attempts: só staff
drop policy if exists session_code_attempts_delete on public.session_code_attempts;
create policy session_code_attempts_delete on public.session_code_attempts for delete
  using (public.is_staff());

--  2. Teto do entry_price (defesa na própria tabela)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'settings_entry_price_max') then
    alter table public.settings
      add constraint settings_entry_price_max check (entry_price <= 999);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'sessions_entry_price_range') then
    alter table public.sessions
      add constraint sessions_entry_price_range
      check (entry_price is null or (entry_price >= 0 and entry_price <= 999));
  end if;
end $$;
