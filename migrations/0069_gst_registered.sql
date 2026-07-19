-- 0069_gst_registered.sql
-- Per-worker GST status. Having an ABN does NOT mean a worker charges GST — GST only applies if they
-- are REGISTERED for GST (mandatory once turnover hits $75k/yr; optional below). Most gig workers
-- aren't, so this defaults to false and stays out of the way. When true, the invoice breaks out the
-- 10% GST already inside the (GST-inclusive) price; the worker remits it to the ATO themselves.
--
-- Not sensitive PII (it's a business fact the invoice needs), so it's readable by the counterparty for
-- the invoice. The column-level select grant is required because 0067 replaced profiles' table-wide
-- select with an explicit column list — a newly added column isn't in it until granted.

alter table profiles add column if not exists gst_registered boolean not null default false;

grant select (gst_registered) on profiles to authenticated;

notify pgrst, 'reload schema';
