-- 0045_run_style_open.sql
--
-- Phase 1 of "runs": mark the OPEN-style run tasks.
--
-- Adds trades.run_style ('open' | 'menu' | null). A non-null value marks a task
-- as a RUN and (later) selects which posting builder to show. Phase 1 sets 'open'
-- on the three open-list runs; MENU runs (drinks, smoko) come in Phase 2.
--
-- For OPEN runs the "what to get" list reuses requests.job_details (already shown
-- to workers before they accept) and the spend cap reuses requests.materials_cap
-- — no new order column this phase. Errand tier keeps them light-touch (no prestart).
--
-- SAFE: additive + idempotent. Column add is IF NOT EXISTS; the update only sets
-- the three run tasks. No money/RPC/component changes.

alter table trades add column if not exists run_style text;

update trades set run_style = 'open'
where name in ('Bunnings / hardware run', 'Materials pickup & drop', 'Fuel / gas bottle run')
  and run_style is distinct from 'open';

-- Verify (expect the three tasks with run_style='open'):
--   select name, run_style from trades where run_style is not null order by name;
