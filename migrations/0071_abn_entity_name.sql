-- 0071_abn_entity_name.sql
-- Durable field capture (structure-agnostic): store the REGISTERED business/entity name that ABN
-- Lookup returns at verification time, so a worker's seller name on any future document comes from the
-- ABR register — never free-typed (which could be an unregistered/incorrect name). Written by verify-abn
-- on a successful verify. Public register data, so readable by authenticated (invoice seller name).

alter table profiles add column if not exists abn_entity_name text;

grant select (abn_entity_name) on profiles to authenticated;

notify pgrst, 'reload schema';
