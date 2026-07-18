-- 0046_workers_with_skill.sql
-- Community layer v1 — skill discovery.
-- Powers the tappable "Skills" on a public profile: tapping a skill lists OTHER
-- verified workers who supply the same skill, so workers/clients can discover peers.
--
-- Enforces the product rule "a skill tag only means a proven/eligible skill" SERVER-SIDE:
-- only workers with can_work = true (verified for site work) are returned. SECURITY DEFINER
-- so it can read across operators (operator_capabilities is otherwise owner-scoped by RLS).
--
-- Matching is by trade NAME (operator_capabilities.type) for v1. A future refinement can make
-- this group-aware via trades.match_group so closely-related trade names cross-connect.

create or replace function workers_with_skill(p_skill text)
returns table (user_id uuid, name text, rating numeric, rating_count int)
language sql
stable
security definer
set search_path = public
as $$
  select distinct p.id, p.full_name, p.rating, p.rating_count
  from operator_capabilities oc
  join profiles p on p.id = oc.operator_id
  where oc.type = p_skill
    and p.can_work = true
  order by p.rating desc nulls last
  limit 50;
$$;

grant execute on function workers_with_skill(text) to authenticated;
