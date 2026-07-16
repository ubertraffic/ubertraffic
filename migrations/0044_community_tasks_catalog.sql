-- 0044_community_tasks_catalog.sql
--
-- Add the community task catalog: 6 new groups + 25 tasks, each mapped to a
-- compliance tier so the prestart/close-out safety layer keeps working.
--
-- Extends the EXISTING taxonomy (no parallel structure):
--   trade_categories : the 6 groups (sorted to lead, so they surface prominently)
--   trades           : the 25 tasks, all kind='task' -> the "Tasks" front door,
--                      client_visible=true, self-slug match_group, search aliases
--   trade_compliance : each task name -> its tier (errand/standard/hrcw_capable)
--                      using the same flag template the existing tiers use:
--                        errand       -> prestart F, signoff F, completion photo T
--                        standard     -> prestart T, signoff T, completion photo T
--                        hrcw_capable -> prestart T, signoff T, completion photo T
--                      (arrival_photo F for all, matching 0043)
--
-- Errand tasks (drinks run, smoko, skip/bin, etc.) have needs_prestart=false, so
-- the prestart/SWMS card NEVER fires for them — a drinks run stays light-touch.
--
-- Also hides four OLD duplicates from the client picker (client_visible=false) so
-- clients see one clean list; their rows and any existing jobs on them are kept.
--
-- SAFE: additive + idempotent (WHERE NOT EXISTS / targeted UPDATE). No money/
-- settlement, RPC, or component changes. New tasks price at the generic $40/job
-- task default already in the app. Re-running is a no-op.
--
-- Assumes trade_categories.id / trades.id are uuid (standard Supabase). If your
-- ids are a different type, the first insert will error — tell me and I'll adjust.

-- 1) Groups — sorted just below the current minimum so they lead the list, in order.
insert into trade_categories (id, name, icon, sort)
select gen_random_uuid(), v.name, v.icon,
       (select coalesce(min(sort), 0) from trade_categories) - (7 - v.ord)
from (values
  ('ON-SITE WORK HELP',      'crew', 1),
  ('RUNS & DELIVERIES',      'task', 2),
  ('SITE SETUP & WELFARE',   'gear', 3),
  ('RUBBISH & REMOVALS',     'task', 4),
  ('HANDYMAN & QUICK FIXES', 'gear', 5),
  ('GARDEN & OUTDOOR',       'crew', 6)
) as v(name, icon, ord)
where not exists (select 1 from trade_categories c where c.name = v.name);

-- 2) Tasks — all kind='task', linked to their group by name, self-slug match_group.
insert into trades (id, category_id, name, kind, aliases, sort, client_visible, match_group)
select gen_random_uuid(),
       (select id from trade_categories where name = t.cat limit 1),
       t.name, 'task', t.aliases, t.sort, true,
       lower(regexp_replace(t.name, '[^a-zA-Z0-9]+', '_', 'g'))
from (values
  ('ON-SITE WORK HELP',      'Labourer for the day',                     array['labourer','labour hire','day labourer'],        1),
  ('ON-SITE WORK HELP',      'Extra pair of hands',                      array['helper','offsider','general help'],             2),
  ('ON-SITE WORK HELP',      'Site cleanup',                             array['site clean','clean up','tidy up'],              3),
  ('ON-SITE WORK HELP',      'Traffic control / spotter',                array['traffic control','spotter','tc'],               4),
  ('RUNS & DELIVERIES',      'Bunnings / hardware run',                  array['bunnings','hardware','pickup'],                 1),
  ('RUNS & DELIVERIES',      'Materials pickup & drop',                  array['materials','pickup','drop off'],                2),
  ('RUNS & DELIVERIES',      'Cold drinks & ice run',                    array['drinks','ice','cold water'],                    3),
  ('RUNS & DELIVERIES',      'Smoko / food run',                         array['smoko','food','lunch run'],                     4),
  ('RUNS & DELIVERIES',      'Fuel / gas bottle run',                    array['fuel','gas bottle','petrol','diesel'],          5),
  ('SITE SETUP & WELFARE',   'Set up / pack down site amenities',        array['amenities','set up','pack down'],               1),
  ('SITE SETUP & WELFARE',   'Deliver & set up shade / fans / cooling',  array['shade','fans','cooling'],                       2),
  ('SITE SETUP & WELFARE',   'Water & esky restock',                     array['water','esky','restock'],                       3),
  ('SITE SETUP & WELFARE',   'Portaloo / bin sorted',                    array['portaloo','toilet','bin'],                      4),
  ('SITE SETUP & WELFARE',   'First-aid / supplies top-up',              array['first aid','supplies','ppe'],                   5),
  ('RUBBISH & REMOVALS',     'Rubbish removal',                          array['rubbish','waste','removal'],                    1),
  ('RUBBISH & REMOVALS',     'Skip / bin run',                           array['skip','bin run','tip run'],                     2),
  ('RUBBISH & REMOVALS',     'Green waste clear',                        array['green waste','garden waste'],                   3),
  ('RUBBISH & REMOVALS',     'Heavy item / two-person lift',             array['heavy item','two person lift','2 man lift'],    4),
  ('HANDYMAN & QUICK FIXES', 'General handyman',                         array['handyman','odd jobs','repairs'],                1),
  ('HANDYMAN & QUICK FIXES', 'Flatpack / furniture assembly',            array['flatpack','furniture','assembly'],              2),
  ('HANDYMAN & QUICK FIXES', 'TV / shelf / mounting',                    array['tv mount','shelf','mounting'],                  3),
  ('HANDYMAN & QUICK FIXES', 'Gutter clean / pressure wash',             array['gutter','pressure wash','gurney'],              4),
  ('GARDEN & OUTDOOR',       'Lawn & garden tidy',                       array['lawn','garden','mowing'],                       1),
  ('GARDEN & OUTDOOR',       'Hedge / tree trim',                        array['hedge','tree trim','pruning'],                  2),
  ('GARDEN & OUTDOOR',       'Fence repair',                             array['fence','fencing','repair'],                     3)
) as t(cat, name, aliases, sort)
where not exists (select 1 from trades tr where tr.name = t.name);

-- 3) Compliance tier per task (name -> requirements). errand stays light-touch.
insert into trade_compliance (type, needs_prestart, needs_arrival_photo, needs_completion_photo, needs_signoff, tier)
select v.type, v.needs_prestart, false, true, v.needs_signoff, v.tier
from (values
  ('Labourer for the day',                    true,  true,  'standard'),
  ('Extra pair of hands',                     true,  true,  'standard'),
  ('Site cleanup',                            false, false, 'errand'),
  ('Traffic control / spotter',               true,  true,  'hrcw_capable'),
  ('Bunnings / hardware run',                 false, false, 'errand'),
  ('Materials pickup & drop',                 false, false, 'errand'),
  ('Cold drinks & ice run',                   false, false, 'errand'),
  ('Smoko / food run',                        false, false, 'errand'),
  ('Fuel / gas bottle run',                   false, false, 'errand'),
  ('Set up / pack down site amenities',       true,  true,  'standard'),
  ('Deliver & set up shade / fans / cooling', true,  true,  'standard'),
  ('Water & esky restock',                    false, false, 'errand'),
  ('Portaloo / bin sorted',                   false, false, 'errand'),
  ('First-aid / supplies top-up',             false, false, 'errand'),
  ('Rubbish removal',                         true,  true,  'standard'),
  ('Skip / bin run',                          false, false, 'errand'),
  ('Green waste clear',                       false, false, 'errand'),
  ('Heavy item / two-person lift',            true,  true,  'standard'),
  ('General handyman',                        true,  true,  'standard'),
  ('Flatpack / furniture assembly',           false, false, 'errand'),
  ('TV / shelf / mounting',                   false, false, 'errand'),
  ('Gutter clean / pressure wash',            true,  true,  'standard'),
  ('Lawn & garden tidy',                      false, false, 'errand'),
  ('Hedge / tree trim',                       true,  true,  'standard'),
  ('Fence repair',                            true,  true,  'standard')
) as v(type, needs_prestart, needs_signoff, tier)
where not exists (select 1 from trade_compliance tc where tc.type = v.type);

-- 4) Hide the four old duplicates from the CLIENT picker (rows + existing jobs kept).
update trades set client_visible = false
where name in ('Bunnings pickup', 'Materials drop', 'Bin / tip run', 'Site cleaner');

-- Verify:
--   -- all 25 tasks have a compliance row (expect 25):
--   select count(*) from trade_compliance where type in (
--     'Labourer for the day','Extra pair of hands','Site cleanup','Traffic control / spotter',
--     'Bunnings / hardware run','Materials pickup & drop','Cold drinks & ice run','Smoko / food run',
--     'Fuel / gas bottle run','Set up / pack down site amenities','Deliver & set up shade / fans / cooling',
--     'Water & esky restock','Portaloo / bin sorted','First-aid / supplies top-up','Rubbish removal',
--     'Skip / bin run','Green waste clear','Heavy item / two-person lift','General handyman',
--     'Flatpack / furniture assembly','TV / shelf / mounting','Gutter clean / pressure wash',
--     'Lawn & garden tidy','Hedge / tree trim','Fence repair');
--   -- errand tasks must NOT need a prestart (expect all false):
--   select type, needs_prestart from trade_compliance
--   where type in ('Cold drinks & ice run','Smoko / food run','Skip / bin run','Site cleanup');
