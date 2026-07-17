-- 0054_profiles_identity.sql
-- Credentials Phase 2 — identity anchor for register verification. Additive columns only.
-- Written by accountService.setMyIdentity (direct self-update on the caller's own profile row,
-- same pattern as updateMyName/setMyAbn). Sensitive PII (DOB) — collected with a purpose line,
-- used only for verification, never shown publicly. Ties to the privacy review flagged in Task 5.

alter table profiles add column if not exists legal_name    text;
alter table profiles add column if not exists date_of_birth date;

-- If a column-level grant blocks the self-update, also run:
--   grant update (legal_name, date_of_birth) on profiles to authenticated;
