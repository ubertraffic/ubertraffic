-- 0049_requests_pickup_text.sql
-- Runs: "where to buy". A plain-text shop/pickup location captured when the client posts a
-- run, so the worker knows WHERE to go — shown up front in the RunBrief, not buried at the end.
-- Written by createRequest's direct insert into requests (requestsService.js), read back via
-- listMyAssignments. No RPC changes; additive column only.

alter table requests add column if not exists pickup_text text;
