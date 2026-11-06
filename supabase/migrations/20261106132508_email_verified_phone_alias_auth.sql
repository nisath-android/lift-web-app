-- Email-verified, phone-alias authentication for the closed pilot.
--
-- A phone number is deliberately *not* marked as verified in auth.users. It is
-- a private login alias only; a confirmed email is the account-recovery proof.
-- The service-only API function below atomically claims the alias so two users
-- can never share the same phone login.

create table private.login_phone_aliases (
  phone_e164 text primary key check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table private.login_phone_aliases enable row level security;

create trigger login_phone_aliases_set_updated_at
before update on private.login_phone_aliases
for each row execute function private.set_updated_at();

create function api.claim_login_phone_alias(
  p_user_id uuid,
  p_phone_e164 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_user_id uuid;
begin
  if p_user_id is null then
    raise exception using errcode = 'PT400', message = 'INVALID_USER_ID';
  end if;
  if p_phone_e164 is null or p_phone_e164 !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception using errcode = 'PT400', message = 'INVALID_PHONE_NUMBER';
  end if;

  select user_id into v_existing_user_id
  from private.login_phone_aliases
  where phone_e164 = p_phone_e164
  for update;

  if v_existing_user_id is not null and v_existing_user_id <> p_user_id then
    raise exception using errcode = 'PT409', message = 'PHONE_ALREADY_IN_USE';
  end if;

  delete from private.login_phone_aliases where user_id = p_user_id;

  insert into private.login_phone_aliases (phone_e164, user_id)
  values (p_phone_e164, p_user_id)
  on conflict (phone_e164) do update
  set user_id = excluded.user_id,
      updated_at = now();

  return jsonb_build_object('phoneE164', p_phone_e164);
end;
$$;

revoke all on table private.login_phone_aliases from public, anon, authenticated;
revoke all on function api.claim_login_phone_alias(uuid, text) from public, anon, authenticated;
grant execute on function api.claim_login_phone_alias(uuid, text) to service_role;
