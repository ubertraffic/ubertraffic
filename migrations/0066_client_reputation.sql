-- 0066_client_reputation.sql
-- Show a CLIENT's reputation (how workers rated them) on their public profile. Symmetric to the
-- worker rating, and built the same safe way as get_reputation_extras (0047): derive direction by
-- JOINING rating -> assignment -> request_item -> request and looking at who authored it, so we never
-- touch the money-sensitive submit_rating or depend on the ratings table's internal direction column.
--
-- A rating is ABOUT the client when the rater is the worker on that job (r.rater_id = a.operator_id)
-- and the job belongs to the client (req.client_id = p_user_id). Averaging those scores gives the
-- client's star rating "from workers". Additive only — no existing function is modified.

create or replace function get_client_reputation(p_user_id uuid)
returns table (client_rating numeric, client_rating_count int)
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
    where req.client_id = p_user_id       -- ratings left on THIS client's jobs...
      and r.rater_id = a.operator_id       -- ...authored by the worker → i.e. ABOUT the client
      and r.score is not null
  )
  select round(avg(score)::numeric, 2) as client_rating,
         count(*)::int                 as client_rating_count
  from worker_ratings;
$$;

grant execute on function get_client_reputation(uuid) to authenticated;

notify pgrst, 'reload schema';
