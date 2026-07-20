-- 0065_abn_unique.sql
-- One verified ABN, one account. Stops the same business number being claimed & verified by two
-- different profiles (fraud / accidental duplicate). We only constrain the VERIFIED rows: an
-- unverified/typo ABN can be shared or wrong without blocking anyone, but you can't have two
-- accounts both holding a *verified* claim on the same registered number.
--
-- Digits-only + partial index. We normalise to bare digits so '12 345 678 901' and '12345678901'
-- collide. A functional unique index on the normalised value, WHERE the relevant verify column is
-- 'verified', enforces this without touching unverified rows.
--
-- Two independent lanes (a profile can be both a worker and a business):
--   worker sole-trader  -> profiles.abn        verified via abn_status = 'verified'
--   hire business       -> profiles.company_abn verified via company_verify_status = 'verified'

create unique index if not exists profiles_worker_abn_verified_uniq
  on profiles (regexp_replace(abn, '\D', '', 'g'))
  where abn_status = 'verified' and abn is not null;

create unique index if not exists profiles_company_abn_verified_uniq
  on profiles (regexp_replace(company_abn, '\D', '', 'g'))
  where company_verify_status = 'verified' and company_abn is not null;

-- If a duplicate already exists at apply time the CREATE will fail; resolve by un-verifying the
-- later claimant first:
--   update profiles set abn_status = 'review'
--   where id in (
--     select id from (
--       select id, row_number() over (partition by regexp_replace(abn,'\D','','g') order by created_at) rn
--       from profiles where abn_status = 'verified' and abn is not null
--     ) d where rn > 1);
-- (and the analogous statement for company_abn / company_verify_status) then re-run this migration.

notify pgrst, 'reload schema';
