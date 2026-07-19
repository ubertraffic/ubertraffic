-- 0068_grant_authenticated_dml.sql
-- Several tables the app reads/writes DIRECTLY (not through a SECURITY DEFINER RPC) have RLS policies
-- but were missing the underlying GRANT to `authenticated` — so any direct query returned
-- "permission denied for table X" (this is what broke "Add a vehicle": operator_vehicles). RLS still
-- gates every row; these grants only let the role ATTEMPT the operation its policy already governs.
-- Same root cause as the payouts migration slipping through. Idempotent — safe to re-run.

grant select, insert, update, delete on operator_vehicles to authenticated;  -- policy "vehicles owner all"
grant select on payments to authenticated;                                   -- policy "payments owner read"
grant select on payouts  to authenticated;                                   -- policy "payouts owner read"
grant select on ratings  to authenticated;                                   -- policy "ratings_select_own" (writes via submit_rating)
grant select, insert on material_claims to authenticated;                    -- op insert + party select policies
grant select, insert on error_log to authenticated;                          -- insert_own + select_own policies

notify pgrst, 'reload schema';
