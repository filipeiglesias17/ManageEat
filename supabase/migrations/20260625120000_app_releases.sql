-- Atualizações OTA (over-the-air) da app móvel.
--
-- Porquê: cada restaurante corre o seu próprio Supabase local. Para os
-- telemóveis receberem novas versões do CÓDIGO da app sem App Store e sem
-- recompilar, publicamos o bundle web (.zip do dist/) no Storage do restaurante
-- e apontamos a "versão atual" numa tabela. Os telemóveis (Capacitor + plugin
-- @capgo/capacitor-updater) descarregam o zip da LAN e aplicam-no.
--
-- Modelo: leitura PÚBLICA (qualquer dispositivo precisa de saber a versão e de
-- descarregar o bundle); ESCRITA só admin (via is_admin()) — no browser é o
-- admin; nos scripts de terminal é a service_role (ignora a RLS).

-- 1) Tabela singleton com a versão publicada (só uma linha: id = 'current').
create table public.app_release (
  id           text primary key default 'current',
  version      text not null,
  object_path  text not null,                 -- caminho do .zip no bucket app-bundles
  checksum     text,                          -- sha256 do zip (registo/integridade)
  notes        text,
  published_at timestamptz not null default now(),
  constraint app_release_singleton check (id = 'current')
);

alter table public.app_release enable row level security;

-- Leitura pública; escrita só admin (espelha as políticas de settings).
create policy app_release_select on public.app_release for select using (true);
create policy app_release_insert on public.app_release for insert
  with check (public.is_admin());
create policy app_release_update on public.app_release for update
  using (public.is_admin()) with check (public.is_admin());
create policy app_release_delete on public.app_release for delete
  using (public.is_admin());

-- Privilégios de tabela (a RLS faz o gating real). O grant global em rls.sql só
-- abrange as tabelas que existiam então; tabelas novas precisam do grant próprio.
grant select, insert, update, delete on public.app_release to anon, authenticated, service_role;

-- Realtime: ao publicar uma nova versão, os telemóveis são avisados na hora.
alter table public.app_release replica identity full;
alter publication supabase_realtime add table public.app_release;

-- 2) Bucket público para os bundles (.zip). Leitura pública; escrita só admin
--    (espelha o bucket menu-images, mas restrito a admin em vez de staff).
insert into storage.buckets (id, name, public)
values ('app-bundles', 'app-bundles', true)
on conflict (id) do nothing;

create policy "app-bundles public read" on storage.objects
  for select using (bucket_id = 'app-bundles');

create policy "app-bundles admin insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'app-bundles' and public.is_admin());

create policy "app-bundles admin update" on storage.objects
  for update to authenticated
  using (bucket_id = 'app-bundles' and public.is_admin());

create policy "app-bundles admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'app-bundles' and public.is_admin());
