-- Admin redefine a password de outro utilizador.
--
-- Porquê um RPC SECURITY DEFINER (e não a Admin API do Supabase): mudar a
-- password de OUTRA conta exige a service_role, que NUNCA pode ir para o
-- browser (ignora toda a RLS). Como esta app fala direto com o Supabase, sem
-- servidor de app, seguimos o padrão da casa — a operação privilegiada vive
-- numa função no Postgres, que verifica ela própria quem a chama.
--
-- A função corre como o dono (postgres, superuser no on-premise), por isso pode
-- escrever em auth.users. Grava o hash bcrypt diretamente (extensions.crypt +
-- gen_salt('bf')), no mesmo formato $2a$ que o GoTrue usa e verifica no login.
--
-- Autorização: só o admin (is_admin()); nunca redefine a password de outro
-- admin por aqui (evita golpe admin-contra-admin) — o admin muda a sua própria
-- pelo ecrã "A minha conta". Mínimo de 12 caracteres, igual à criação de contas.

create or replace function public.admin_set_user_password(p_user_id uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.profiles;
begin
  if not public.is_admin() then
    raise exception 'err_user_password_admin_only';
  end if;

  if p_password is null or length(p_password) < 12 then
    raise exception 'err_user_password_too_short';
  end if;

  select * into v_target from public.profiles where id = p_user_id;
  if not found then
    raise exception 'err_user_not_found';
  end if;

  -- Não redefinir a password de um admin por esta via.
  if v_target.role = 'admin' then
    raise exception 'err_user_password_admin_target';
  end if;

  update auth.users
    set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
        updated_at = now()
    where id = p_user_id;

  -- Defesa em profundidade: o profile existe mas a conta Auth não? (não devia
  -- acontecer — profiles.id = auth.users.id). Recusa em vez de fingir sucesso.
  if not found then
    raise exception 'err_user_not_found';
  end if;
end;
$$;

-- anon nunca; só contas autenticadas (o is_admin() lá dentro faz o resto).
revoke all on function public.admin_set_user_password(uuid, text) from public, anon;
grant execute on function public.admin_set_user_password(uuid, text) to authenticated;
