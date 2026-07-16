-- Imagens dos itens do menu (Supabase Storage).
--
-- Porquê: um menu com fotos é mais útil para o cliente. As imagens vivem no
-- Storage do Supabase (não na BD); o item só guarda a URL pública.
--
-- Modelo: bucket PÚBLICO (o menu é leitura pública, tal como menu_items), mas a
-- ESCRITA fica limitada a staff pela RLS do storage — espelha as políticas de
-- menu_items (escrita só admin/gerente, via is_staff()).

-- 1) Coluna opcional com a URL pública da imagem.
alter table public.menu_items add column if not exists image text;

-- 2) Bucket público para as imagens do menu.
insert into storage.buckets (id, name, public)
values ('menu-images', 'menu-images', true)
on conflict (id) do nothing;

-- 3) Políticas de storage para o bucket menu-images.
--    Leitura pública (o cliente vê o menu); escrita/alteração/remoção só staff.
create policy "menu-images public read" on storage.objects
  for select using (bucket_id = 'menu-images');

create policy "menu-images staff insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'menu-images' and public.is_staff());

create policy "menu-images staff update" on storage.objects
  for update to authenticated
  using (bucket_id = 'menu-images' and public.is_staff());

create policy "menu-images staff delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'menu-images' and public.is_staff());
