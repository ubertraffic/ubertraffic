-- 0074_request_latlng.sql
-- Distance-on-cards: the worker feed needs each job's coordinates to show "3.2 km away". The precise
-- geofence coords already live in a geography column (written by set_request_location), but that isn't
-- plainly selectable through the feed's PostgREST query. Rather than reach into that untracked geo
-- schema, we store the same lat/lng as two plain numeric columns the feed can read directly.
--
-- These are the SITE coordinates the client picked when posting — already surfaced approximately on
-- the operator map, so exposing them for a distance calc is consistent with existing behaviour.
-- Backfill isn't attempted here: new posts carry lat/lng; older jobs simply show no distance.

alter table requests add column if not exists lat double precision;
alter table requests add column if not exists lng double precision;

-- The feed reads requests as the authenticated worker (via the dispatch join). authenticated already
-- holds table-wide select on requests; these new columns are covered by that. Grant explicitly too,
-- in case a column-level grant model is ever applied (mirrors how 0069/0071 re-granted new columns).
grant select (lat, lng) on requests to authenticated;

notify pgrst, 'reload schema';
