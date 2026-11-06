-- Explicitly document the only database role that may use this private
-- internal table. All browser-facing roles remain denied by RLS and grants.
create policy "service role manages phone aliases"
on private.login_phone_aliases
for all
to service_role
using (true)
with check (true);
