-- 0048_peer_vouches.sql
-- Endorsements, Commit 2 — the peer side. Workers who shared a job can vouch for each other
-- (optionally with "good unit" tags). Un-gameable: a vouch is only recorded if BOTH parties
-- actually worked the same job. Extends get_reputation_extras (from 0047) to fold peer vouches
-- into the profile: a vouch count, voucher names, and peer tags merged into the badge tally.

-- 1) the vouch record ------------------------------------------------------------------
create table if not exists peer_vouches (
  id          uuid primary key default gen_random_uuid(),
  voucher_id  uuid not null references profiles(id) on delete cascade,
  vouchee_id  uuid not null references profiles(id) on delete cascade,
  request_id  uuid not null references requests(id) on delete cascade,
  tags        text[] not null default '{}',
  created_at  timestamptz not null default now(),
  unique (voucher_id, vouchee_id, request_id)   -- one vouch per pair per job
);

alter table peer_vouches enable row level security;

-- Direct reads limited to your own rows; aggregates for a profile go through the SECURITY
-- DEFINER reader below. Writes ONLY happen through vouch_for_peer (also definer), so there is
-- deliberately no insert/update policy — RLS blocks any direct client write.
drop policy if exists peer_vouches_select_own on peer_vouches;
create policy peer_vouches_select_own on peer_vouches
  for select using (voucher_id = auth.uid() or vouchee_id = auth.uid());

-- 2) roster — who else worked this job (only if the caller worked it too) ---------------
create or replace function coworkers_on_job(p_request_id uuid)
returns table (user_id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct a.operator_id, pr.full_name
  from assignments a
  join request_items ri on ri.id = a.request_item_id
  join profiles pr      on pr.id = a.operator_id
  where ri.request_id = p_request_id
    and a.status <> 'cancelled'
    and a.operator_id <> auth.uid()
    and exists (   -- gate: don't reveal a job's roster to someone who wasn't on it
      select 1 from assignments me
      join request_items mri on mri.id = me.request_item_id
      where mri.request_id = p_request_id
        and me.operator_id = auth.uid()
        and me.status <> 'cancelled'
    );
$$;

grant execute on function coworkers_on_job(uuid) to authenticated;

-- 3) vouch — verifies both parties worked the job before recording ---------------------
create or replace function vouch_for_peer(p_request_id uuid, p_peer_id uuid, p_tags text[])
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not_authenticated'; end if;
  if v_me = p_peer_id then raise exception 'cannot_vouch_self'; end if;

  if not exists (
    select 1 from assignments a join request_items ri on ri.id = a.request_item_id
    where ri.request_id = p_request_id and a.operator_id = v_me and a.status <> 'cancelled'
  ) then raise exception 'not_on_job'; end if;

  if not exists (
    select 1 from assignments a join request_items ri on ri.id = a.request_item_id
    where ri.request_id = p_request_id and a.operator_id = p_peer_id and a.status <> 'cancelled'
  ) then raise exception 'peer_not_on_job'; end if;

  insert into peer_vouches (voucher_id, vouchee_id, request_id, tags)
  values (v_me, p_peer_id, p_request_id, coalesce(p_tags, '{}'))
  on conflict (voucher_id, vouchee_id, request_id)
  do update set tags = excluded.tags, created_at = now();
end;
$$;

grant execute on function vouch_for_peer(uuid, uuid, text[]) to authenticated;

-- 4) reader — reputation aggregate, now including peer vouches -------------------------
-- Return type gains columns, so drop + recreate (create-or-replace can't change the shape).
drop function if exists get_reputation_extras(uuid);
create or replace function get_reputation_extras(p_user_id uuid)
returns table (rehire_count int, tag_counts jsonb, vouch_count int, vouchers jsonb)
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
  vouches as (
    select pv.voucher_id, pv.tags
    from peer_vouches pv
    where pv.vouchee_id = p_user_id
  ),
  exploded as (
    select unnest(tags) as tag from client_ratings
    union all
    select unnest(tags) as tag from vouches
  )
  select
    (select count(*) from client_ratings where would_rehire is true)::int as rehire_count,
    coalesce(
      (select jsonb_object_agg(tag, c)
         from (select tag, count(*) as c from exploded group by tag) g),
      '{}'::jsonb
    ) as tag_counts,
    (select count(distinct voucher_id) from vouches)::int as vouch_count,
    coalesce(
      (select jsonb_agg(nm)
         from (
           select distinct split_part(pr.full_name, ' ', 1) as nm
           from vouches v join profiles pr on pr.id = v.voucher_id
           limit 6
         ) names),
      '[]'::jsonb
    ) as vouchers;
$$;

grant execute on function get_reputation_extras(uuid) to authenticated;
