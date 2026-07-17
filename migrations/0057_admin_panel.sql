-- 0057_admin_panel.sql
-- The admin panel's SERVER-SIDE security + tools. Run by hand in the Supabase SQL editor.
--
-- SECURITY MODEL (read this):
--   * Admin status lives in its OWN table `admins` with NO client write access. A user can only be
--     made an admin from the dashboard (service-role). Self-granting is structurally impossible —
--     there is deliberately no insert/update/delete policy for authenticated.
--   * is_admin() is SECURITY DEFINER so it can read `admins` regardless of the caller's grants.
--   * EVERY admin RPC below re-checks is_admin() first and raises 42501 if not. The app hiding the
--     panel is convenience; THIS is the real gate. No service-role key ever goes to the client.
--
-- NOTE: several status columns (account_type, worker/company_verify_status, request/assignment/
-- credential status) are Postgres ENUMs. We cast them to ::text in queries so the function return
-- types (declared text) match, and so a '' literal is never cast into an enum.
--
-- BOOTSTRAP (make yourself the admin — do this once, in the dashboard):
--   select id, email from auth.users;                       -- find your user id
--   insert into admins (user_id) values ('<your-user-id>'); -- grant yourself admin

-- ── admins table ─────────────────────────────────────────────────────────────
create table if not exists admins (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table admins enable row level security;
drop policy if exists "admins read self" on admins;
create policy "admins read self" on admins for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on admins from authenticated;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;
grant execute on function public.is_admin() to authenticated;

-- ── admins can read the private credential-evidence bucket (to review photo ID) ──
drop policy if exists "cred-evidence read (admin)" on storage.objects;
create policy "cred-evidence read (admin)" on storage.objects
  for select to authenticated
  using ( bucket_id = 'credential-evidence' and public.is_admin() );

alter table operator_credentials add column if not exists review_note text;

-- ── Overview counts ───────────────────────────────────────────────────────────
create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  select jsonb_build_object(
    'pending_credentials', (select count(*) from operator_credentials where status::text in ('review','pending')),
    'pending_abns',        (select count(*) from profiles
                              where (abn is not null and coalesce(abn_status::text,'') <> 'verified')
                                 or (company_abn is not null and coalesce(company_verify_status::text,'') <> 'verified')),
    'total_users',         (select count(*) from profiles),
    'workers_online',      (select count(*) from profiles where is_online = true),
    'active_jobs',         (select count(*) from requests where status::text not in ('complete','cancelled'))
  ) into r;
  return r;
end $$;
grant execute on function public.admin_overview() to authenticated;

-- ── Credential review queue ───────────────────────────────────────────────────
create or replace function public.admin_pending_credentials()
returns table (
  id uuid, operator_id uuid, credential_id text, worker_name text, legal_name text,
  date_of_birth date, number text, card_number text, state text, expires_at date,
  status text, evidence_url text, cred_name text, created_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return query
    select oc.id, oc.operator_id, oc.credential_id, p.full_name, p.legal_name, p.date_of_birth,
           oc.number, oc.card_number, oc.state, oc.expires_at, oc.status::text, oc.evidence_url,
           ct.name, oc.created_at
      from operator_credentials oc
      join profiles p on p.id = oc.operator_id
      left join credential_types ct on ct.id = oc.credential_id
     where oc.status::text in ('review','pending')
     order by oc.created_at asc;
end $$;
grant execute on function public.admin_pending_credentials() to authenticated;

create or replace function public.admin_decide_credential(p_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  update operator_credentials
     set status      = case when p_approve then 'verified' else 'unverified' end,
         verified_at = case when p_approve then now() else null end,
         review_note = p_note
   where id = p_id;
end $$;
grant execute on function public.admin_decide_credential(uuid, boolean, text) to authenticated;

-- ── Grant / remove credentials (admin override) ───────────────────────────────
create or replace function public.admin_grant_credential(p_operator_id uuid, p_credential_id text, p_number text default null, p_expires_at date default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into operator_credentials (operator_id, credential_id, number, expires_at, status, verified_at)
  values (p_operator_id, p_credential_id, p_number, p_expires_at, 'verified', now())
  on conflict (operator_id, credential_id) do update
     set status      = 'verified',
         verified_at = now(),
         number      = coalesce(excluded.number, operator_credentials.number),
         expires_at  = coalesce(excluded.expires_at, operator_credentials.expires_at);
end $$;
grant execute on function public.admin_grant_credential(uuid, text, text, date) to authenticated;

create or replace function public.admin_remove_credential(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  delete from operator_credentials where id = p_id;
end $$;
grant execute on function public.admin_remove_credential(uuid) to authenticated;

create or replace function public.admin_user_credentials(p_operator_id uuid)
returns table (id uuid, credential_id text, cred_name text, number text, expires_at date, status text, evidence_url text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return query
    select oc.id, oc.credential_id, ct.name, oc.number, oc.expires_at, oc.status::text, oc.evidence_url
      from operator_credentials oc
      left join credential_types ct on ct.id = oc.credential_id
     where oc.operator_id = p_operator_id
     order by ct.sort nulls last;
end $$;
grant execute on function public.admin_user_credentials(uuid) to authenticated;

-- ── ABN reviews ───────────────────────────────────────────────────────────────
create or replace function public.admin_pending_abns()
returns table (user_id uuid, name text, kind text, abn text, status text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return query
    select p.id, coalesce(p.full_name, p.legal_name), 'worker'::text, p.abn, p.abn_status::text
      from profiles p
     where p.abn is not null and coalesce(p.abn_status::text,'') <> 'verified'
    union all
    select p.id, coalesce(p.company_name, p.full_name), 'company'::text, p.company_abn, p.company_verify_status::text
      from profiles p
     where p.company_abn is not null and coalesce(p.company_verify_status::text,'') <> 'verified';
end $$;
grant execute on function public.admin_pending_abns() to authenticated;

create or replace function public.admin_decide_abn(p_user_id uuid, p_kind text, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_kind = 'worker' then
    update profiles set abn_status = case when p_approve then 'verified' else 'valid' end where id = p_user_id;
  elsif p_kind = 'company' then
    update profiles
       set company_verify_status = case when p_approve then 'verified'::verify_status else null end,
           can_hire              = case when p_approve then true else can_hire end
     where id = p_user_id;
  end if;
end $$;
grant execute on function public.admin_decide_abn(uuid, text, boolean) to authenticated;

-- ── User lookup ───────────────────────────────────────────────────────────────
create or replace function public.admin_search_users(p_q text)
returns table (id uuid, name text, account_type text, can_work boolean, can_hire boolean,
               worker_verify_status text, company_verify_status text, abn text, abn_status text,
               is_online boolean, rating numeric, rating_count int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return query
    select p.id, coalesce(p.full_name, p.legal_name, p.company_name), p.account_type::text,
           p.can_work, p.can_hire, p.worker_verify_status::text, p.company_verify_status::text,
           p.abn, p.abn_status::text, p.is_online, p.rating::numeric, p.rating_count::int
      from profiles p
     where p_q is null or p_q = ''
        or coalesce(p.full_name,'')    ilike '%'||p_q||'%'
        or coalesce(p.legal_name,'')   ilike '%'||p_q||'%'
        or coalesce(p.company_name,'') ilike '%'||p_q||'%'
     order by p.full_name nulls last
     limit 25;
end $$;
grant execute on function public.admin_search_users(text) to authenticated;

-- ── Ops health (read-only) ────────────────────────────────────────────────────
create or replace function public.admin_active_jobs()
returns table (id uuid, status text, address_text text, created_at timestamptz, items bigint, filled bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return query
    select r.id, r.status::text, r.address_text, r.created_at,
           (select count(*) from request_items ri where ri.request_id = r.id),
           (select count(*) from assignments a
              join request_items ri on ri.id = a.request_item_id
             where ri.request_id = r.id
               and a.status::text in ('committed','accepted','en_route','on_site','complete','approved'))
      from requests r
     where r.status::text not in ('complete','cancelled')
     order by r.created_at desc
     limit 50;
end $$;
grant execute on function public.admin_active_jobs() to authenticated;
