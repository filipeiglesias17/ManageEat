-- Compatibility patch for local databases that already applied the first
-- hardening migration before sessions_validate_update became security definer.
-- The trigger still checks auth.uid()/profiles; this only lets it clean the
-- private session_code_locks table when staff close or reset a QR session.

alter function public.sessions_validate_update() security definer;
