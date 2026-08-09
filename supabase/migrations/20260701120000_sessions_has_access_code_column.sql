-- getSessions (leitura de sessões para o staff) passou a pedir colunas explícitas
-- para NÃO enviar o access_code_hash ao browser (o hash de um código de 6 dígitos
-- é praticamente reversível). Só que a lista incluía `has_access_code` — uma
-- coluna que nunca foi criada na tabela: existia apenas como campo CALCULADO nas
-- RPCs get_public_session / get_customer_open_session
-- (`access_code_hash is not null as has_access_code`).
--
-- Resultado: a query direta à tabela rebentava sempre (42703: column does not
-- exist), o feed de sessões falhava e o mapa de mesas ficava sem sessões
-- ("mesa aberta mas invisível") — um erro que era engolido em silêncio.
--
-- Fix: materializar a mesma semântica das RPCs numa COLUNA GERADA. O staff lê o
-- booleano `has_access_code` sem que o hash saia da BD; é sempre coerente com o
-- hash (mantida pelo Postgres, não é escrita à mão) e não afeta INSERT/UPDATE
-- (colunas geradas não são inseríveis).
alter table public.sessions
  add column if not exists has_access_code boolean
  generated always as (access_code_hash is not null) stored;
