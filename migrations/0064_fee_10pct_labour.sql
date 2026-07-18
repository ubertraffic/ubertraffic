-- 0064_fee_10pct_labour.sql
-- Align the RECORDED settlement with the live Stripe model. Previously all three settlement paths
-- recorded a flat 12% platform fee on everything, while Stripe actually pays workers on a 10%-of-
-- labour model — so the app displayed 12% but paid 10%. This replaces the fee math in the three
-- settlement functions with the correct model:
--   • Labour (price_mode <> 'job'): 10% platform fee (worker keeps 90%).
--   • Tasks  (price_mode  = 'job'): 0% fee (worker keeps 100%; the $3 booking fee is charged
--     client-side at checkout, never deducted from the worker).
--   • Tips / travel / bonus / materials: 0% (already fee-free — unchanged).
-- Only the fee computation changes; signatures, SECURITY DEFINER, and search_path are preserved.
-- Historical settled rows are NOT recomputed — they were genuinely settled at their old figures.
-- Run by hand in the Supabase SQL editor.

CREATE OR REPLACE FUNCTION public._settle_request(p_request_id uuid, p_state text)
 RETURNS requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req    public.requests;
  v_hours  numeric;
  v_total  numeric := 0;
  v_fee    numeric := 0;
  v_net    numeric := 0;
  v_adj    numeric := 0;
  v_mats   numeric := 0;
  v_anchor uuid;
begin
  select * into v_req from public.requests where id = p_request_id for update;
  if not found then raise exception 'request_not_found' using errcode='P0002'; end if;
  if v_req.settled_at is not null then return v_req; end if;

  v_hours := coalesce(v_req.duration_hours, 4) + coalesce(v_req.adj_extra_hours, 0);

  update public.assignments a
    set gross_amount = g.gross,
        fee_amount   = g.fee,
        net_amount   = g.gross - g.fee,
        paid_at      = now(),
        status       = 'approved'
  from (
    select a2.id,
           case when ri.price_mode = 'job'
                then coalesce(ri.rate, ri.rate_offered, 0)
                else coalesce(ri.rate, ri.rate_offered, rc.hourly, 0) * v_hours end as gross,
           -- 10% platform fee on LABOUR only; tasks (price_mode='job') keep 100%.
           case when ri.price_mode = 'job'
                then 0
                else round((coalesce(ri.rate, ri.rate_offered, rc.hourly, 0) * v_hours) * 0.10, 2) end as fee
    from public.assignments a2
    join public.request_items ri on ri.id = a2.request_item_id
    left join public.rate_card rc on rc.type = ri.type
    where ri.request_id = p_request_id and a2.status in ('complete','approved')
  ) g
  where a.id = g.id;

  select coalesce(sum(gross_amount),0), coalesce(sum(fee_amount),0), coalesce(sum(net_amount),0)
    into v_total, v_fee, v_net
  from public.assignments a join public.request_items ri on ri.id = a.request_item_id
  where ri.request_id = p_request_id and a.status = 'approved';

  -- upward adjustments: travel + tip + bonus (100% to worker, no fee)
  v_adj := coalesce(v_req.adj_travel,0) + coalesce(v_req.adj_tip,0) + coalesce(v_req.adj_bonus,0);

  -- approved materials: 100% reimbursement, no fee (worker's out-of-pocket spend)
  select coalesce(sum(amount),0) into v_mats
  from public.material_claims
  where request_id = p_request_id and status = 'approved';

  v_net   := v_net + v_adj + v_mats;
  v_total := v_total + v_adj + v_mats;

  update public.requests
    set status = 'complete', approved_at = now(), settled_at = now(),
        completion_state = p_state,
        settle_total = v_total, settle_fee = v_fee, settle_net = v_net,
        materials_total = v_mats
    where id = p_request_id
    returning * into v_req;

  select a.id into v_anchor
  from public.assignments a join public.request_items ri on ri.id = a.request_item_id
  where ri.request_id = p_request_id and a.status = 'approved' limit 1;

  if v_anchor is not null then
    begin
      perform public.log_job_event(v_anchor, 'transition', 'complete',
        case when p_state = 'auto_approved' then 'auto_paid' else 'paid' end,
        null, null, null,
        jsonb_build_object('net', v_net, 'total', v_total, 'adj', v_adj, 'materials', v_mats, 'state', p_state));
    exception when others then null;
    end;
  end if;

  return v_req;
end $function$;

CREATE OR REPLACE FUNCTION public.sc_auto_approve()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req record; v_hours numeric; v_total numeric; v_fee numeric; v_net numeric;
  v_spots integer; v_done integer; v_count integer := 0;
  v_cutoff timestamptz := now() - (public.sc_auto_approve_hours() || ' hours')::interval;
begin
  for v_req in select r.id, r.duration_hours from public.requests r
               where r.status <> 'complete' and r.approved_at is null
  loop
    select count(*) into v_spots from public.assignments a
      join public.request_items ri on ri.id = a.request_item_id where ri.request_id = v_req.id;
    select count(*) into v_done from public.assignments a
      join public.request_items ri on ri.id = a.request_item_id where ri.request_id = v_req.id and a.status='complete';
    if v_spots = 0 or v_done < v_spots then continue; end if;
    if exists (select 1 from public.assignments a
      join public.request_items ri on ri.id = a.request_item_id
      where ri.request_id = v_req.id and (a.completed_at is null or a.completed_at > v_cutoff)) then continue; end if;

    v_hours := coalesce(v_req.duration_hours, 4);
    select coalesce(sum(
      case when ri.price_mode = 'job' then coalesce(ri.rate,0)
           else coalesce(ri.rate, rc.hourly, 0) * v_hours end
    ),0) into v_total
    from public.assignments a
    join public.request_items ri on ri.id = a.request_item_id
    left join public.rate_card rc on rc.type = ri.type
    where ri.request_id = v_req.id and a.status='complete';

    -- 10% platform fee on LABOUR only; tasks (price_mode='job') keep 100%.
    select coalesce(sum(
      case when ri.price_mode = 'job' then 0
           else round((coalesce(ri.rate, rc.hourly, 0) * v_hours) * 0.10, 2) end
    ),0) into v_fee
    from public.assignments a
    join public.request_items ri on ri.id = a.request_item_id
    left join public.rate_card rc on rc.type = ri.type
    where ri.request_id = v_req.id and a.status='complete';
    v_net := v_total - v_fee;

    update public.requests set status='complete', approved_at=now(), settled_at=now(),
      settle_total=v_total, settle_fee=v_fee, settle_net=v_net where id = v_req.id;

    insert into public.job_events (assignment_id, actor_id, kind, from_status, to_status, context)
    select a.id, null, 'auto_approved', 'complete', 'approved',
           jsonb_build_object('reason','client_no_response','window_hours', public.sc_auto_approve_hours())
    from public.assignments a join public.request_items ri on ri.id = a.request_item_id
    where ri.request_id = v_req.id and a.status='complete';
    v_count := v_count + 1;
  end loop;
  return v_count;
end $function$;

CREATE OR REPLACE FUNCTION public.sim_settle(p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req public.requests; v_hours numeric; v_spots int; v_done int;
  v_total numeric := 0; v_fee numeric; v_net numeric;
begin
  select * into v_req from public.requests where id = p_request_id for update;
  if not found or v_req.is_sim = false then return; end if;
  if v_req.status = 'complete' or v_req.approved_at is not null then return; end if;
  v_hours := coalesce(v_req.duration_hours, 4);
  select count(*) into v_spots from public.assignments a
    join public.request_items ri on ri.id = a.request_item_id
    where ri.request_id = p_request_id and a.status <> 'cancelled';
  select count(*) into v_done from public.assignments a
    join public.request_items ri on ri.id = a.request_item_id
    where ri.request_id = p_request_id and a.status = 'complete';
  if v_spots = 0 or v_done < v_spots then return; end if;
  select coalesce(sum(
           case when ri.price_mode = 'job'
                then coalesce(ri.rate, ri.rate_offered, 0)
                else coalesce(ri.rate, ri.rate_offered, rc.hourly, 0) * v_hours end
         ),0) into v_total
  from public.assignments a
  join public.request_items ri on ri.id = a.request_item_id
  left join public.rate_card rc on rc.type = ri.type
  where ri.request_id = p_request_id and a.status = 'complete';

  -- 10% platform fee on LABOUR only; tasks (price_mode='job') keep 100%.
  select coalesce(sum(
           case when ri.price_mode = 'job' then 0
                else round((coalesce(ri.rate, ri.rate_offered, rc.hourly, 0) * v_hours) * 0.10, 2) end
         ),0) into v_fee
  from public.assignments a
  join public.request_items ri on ri.id = a.request_item_id
  left join public.rate_card rc on rc.type = ri.type
  where ri.request_id = p_request_id and a.status = 'complete';
  v_net := v_total - v_fee;

  update public.requests
    set status='complete', approved_at=now(), settled_at=now(),
        settle_total=v_total, settle_fee=v_fee, settle_net=v_net
    where id = p_request_id;
end $function$;

notify pgrst, 'reload schema';
