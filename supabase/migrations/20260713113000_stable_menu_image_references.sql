-- URLs absolutos do Storage ficam obsoletos quando o IP do restaurante muda.
-- Guardamos apenas o caminho público; cada cliente junta o servidor atual ao
-- renderizar. Assets externos e caminhos que não são do Storage ficam intactos.
update public.menu_items
set image = regexp_replace(image, '^https?://[^/]+', '')
where image ~ '^https?://[^/]+/storage/v1/object/public/menu-images/';

