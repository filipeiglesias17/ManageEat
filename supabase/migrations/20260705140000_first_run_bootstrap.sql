-- Primeira instalação: criar o primeiro administrador de um restaurante novo.
--
-- Problema (ovo-e-galinha): a RLS de profiles (profiles_insert) só deixa um
-- admin/gerente criar contas — logo o PRIMEIRO admin nunca poderia ser inserido
-- pela via normal (não há admin ainda para autorizar). Estas duas RPC resolvem
-- isso: uma diz se o sistema ainda não tem admin; a outra promove o utilizador
-- atual a admin, MAS só enquanto não existir nenhum. Depois do primeiro admin,
-- este caminho fecha-se para sempre (a guarda recusa).
--
-- A conta de autenticação (auth.users) NÃO é criada aqui — é criada pelo browser
-- com supabase.auth.signUp() (o mesmo caminho de adminCreateUser). Só a promoção
-- do profile a admin passa por esta função security definer. Assim não mexemos
-- em auth.users/auth.identities por SQL (o GoTrue continua dono do Auth).

-- Existe algum admin no sistema? Boolean sem dados sensíveis, por isso pode ser
-- chamado por 'anon' (o browser ainda não tem sessão no primeiro arranque).
-- security definer porque anon não tem SELECT em profiles (profiles_select exige
-- auth.uid()). Ignora `active` de propósito — ver a guarda em baixo.
create or replace function public.system_needs_setup()
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.profiles where role = 'admin')
$$;

grant execute on function public.system_needs_setup() to anon, authenticated;

-- Promove o utilizador ATUAL (auth.uid()) a admin, mas só se ainda não existir
-- NENHUM admin. security definer para poder inserir em profiles sem a RLS normal
-- (que exigiria um admin já existente para autorizar) — a guarda interna faz o
-- papel da RLS aqui. Devolve {ok, reason} (como claim_session_with_code) para o
-- audit testar com okClaim/denyClaim e para o frontend distinguir "já existe".
create or replace function public.bootstrap_first_admin(p_username text)
returns table (ok boolean, reason text)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_username text := trim(p_username);
begin
  -- Tem de estar autenticado (fez signUp primeiro). anon nem chega aqui (sem GRANT).
  if v_uid is null then
    return query select false, 'login_necessario';
    return;
  end if;

  -- Serializa dois setups em paralelo (duas instalações ao mesmo tempo): o
  -- segundo bloqueia até o primeiro fazer commit e depois vê o admin já criado.
  -- Sem isto, os dois passavam a verificação "não há admin" e criavam dois admins.
  perform pg_advisory_xact_lock(hashtext('manage-eat:bootstrap-first-admin'));

  -- Guarda anti-abuso e anti-corrida: se JÁ existe qualquer admin, recusa
  -- sempre. Ignora `active` de propósito — desativar o único admin não deve
  -- reabrir este caminho (a recuperação de acesso faz-se por script no servidor,
  -- não por um wizard aberto a quem quer que consiga desativar o admin).
  if exists (select 1 from public.profiles where role = 'admin') then
    return query select false, 'ja_existe_admin';
    return;
  end if;

  if v_username is null or length(v_username) < 3 then
    return query select false, 'username_invalido';
    return;
  end if;

  -- Um uid tem no máximo um profile (PK = id). Se já tiver, não reescrevemos.
  if exists (select 1 from public.profiles where id = v_uid) then
    return query select false, 'profile_ja_existe';
    return;
  end if;

  insert into public.profiles (id, username, role, active, created_at)
  values (v_uid, v_username, 'admin', true, public.now_iso());

  return query select true, null::text;
end;
$$;

grant execute on function public.bootstrap_first_admin(text) to authenticated;
