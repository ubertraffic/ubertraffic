-- 0063_service_role_grants.sql
-- The Edge Functions read/write with the service_role key, but service_role was missing table
-- privileges on public — create-checkout failed with "permission denied for table requests".
-- Restore full service_role access to every current + future object in public. RLS is unaffected
-- (service_role bypasses RLS); this only fixes the underlying GRANT it still needs. Run by hand.
grant usage on schema public to service_role;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;

notify pgrst, 'reload schema';
