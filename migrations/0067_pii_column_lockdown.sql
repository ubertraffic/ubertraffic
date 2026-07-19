-- 0067_pii_column_lockdown.sql
-- CLOSE THE ONE RLS FINDING: sensitive identity PII on `profiles` (legal_name, date_of_birth, abn,
-- company_abn) was readable by the COUNTERPARTY on a shared job. RLS is row-level, so the
-- "operator visible to client" / "client visible to operator" policies exposed the WHOLE row — the
-- app only ever reads safe display fields for a counterparty, but a raw API query with the public
-- anon key + a shared job could pull the other party's DOB / legal name / ABN. That's a data-
-- minimisation failure under the Australian Privacy Principles.
--
-- THE FIX (surgical, non-breaking): column-level REVOKE. The columns stay physically on `profiles`
-- (so every SECURITY DEFINER / service_role function — get_public_profile, the admin ABN queue,
-- submit_abn, verify-abn, settlement — keeps working unchanged, because those run as the definer /
-- service_role, NOT as the calling user). We only remove the ability of the logged-in *user* role to
-- SELECT these four columns directly. The owner still reads their OWN PII via get_my_identity() below.
--
-- Writes are unaffected: profiles_self_update already restricts UPDATE to auth.uid() = id, and the app
-- never RETURNs these columns on update.

revoke select (legal_name, date_of_birth, abn, company_abn)
  on public.profiles from anon, authenticated;

-- The owner reads their OWN identity/business PII through this definer function (returns exactly one
-- row — the caller's — and nothing if not signed in). This is the only path the app uses now.
create or replace function public.get_my_identity()
returns table (
  legal_name            text,
  date_of_birth         date,
  abn                   text,
  abn_status            text,
  company_name          text,
  company_abn           text,
  company_verify_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select legal_name, date_of_birth, abn, abn_status, company_name, company_abn, company_verify_status
  from public.profiles
  where id = auth.uid();
$$;

grant execute on function public.get_my_identity() to authenticated;

notify pgrst, 'reload schema';
