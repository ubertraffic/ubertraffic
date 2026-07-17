-- 0051_credentials_insurance_licences.sql
-- Task 3 — worker insurance & licence capture. Additive; capture + display only. Does NOT add
-- trade_requirements, so nothing gates dispatch/eligibility on these.
--
-- Assumes credential_types.id is a TEXT slug (matches the app's slug-keyed reference tables) and
-- tier is a plain text column. If id is a uuid, or tier has a CHECK constraint that rejects these
-- rows, tell me and I'll adjust. tier is set to the safe existing value 'ticket'; the app keys the
-- new behaviour off the self_declared / needs_provider flags, not the tier string.

alter table operator_credentials add column if not exists provider text;
alter table credential_types  add column if not exists needs_provider boolean not null default false;
alter table credential_types  add column if not exists self_declared  boolean not null default false;

insert into credential_types (id, name, tier, needs_provider, self_declared, sort) values
  ('ins_public_liability', 'Public liability insurance',       'ticket', true,  true, 100),
  ('lic_electrical',       'Electrical licence',               'ticket', false, true, 110),
  ('lic_plumbing',         'Plumbing licence',                 'ticket', false, true, 111),
  ('lic_gasfitting',       'Gasfitting licence',               'ticket', false, true, 112),
  ('lic_drainer',          'Drainer licence',                  'ticket', false, true, 113),
  ('lic_building',         'Building licence',                 'ticket', false, true, 114),
  ('lic_refrig_aircon',    'Refrigeration & air-con licence',  'ticket', false, true, 115),
  ('lic_other',            'Other trade licence',              'ticket', false, true, 119)
on conflict (id) do nothing;
