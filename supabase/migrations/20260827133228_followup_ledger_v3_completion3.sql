-- Follow-up ledger v3 completion 3: reset any inherited legacy table grants
-- before granting the exact server-only permissions required by the ledger.

revoke all on table public.followup_jobs from service_role;
revoke all on table public.followup_messages from service_role;
revoke all on table public.followup_activity_logs from service_role;
revoke all on table public.followup_suppressions from service_role;
revoke all on table public.followup_runtime from service_role;

grant select, insert, update on table public.followup_jobs to service_role;
grant select, insert, update on table public.followup_messages to service_role;
grant select, insert on table public.followup_activity_logs to service_role;
grant select, insert, update on table public.followup_suppressions to service_role;
grant select, insert, update on table public.followup_runtime to service_role;
