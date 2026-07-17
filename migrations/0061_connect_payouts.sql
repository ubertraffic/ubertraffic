-- 0061_connect_payouts.sql
-- Stripe Connect payouts. profiles.stripe_account_id links a worker to their Express connected
-- account (set server-side by connect-onboard). `payouts` records each transfer to a worker.
-- Written ONLY by the Edge Functions (service-role); workers may READ their own. Run by hand.

alter table profiles add column if not exists stripe_account_id text;

create table if not exists payouts (
  id                uuid primary key default gen_random_uuid(),
  request_id        uuid references requests(id) on delete set null,
  assignment_id     uuid references assignments(id) on delete set null,
  operator_id       uuid references auth.users(id) on delete set null,
  amount_cents      integer not null,
  currency          text not null default 'aud',
  stripe_transfer_id text,
  status            text not null default 'paid',   -- paid | failed | pending
  detail            text,
  created_at        timestamptz not null default now()
);

alter table payouts enable row level security;
drop policy if exists "payouts owner read" on payouts;
create policy "payouts owner read" on payouts
  for select to authenticated using (operator_id = auth.uid());

create index if not exists payouts_operator_idx on payouts (operator_id);

notify pgrst, 'reload schema';
