-- 0047_rating_extras.sql
-- Endorsements, Commit 1 — enrich the existing star rating with "good unit" tags and a
-- re-hire flag, and expose the aggregate for the public profile. Additive only: the
-- money-sensitive submit_rating and the profile projection get_public_profile are NOT
-- touched. The client writes extras with set_rating_extras() right after submit_rating,
-- and the profile reads get_reputation_extras() and merges it in.

-- 1) columns on the existing ratings table --------------------------------------------
alter table ratings add column if not exists tags text[] not null default '{}';
alter table ratings add column if not exists would_rehire boolean;

-- 2) writer — updates ONLY the caller's own rating row for this assignment -------------
create or replace function set_rating_extras(p_assignment_id uuid, p_tags text[], p_would_rehire boolean)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update ratings
     set tags = coalesce(p_tags, '{}'),
         would_rehire = p_would_rehire
   where assignment_id = p_assignment_id
     and rater_id = auth.uid();   -- can only decorate a rating you authored
$$;

grant execute on function set_rating_extras(uuid, text[], boolean) to authenticated;

-- 3) reader — reputation aggregate for one worker -------------------------------------
-- Counts only CLIENT-authored ratings of this worker (rater = the job's client), found by
-- joining rating -> assignment -> request_item -> request. This deliberately avoids depending
-- on the ratings table's own direction/subject columns (whose exact names live server-side),
-- so it stays correct regardless of how submit_rating records direction.
create or replace function get_reputation_extras(p_user_id uuid)
returns table (rehire_count int, tag_counts jsonb)
language sql
stable
security definer
set search_path = public
as $$
  with client_ratings as (
    select r.would_rehire, r.tags
    from ratings r
    join assignments a     on a.id = r.assignment_id
    join request_items ri  on ri.id = a.request_item_id
    join requests req      on req.id = ri.request_id
    where a.operator_id = p_user_id
      and r.rater_id = req.client_id
  ),
  exploded as (
    select unnest(tags) as tag from client_ratings
  )
  select
    (select count(*) from client_ratings where would_rehire is true)::int as rehire_count,
    coalesce(
      (select jsonb_object_agg(tag, c)
         from (select tag, count(*) as c from exploded group by tag) g),
      '{}'::jsonb
    ) as tag_counts;
$$;

grant execute on function get_reputation_extras(uuid) to authenticated;
