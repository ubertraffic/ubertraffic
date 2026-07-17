-- 0056_credential_evidence_bucket.sql
-- Phase 3 #3 — a private evidence store for credentials with NO free register API (driver's
-- licence, HRWL, insurance, trade licences). The worker uploads a photo of the card; it lands the
-- credential 'review' (see credentialsService.setCredentialEvidence) — NEVER auto-verified. Only an
-- admin flips it to 'verified' after seeing the image, and the accept-gate still needs 'verified',
-- so nothing unlocks by uploading.
--
-- SECURITY: this bucket holds photo ID — sensitive PII and a honeypot. It is PRIVATE and strictly
-- OWNER-ONLY: a client can NEVER read a worker's ID. Objects are keyed on the operator's own id
-- folder: {operator_id}/{credential_id}.jpg. Service-role (admin / Edge Functions) bypasses RLS.
-- Run by hand in the Supabase SQL editor.

-- 1) the bucket (private)
insert into storage.buckets (id, name, public)
values ('credential-evidence', 'credential-evidence', false)
on conflict (id) do nothing;

-- 2) owner-only policies — the first path segment must equal the caller's own uid
create policy "cred-evidence read (owner)" on storage.objects
  for select to authenticated
  using ( bucket_id = 'credential-evidence' and (storage.foldername(name))[1] = auth.uid()::text );

create policy "cred-evidence insert (owner)" on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'credential-evidence' and (storage.foldername(name))[1] = auth.uid()::text );

create policy "cred-evidence update (owner)" on storage.objects
  for update to authenticated
  using ( bucket_id = 'credential-evidence' and (storage.foldername(name))[1] = auth.uid()::text )
  with check ( bucket_id = 'credential-evidence' and (storage.foldername(name))[1] = auth.uid()::text );

create policy "cred-evidence delete (owner)" on storage.objects
  for delete to authenticated
  using ( bucket_id = 'credential-evidence' and (storage.foldername(name))[1] = auth.uid()::text );

-- RETENTION (recommended, do it admin-side — NOT from the client):
--   once an admin has verified a credential, DELETE its evidence object. Afterwards you only need
--   the 'verified' flag + verified_at, not the image — deleting it shrinks the honeypot to nothing.
--   e.g.  delete from storage.objects
--         where bucket_id = 'credential-evidence' and name = '<operator_id>/<credential_id>.jpg';
