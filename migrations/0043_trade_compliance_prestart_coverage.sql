-- 0043_trade_compliance_prestart_coverage.sql
--
-- Close the prestart SAFETY GAP.
--
-- The trade_compliance table only carried ~16 legacy trade names, so ~48 real
-- taxonomy trades — including high-risk plant, heights, traffic and demolition
-- work — matched no row and fell through to compliance_ready's default
-- (completion photo only). They were NEVER asked for a prestart. This adds a
-- compliance row for every uncovered trade so the arrival prestart gate fires
-- for all on-site work.
--
-- Classification (founder-approved): every on-site trade requires a prestart;
-- only the existing off-site errand tier stays exempt.
--   hrcw_capable = plant / heights / traffic / demolition
--   standard     = general on-site trades (incl. supervisory & office roles)
--   (both -> needs_prestart = true)
--
-- SAFE: additive + idempotent. Inserts ONLY trades with no existing row
-- (WHERE NOT EXISTS), so existing rows and legacy-named rows are untouched.
-- No money/settlement changes, no function changes. Re-running is a no-op.
-- Note: arrival_photo is left false for all new rows (existing high-risk rows
-- use it inconsistently); dial it up per-trade later if desired.

insert into trade_compliance (type, needs_prestart, needs_arrival_photo, needs_completion_photo, needs_signoff, tier)
select v.type, v.needs_prestart, v.needs_arrival_photo, v.needs_completion_photo, v.needs_signoff, v.tier
from (values
  -- HRCW-capable: plant, heights, traffic, demolition (prestart YES)
  ('Backhoe operator',                      true, false, true, true, 'hrcw_capable'),
  ('Crane operator',                        true, false, true, true, 'hrcw_capable'),
  ('Dozer operator',                        true, false, true, true, 'hrcw_capable'),
  ('Excavator operator',                    true, false, true, true, 'hrcw_capable'),
  ('Float operator',                        true, false, true, true, 'hrcw_capable'),
  ('Grader operator',                       true, false, true, true, 'hrcw_capable'),
  ('Loader operator',                       true, false, true, true, 'hrcw_capable'),
  ('Roller operator',                       true, false, true, true, 'hrcw_capable'),
  ('Scraper operator',                      true, false, true, true, 'hrcw_capable'),
  ('Skid steer operator',                   true, false, true, true, 'hrcw_capable'),
  ('Tipper operator',                       true, false, true, true, 'hrcw_capable'),
  ('Vac truck operator',                    true, false, true, true, 'hrcw_capable'),
  ('Water cart operator',                   true, false, true, true, 'hrcw_capable'),
  ('Scaffolder',                            true, false, true, true, 'hrcw_capable'),
  ('Roofer',                                true, false, true, true, 'hrcw_capable'),
  ('Steel fixer',                           true, false, true, true, 'hrcw_capable'),
  ('Structural steel erector',              true, false, true, true, 'hrcw_capable'),
  ('Rigger',                                true, false, true, true, 'hrcw_capable'),
  ('Dogman',                                true, false, true, true, 'hrcw_capable'),
  ('Formworker',                            true, false, true, true, 'hrcw_capable'),
  ('Traffic control',                       true, false, true, true, 'hrcw_capable'),
  ('Traffic Controller + Implementer',      true, false, true, true, 'hrcw_capable'),
  ('Traffic Implementer (setup/pack-down)', true, false, true, true, 'hrcw_capable'),
  ('Demolition labourer',                   true, false, true, true, 'hrcw_capable'),
  ('Fire watch',                            true, false, true, true, 'hrcw_capable'),
  -- Standard on-site trades (prestart YES)
  ('Concrete labourer',                     true, false, true, true, 'standard'),
  ('General labourer',                      true, false, true, true, 'standard'),
  ('Site cleaner',                          true, false, true, true, 'standard'),
  ('Yard hand',                             true, false, true, true, 'standard'),
  ('Carpenter',                             true, false, true, true, 'standard'),
  ('Joiner',                                true, false, true, true, 'standard'),
  ('Drainer',                               true, false, true, true, 'standard'),
  ('Pipe layer',                            true, false, true, true, 'standard'),
  ('Plumber',                               true, false, true, true, 'standard'),
  ('Electrician',                           true, false, true, true, 'standard'),
  ('Plasterer',                             true, false, true, true, 'standard'),
  ('Renderer',                              true, false, true, true, 'standard'),
  ('Painter',                               true, false, true, true, 'standard'),
  ('Tiler',                                 true, false, true, true, 'standard'),
  ('Waterproofer',                          true, false, true, true, 'standard'),
  ('Glazier',                               true, false, true, true, 'standard'),
  ('Leading hand',                          true, false, true, true, 'standard'),
  ('Site supervisor',                       true, false, true, true, 'standard'),
  ('Safety officer',                        true, false, true, true, 'standard'),
  ('Surveyor',                              true, false, true, true, 'standard'),
  ('Estimator',                             true, false, true, true, 'standard'),
  ('Project manager',                       true, false, true, true, 'standard'),
  ('Traffic planning',                      true, false, true, true, 'standard')
) as v(type, needs_prestart, needs_arrival_photo, needs_completion_photo, needs_signoff, tier)
where not exists (
  select 1 from trade_compliance tc where tc.type = v.type
);

-- Verify (expect 0 rows — every taxonomy trade now has a compliance row):
--   select t.name from trades t
--   left join trade_compliance tc on tc.type = t.name
--   where tc.type is null;
