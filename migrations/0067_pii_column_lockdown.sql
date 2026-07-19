-- 0067_pii_column_lockdown.sql
-- CLOSE THE ONE RLS FINDING: sensitive identity PII on `profiles` (legal_name, date_of_birth, abn,
-- company_abn) was readable by the COUNTERPARTY on a shared job over the raw API. RLS is row-level,
-- so the "operator visible to client" / "client visible to operator" policies exposed the WHOLE row —
-- the app only reads safe display fields for a counterparty, but a hand-crafted API query could pull
-- the other party's DOB / legal name / ABN. A data-minimisation failure under the Australian Privacy
-- Principles.
--
-- THE FIX (column-level privilege, done correctly): `authenticated` holds a TABLE-WIDE select grant on
-- profiles, and a column-level REVOKE cannot subtract a column from a table-wide grant (that first
-- attempt was a silent no-op). The correct pattern is: REVOKE the table-wide select, then GRANT back
-- every column EXCEPT the four sensitive ones. We build the column list dynamically so it stays correct
-- regardless of the table's exact shape.
--
-- The columns stay physically on `profiles`, so every SECURITY DEFINER / service_role function
-- (get_public_profile, the admin ABN queue, submit_abn, verify-abn, settlement) keeps working — those
-- run as the definer / service_role, not as the calling user. The owner reads their OWN PII via
-- get_my_identity() below.

do $$
declare
  cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'profiles'
    and column_name not in ('legal_name', 'date_of_birth', 'abn', 'company_abn');

  -- drop the table-wide read, then grant back only the non-sensitive columns
  execute 'revoke select on public.profiles from authenticated';
  execute 'grant select (' || cols || ') on public.profiles to authenticated';
end $$;

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
