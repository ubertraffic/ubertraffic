-- 0075_refresh_my_dispatches.sql
-- "Jobs must ALWAYS show in the feed."
--
-- THE BUG: a client posts a job, but a worker who was offline at that moment (or who is the poster
-- themselves on a test account) never appears in that worker's feed — and pull-to-refresh never fixes
-- it. Root cause is in the dispatch model, not the UI:
--
--   • dispatch_for_item(item) fans out ONCE, at POST TIME, to operators who are online RIGHT THEN
--     (and never to the client's own account: `p.id <> v_client`). There is no re-dispatch when a
--     worker comes online later, so they are simply never handed a `dispatches` row.
--   • accept_spot() HARD-REQUIRES an existing dispatch in ('sent','seen') — no dispatch, no accept.
--   • The feed (listMyDispatches) only reads `dispatches`. No dispatch row → the job is invisible.
--
-- THE FIX: a per-operator "pull" that the feed calls on every open/refresh. It re-runs EXACTLY the
-- same eligibility test dispatch_for_item uses — but for the ONE calling operator, against EVERY open
-- job — and creates any missing dispatch. So the moment a qualified worker looks at their feed, every
-- job they're eligible for is present and acceptable. This is the "by any means necessary" guarantee:
-- the feed self-heals instead of depending on the worker having been online at the exact post moment.
--
-- Two operations, both idempotent:
--   1. INSERT the missing 'sent' dispatches (the actual reported bug).
--   2. REVIVE 'expired' dispatches back to 'sent' when a spot has REOPENED (accept_spot sets a
--      dispatch 'expired' when an item fills; if someone later cancels, the spot is open again but the
--      old dispatch stays 'expired' and blocks re-accept). We only ever revive 'expired' (a
--      system-set state), never 'accepted' or a user's own choice.
--
-- Eligibility below is a LINE-FOR-LINE mirror of dispatch_for_item's WHERE clause (group-aware
-- capability match via trades.match_group, else exact type; every 'required' trade_requirement met by
-- a verified, unexpired credential; sim jobs only to sim operators; never the client's own job). The
-- ONLY intentional difference: we do NOT require is_online — the caller is the operator, live, looking
-- at their feed right now; accept_spot's own gate likewise never checks is_online.

create or replace function refresh_my_dispatches()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_op  uuid := auth.uid();
  v_ins integer := 0;
  v_rev integer := 0;
begin
  if v_op is null then
    return 0;
  end if;

  -- Every open job this operator is eligible for, computed once, mirroring dispatch_for_item exactly.
  create temporary table _eligible_items on commit drop as
  with me as (
    select id, is_sim, can_work, can_task
    from public.profiles
    where id = v_op
  )
  select ri.id as item_id
  from public.request_items ri
  join public.requests req on req.id = ri.request_id
  cross join me
  left join public.trades t on t.id = ri.trade_id
  where req.status::text not in ('complete', 'cancelled')        -- job still open
    and req.client_id <> v_op                                    -- never my own job (matches p.id <> v_client)
    and ( req.is_sim = false or me.is_sim = true )                -- sim jobs only to sim operators
    and (
      select count(*) from public.assignments a
      where a.request_item_id = ri.id and a.status <> 'cancelled'
    ) < ri.qty                                                    -- item not already full
    and (
      ( ri.kind = 'task' and me.can_task = true )
      or
      ( ri.kind <> 'task'
        and me.can_work = true
        and exists (
          -- group-aware capability match (else exact type) — identical to dispatch_for_item
          select 1 from public.operator_capabilities c
          where c.operator_id = v_op
            and c.kind = ri.kind
            and (
              case
                when t.match_group is not null then
                  c.trade_id in (select id from public.trades where match_group = t.match_group)
                else
                  c.type = ri.type
              end
            )
        )
        and not exists (
          -- every 'required' credential must be held, verified and unexpired
          select 1 from public.trade_requirements tr
          where tr.trade_id = ri.trade_id
            and tr.requirement = 'required'
            and not exists (
              select 1 from public.operator_credentials oc
              where oc.operator_id = v_op
                and oc.credential_id = tr.credential_id
                and oc.status = 'verified'
                and (oc.expires_at is null or oc.expires_at >= current_date)
            )
        )
      )
    );

  -- 1. Create any missing dispatch (the "job never reached me" fix).
  insert into public.dispatches (request_item_id, operator_id, status, wave)
  select item_id, v_op, 'sent', 1 from _eligible_items
  on conflict (request_item_id, operator_id) do nothing;
  get diagnostics v_ins = row_count;

  -- 2. Revive a system-expired dispatch when its spot has reopened (item is eligible again above).
  update public.dispatches d
    set status = 'sent'
    where d.operator_id = v_op
      and d.status = 'expired'
      and d.request_item_id in (select item_id from _eligible_items);
  get diagnostics v_rev = row_count;

  return v_ins + v_rev;
end $$;

grant execute on function refresh_my_dispatches() to authenticated;

notify pgrst, 'reload schema';
