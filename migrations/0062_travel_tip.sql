-- 0062_travel_tip.sql
-- The fee model's extra money components. travel_cents is set by the CLIENT when posting (a travel
-- allowance they're willing to pay, ATO 88c/km shown as a guide) and goes 100% to the worker. Tips
-- (added at payment) also go 100% to the worker — recorded on the payment row so capture-payment can
-- pay them out. Additive. Run by hand in the Supabase SQL editor.

alter table requests  add column if not exists travel_cents integer not null default 0;
alter table payments  add column if not exists tip_cents    integer not null default 0;
alter table payments  add column if not exists travel_cents integer not null default 0;

notify pgrst, 'reload schema';
