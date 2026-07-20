-- 0072_credential_status_constraint.sql
-- Fix: "new row for relation operator_credentials violates check constraint
-- operator_credentials_status_check".
--
-- operator_credentials.status is a TEXT column guarded by a CHECK constraint that was created in an
-- early (pre-0046, untracked) migration with only a SUBSET of the values the app actually uses.
-- The credential lifecycle the codebase writes is:
--   • 'unverified' — self-declared / on-file, or an admin reject      (credentialsService.addMyCredential; verify_credential reject)
--   • 'pending'    — submitted for verification, awaiting review       (submit_credential RPC; admin queue query)
--   • 'review'     — photo evidence uploaded, awaiting an admin's eyes (credentialsService.uploadCredentialEvidence; verify-credential)
--   • 'verified'   — approved (unlocks the accept-gate)                (verify_credential approve)
-- ('expired' is computed in the UI from expires_at — never stored — but we allow it for safety, and
--  'rejected' is reserved for a future explicit-reject state.)
--
-- We drop the stale constraint and re-add it covering the whole set. Adding extra allowed values is
-- harmless (a CHECK only rejects; it never coerces). NULL passes a CHECK, so any legacy NULL rows are
-- unaffected. This is idempotent — safe to run more than once.

alter table operator_credentials drop constraint if exists operator_credentials_status_check;

alter table operator_credentials
  add constraint operator_credentials_status_check
  check (status in ('unverified', 'pending', 'review', 'verified', 'expired', 'rejected'));

notify pgrst, 'reload schema';
