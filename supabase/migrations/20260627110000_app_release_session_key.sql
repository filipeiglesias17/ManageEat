-- OTA com encriptação ponta-a-ponta (auditoria 2026-06-27, mobile-ota-0/1).
--
-- Com a encriptação E2E do capgo, além do checksum (agora assinado com a chave
-- privada) o bundle traz uma "session key" (chave AES encriptada) que a app
-- desencripta com a publicKey embebida no binário. Guardamos esse ivSessionKey
-- aqui para o download() o passar ao plugin.
--
-- Coluna nullable: releases antigos (plain) continuam válidos sem session_key.
-- A RLS de app_release não muda (escrita só admin); o ota-publish usa a
-- service_role.

alter table public.app_release add column if not exists session_key text;
