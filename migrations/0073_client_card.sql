-- 0073_client_card.sql
-- One SECURITY DEFINER call that returns everything a worker's job card needs to know about the CLIENT
-- they'd be working for — WITHOUT exposing locked PII. Workers decide blind in an accept-first model,
-- so the card should show: who it is (business/trading name, else their name), whether they're a
-- VERIFIED business (passed the ABN/business check), and their rating from other workers.
--
-- Safe to expose to authenticated: company_name is a business label (not PII like company_abn, which
-- stays locked by 0067); can_hire / company_verify_status are capability flags; the rating is derived
-- the same honest way as get_client_reputation (0066) — a rating is ABOUT the client when the worker
-- on that job authored it. No sensitive columns (legal_name, dob, abn, company_abn) are returned.

create or replace function get_client_card(p_user_id uuid)
returns table (display_name text, company_name text, verified boolean, rating numeric, rating_count int)
language sql
stable
security definer
set search_path = public
as $$
  with worker_ratings as (
    select r.score
    from ratings r
    join assignments a     on a.id = r.assignment_id
    join request_items ri  on ri.id = a.request_item_id
    join requests req      on req.id = ri.request_id
    where req.client_id = p_user_id
      and r.rater_id = a.operator_id      -- authored by the worker → ABOUT the client
      and r.score is not null
  )
  select
    coalesce(nullif(trim(p.company_name), ''), p.full_name, 'A local client')                  as display_name,
    nullif(trim(p.company_name), '')                                                            as company_name,
    (coalesce(p.can_hire, false) or coalesce(p.company_verify_status::text, '') = 'verified')   as verified,
    (select round(avg(score)::numeric, 1) from worker_ratings)                                  as rating,
    (select count(*)::int from worker_ratings)                                                  as rating_count
  from profiles p
  where p.id = p_user_id;
$$;

grant execute on function get_client_card(uuid) to authenticated;

notify pgrst, 'reload schema';
