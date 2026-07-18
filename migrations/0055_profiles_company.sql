-- 0055_profiles_company.sql
-- Hire side — business details (company name + business ABN). Additive columns only.
-- Written by accountService.setMyCompanyName / setMyCompanyAbn (direct self-update on the
-- caller's own profile row, same pattern as updateMyName / setMyAbn).
--
-- The ABN's VERIFIED state is NOT stored here — it reuses the existing hire gate column
-- company_verify_status (set by the submit_abn RPC). company_abn holds the raw digits for
-- display; company_name is a label shown to workers / on invoices later.
--
-- Read in isolation by BusinessDetailsScreen via accountService.getMyBusiness(), never added to
-- the shared profile select, so a not-yet-applied column can't break the main workspace load.

alter table profiles add column if not exists company_name text;
alter table profiles add column if not exists company_abn  text;

-- Nudge PostgREST to pick up the new columns immediately.
notify pgrst, 'reload schema';

-- If a column-level grant blocks the self-update, also run:
--   grant update (company_name, company_abn) on profiles to authenticated;
