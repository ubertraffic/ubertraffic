-- 0059_admin_user_vehicles.sql
-- Admin panel: read a user's vehicles (rego + insurance) in their detail view. Admin-gated
-- SECURITY DEFINER, same pattern as the other admin_* RPCs (0057). Requires operator_vehicles
-- (0058) and is_admin() (0057). Run by hand in the Supabase SQL editor.

create or replace function public.admin_user_vehicles(p_operator_id uuid)
returns table (id uuid, type text, make_model text, rego text, rego_expires date, insurer text, insurance_expires date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return query
    select v.id, v.type, v.make_model, v.rego, v.rego_expires, v.insurer, v.insurance_expires
      from operator_vehicles v
     where v.operator_id = p_operator_id
     order by v.created_at asc;
end $$;
grant execute on function public.admin_user_vehicles(uuid) to authenticated;
