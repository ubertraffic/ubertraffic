-- 0053_credential_fields.sql
-- Credentials Phase 1 — field-aware types. Additive only. Does NOT change the
-- verified+unexpired eligibility rule, so readiness / the accept-gate are unaffected.

alter table credential_types     add column if not exists expiry_rule text not null default 'optional'; -- 'none' | 'optional' | 'required'
alter table credential_types     add column if not exists requires_card_no boolean not null default false;
alter table operator_credentials add column if not exists card_number text;

-- Data-driven default: any type with a renewal period must carry an expiry (catches traffic tickets etc).
update credential_types set expiry_rule = 'required' where renews_years is not null and expiry_rule = 'optional';
-- White Card never expires.
update credential_types set expiry_rule = 'none' where id = 'white_card';
-- Driver licence needs a card number (+ issuing state) as well as the licence number.
update credential_types set requires_card_no = true where id = 'drivers_licence';
-- Self-declared public liability insurance should carry an expiry.
update credential_types set expiry_rule = 'required' where id = 'ins_public_liability';

-- REVIEW THE REST per type (advisor call). To see them all:
--   select id, name, tier, renews_years, expiry_rule, requires_card_no from credential_types order by sort;
