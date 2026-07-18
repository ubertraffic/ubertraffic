-- 0052_job_proof_storage_lockdown.sql
-- Task 4 — lock the 'job-proof' storage bucket to a job's two parties (worker + client), keyed on
-- the assignment-id folder in the object path ({assignmentId}/{kind}-{stamp}.jpg).
-- Replaces the broad proof_read / proof_upload_own policies (any authenticated user could read/write).
-- Run by hand in the Supabase SQL editor. Order: helpers -> scoped policies -> drop broad policies
-- (so legitimate users are never locked out mid-migration). Service-role bypasses RLS (admin/Edge Fns).

create or replace function public.job_proof_party(p_folder text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from assignments a
    join request_items ri on ri.id = a.request_item_id
    join requests r on r.id = ri.request_id
    where a.id::text = p_folder
      and (a.operator_id = auth.uid() or r.client_id = auth.uid())
  );
$$;
grant execute on function public.job_proof_party(text) to authenticated;

create or replace function public.job_proof_owner(p_folder text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from assignments a
    where a.id::text = p_folder and a.operator_id = auth.uid()
  );
$$;
grant execute on function public.job_proof_owner(text) to authenticated;

create policy "job-proof read (parties)" on storage.objects
  for select to authenticated
  using ( bucket_id = 'job-proof' and public.job_proof_party((storage.foldername(name))[1]) );

create policy "job-proof write (worker)" on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'job-proof' and public.job_proof_owner((storage.foldername(name))[1]) );

drop policy proof_read on storage.objects;
drop policy proof_upload_own on storage.objects;
