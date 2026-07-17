-- 0060_payments.sql
-- Records every Stripe Checkout attempt for a job. Written ONLY by the Edge Functions
-- (create-checkout / checkout-status) using the service-role key — there is deliberately NO client
-- write policy, so a client can never fabricate a 'paid' row. A client may READ their own payments.
-- Run by hand in the Supabase SQL editor.

create table if not exists payments (
  id                    uuid primary key default gen_random_uuid(),
  request_id            uuid references requests(id) on delete set null,
  client_id             uuid references auth.users(id) on delete set null,
  amount_cents          integer not null,
  currency              text not null default 'aud',
  stripe_session_id     text,
  stripe_payment_intent text,
  status                text not null default 'pending',   -- pending | paid | cancelled | failed
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table payments enable row level security;

-- Client can see their own payments; nobody (authenticated) can write — only the service-role
-- Edge Functions write, and service-role bypasses RLS.
drop policy if exists "payments owner read" on payments;
create policy "payments owner read" on payments
  for select to authenticated using (client_id = auth.uid());

create index if not exists payments_request_idx on payments (request_id);
create index if not exists payments_client_idx on payments (client_id);
