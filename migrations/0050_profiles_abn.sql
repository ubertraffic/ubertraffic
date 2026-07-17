-- 0050_profiles_abn.sql
-- Task 2 — worker ABN (sole-trader / contractor). Additive columns only. The client writes these
-- via accountService.setMyAbn (direct self-update on the caller's own profile row). abn_status is
-- 'valid' = format+checksum passed client-side; it is NOT register verification. True "verified
-- against the ABR register" is a deferred, server-side step (a free ABR GUID + an Edge Function) —
-- never self-granted. This does NOT gate dispatch/accept eligibility (a separate future decision).

alter table profiles add column if not exists abn text;
alter table profiles add column if not exists abn_status text;

-- Self-update must be permitted (the existing updateMyName does the same direct profile update, so
-- row-level self-update already works). If a column-level grant blocks the write, also run:
--   grant update (abn, abn_status) on profiles to authenticated;
