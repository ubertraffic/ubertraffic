-- 0070_invoice_sellers.sql
-- A compliant tax invoice must show the SELLER's (worker's) business name + ABN, and — for licensed
-- NSW building work — their contractor licence number. The worker's ABN is column-locked (0067), so we
-- expose it ONLY for a specific job, ONLY to that job's parties, through this SECURITY DEFINER function:
--   • the job's CLIENT sees every completed worker's seller details (they're the buyer, they get the invoice)
--   • a WORKER sees only their OWN row (never a co-worker's ABN)
-- Licence = the most-recent verified licence-type credential's card number (best-effort; null if none).

create or replace function get_invoice_sellers(p_request_id uuid)
returns table (operator_id uuid, name text, abn text, licence text, gst_registered boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.abn,
    (select oc.card_number
       from operator_credentials oc
       where oc.operator_id = p.id
         and oc.credential_id like 'lic%'
         and oc.card_number is not null
         and oc.status = 'verified'
       order by oc.verified_at desc nulls last
       limit 1) as licence,
    p.gst_registered
  from request_items ri
  join assignments a on a.request_item_id = ri.id
  join profiles p    on p.id = a.operator_id
  where ri.request_id = p_request_id
    and a.status in ('complete', 'approved')
    and (
      exists (select 1 from requests r where r.id = p_request_id and r.client_id = auth.uid())  -- client → all sellers
      or p.id = auth.uid()                                                                       -- worker → own row only
    )
  group by p.id, p.full_name, p.abn, p.gst_registered;
$$;

grant execute on function get_invoice_sellers(uuid) to authenticated;

notify pgrst, 'reload schema';
