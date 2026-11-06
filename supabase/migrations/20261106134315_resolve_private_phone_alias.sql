-- Keep the private alias table outside the Data API. The Edge Function calls
-- this narrow service-role-only RPC through the already-exposed api schema.
create function api.resolve_login_phone_alias(p_phone_e164 text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select user_id
  from private.login_phone_aliases
  where phone_e164 = p_phone_e164
$$;

revoke all on function api.resolve_login_phone_alias(text) from public, anon, authenticated;
grant execute on function api.resolve_login_phone_alias(text) to service_role;
