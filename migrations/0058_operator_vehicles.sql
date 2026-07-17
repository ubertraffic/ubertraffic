-- 0058_operator_vehicles.sql
-- "The rig" — a user's vehicles, each carrying its own registration + insurance with expiries, so
-- the compliance picture is per-vehicle, not one blanket flag. Works for BOTH workers (their work
-- ute) and companies (their fleet): keyed on the owner's user id. Written by vehiclesService.
-- Run by hand in the Supabase SQL editor.
--
-- NOTE: equipment/plant a worker operates stays modelled as a capability (operator_capabilities);
-- personal insurance (public liability) stays a credential. This table is specifically vehicles.

create table if not exists operator_vehicles (
  id                 uuid primary key default gen_random_uuid(),
  operator_id        uuid not null references auth.users(id) on delete cascade,
  type               text not null,            -- Ute, Van, Truck, Tipper, Trailer, Car, Excavator…
  make_model         text,
  rego               text,
  rego_expires       date,
  insurer            text,
  insurance_expires  date,
  created_at         timestamptz not null default now()
);

alter table operator_vehicles enable row level security;

-- Owner-only: a user reads/writes only their own vehicles.
drop policy if exists "vehicles owner all" on operator_vehicles;
create policy "vehicles owner all" on operator_vehicles
  for all to authenticated
  using (operator_id = auth.uid())
  with check (operator_id = auth.uid());

create index if not exists operator_vehicles_operator_idx on operator_vehicles (operator_id);
