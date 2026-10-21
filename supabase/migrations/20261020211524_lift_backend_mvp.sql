-- Lift backend MVP: Auth-owned identity, planned-route matching, transactional
-- capacity, a server-enforced trip lifecycle, and closed-pilot operations.
--
-- The browser receives only the Supabase URL and publishable key. All domain
-- writes travel through functions in the `api` schema; no client can mutate
-- capacity, approval, OTP hashes, state transitions, or audit data directly.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
create schema if not exists api;

create type public.app_role as enum ('PASSENGER', 'DRIVER', 'OPS');
create type public.driver_approval_status as enum ('PENDING', 'APPROVED', 'SUSPENDED', 'REJECTED');
create type public.route_state as enum ('DRAFT', 'PUBLISHED', 'DEPARTED', 'COMPLETED', 'CANCELLED');
create type public.request_state as enum ('OPEN', 'MATCHED', 'BOOKED', 'COMPLETED', 'CANCELLED', 'EXPIRED');
create type public.match_run_state as enum ('RUNNING', 'COMPLETED', 'FAILED');
create type public.candidate_decision as enum (
  'ELIGIBLE',
  'DRIVER_NOT_APPROVED',
  'ROUTE_UNAVAILABLE',
  'OUTSIDE_ROUTE',
  'UNAPPROVED_STOP',
  'WRONG_DIRECTION',
  'PICKUP_BEHIND_DRIVER',
  'CAPACITY_EXHAUSTED',
  'TIME_WINDOW_MISS',
  'ROUTE_VERSION_CHANGED',
  'OFFER_EXPIRED'
);
create type public.offer_state as enum ('PENDING', 'SELECTED', 'ACCEPTED', 'DECLINED', 'STALE', 'EXPIRED', 'CANCELLED');
create type public.booking_state as enum ('DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'OTP_VERIFIED', 'DROP_PROPOSED', 'COMPLETED', 'CANCELLED');
create type public.reservation_state as enum ('HELD', 'RELEASED');
create type public.incident_severity as enum ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
create type public.incident_state as enum ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'CLOSED');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (char_length(trim(display_name)) between 1 and 80),
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references public.profiles(id) on delete restrict,
  role public.app_role not null,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.driver_profiles (
  user_id uuid primary key references public.profiles(id) on delete restrict,
  approval_status public.driver_approval_status not null default 'PENDING',
  approval_reason text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (approval_status = 'PENDING' and reviewed_at is null)
    or approval_status <> 'PENDING'
  )
);

create table public.places (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  latitude numeric(9, 6) not null check (latitude between -90 and 90),
  longitude numeric(9, 6) not null check (longitude between -180 and 180),
  approved_pickup boolean not null default true,
  approved_drop boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (approved_pickup or approved_drop)
);

create table public.driver_routes (
  id uuid primary key default extensions.gen_random_uuid(),
  driver_id uuid not null references public.profiles(id) on delete restrict,
  departure_at timestamptz not null,
  state public.route_state not null default 'DRAFT',
  seat_capacity smallint not null check (seat_capacity between 1 and 4),
  seat_reserved smallint not null default 0 check (seat_reserved between 0 and seat_capacity),
  current_stop_sequence smallint not null default -1 check (current_stop_sequence >= -1),
  version integer not null default 1 check (version > 0),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state = 'DRAFT' and published_at is null) or (state <> 'DRAFT' and published_at is not null))
);

create table public.route_stops (
  id uuid primary key default extensions.gen_random_uuid(),
  route_id uuid not null references public.driver_routes(id) on delete restrict,
  place_id uuid not null references public.places(id) on delete restrict,
  sequence smallint not null check (sequence >= 0),
  planned_eta timestamptz not null,
  cumulative_m integer not null check (cumulative_m >= 0),
  pickup_allowed boolean not null,
  drop_allowed boolean not null,
  created_at timestamptz not null default now(),
  unique (route_id, id),
  unique (route_id, sequence),
  unique (route_id, place_id),
  check (pickup_allowed or drop_allowed)
);

create table public.ride_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  passenger_id uuid not null references public.profiles(id) on delete restrict,
  pickup_place_id uuid not null references public.places(id) on delete restrict,
  drop_place_id uuid not null references public.places(id) on delete restrict,
  earliest_departure_at timestamptz not null,
  latest_departure_at timestamptz not null,
  seat_qty smallint not null check (seat_qty between 1 and 2),
  state public.request_state not null default 'OPEN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (pickup_place_id <> drop_place_id),
  check (latest_departure_at >= earliest_departure_at)
);

create table public.match_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  request_id uuid not null references public.ride_requests(id) on delete restrict,
  initiated_by uuid not null references public.profiles(id) on delete restrict,
  state public.match_run_state not null default 'RUNNING',
  input_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(input_snapshot) = 'object'),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.match_candidates (
  id uuid primary key default extensions.gen_random_uuid(),
  match_run_id uuid not null references public.match_runs(id) on delete restrict,
  request_id uuid not null references public.ride_requests(id) on delete restrict,
  route_id uuid not null references public.driver_routes(id) on delete restrict,
  pickup_stop_id uuid,
  drop_stop_id uuid,
  route_version integer not null check (route_version > 0),
  pickup_eta timestamptz,
  drop_eta timestamptz,
  decision public.candidate_decision not null,
  score smallint check (score between 0 and 100),
  reason_codes jsonb not null default '[]'::jsonb check (jsonb_typeof(reason_codes) = 'array'),
  created_at timestamptz not null default now(),
  unique (match_run_id, route_id),
  foreign key (route_id, pickup_stop_id) references public.route_stops(route_id, id) on delete restrict,
  foreign key (route_id, drop_stop_id) references public.route_stops(route_id, id) on delete restrict,
  check (
    decision <> 'ELIGIBLE'
    or (pickup_stop_id is not null and drop_stop_id is not null and score is not null and pickup_eta is not null and drop_eta is not null)
  )
);

create table public.ride_offers (
  id uuid primary key default extensions.gen_random_uuid(),
  match_run_id uuid not null references public.match_runs(id) on delete restrict,
  request_id uuid not null references public.ride_requests(id) on delete restrict,
  route_id uuid not null references public.driver_routes(id) on delete restrict,
  pickup_stop_id uuid not null,
  drop_stop_id uuid not null,
  route_version integer not null check (route_version > 0),
  seat_qty smallint not null check (seat_qty between 1 and 2),
  score smallint not null check (score between 0 and 100),
  pickup_eta timestamptz not null,
  drop_eta timestamptz not null,
  expires_at timestamptz not null,
  state public.offer_state not null default 'PENDING',
  selected_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (route_id, pickup_stop_id) references public.route_stops(route_id, id) on delete restrict,
  foreign key (route_id, drop_stop_id) references public.route_stops(route_id, id) on delete restrict,
  check (drop_eta > pickup_eta),
  check (expires_at > created_at)
);

create table public.bookings (
  id uuid primary key default extensions.gen_random_uuid(),
  offer_id uuid not null unique references public.ride_offers(id) on delete restrict,
  request_id uuid not null unique references public.ride_requests(id) on delete restrict,
  route_id uuid not null references public.driver_routes(id) on delete restrict,
  passenger_id uuid not null references public.profiles(id) on delete restrict,
  driver_id uuid not null references public.profiles(id) on delete restrict,
  pickup_stop_id uuid not null,
  drop_stop_id uuid not null,
  route_version integer not null check (route_version > 0),
  seat_qty smallint not null check (seat_qty between 1 and 2),
  state public.booking_state not null default 'DRIVER_EN_ROUTE',
  driver_arrived_at timestamptz,
  otp_verified_at timestamptz,
  drop_proposed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (route_id, pickup_stop_id) references public.route_stops(route_id, id) on delete restrict,
  foreign key (route_id, drop_stop_id) references public.route_stops(route_id, id) on delete restrict
);

create table public.capacity_reservations (
  id uuid primary key default extensions.gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete restrict,
  route_id uuid not null references public.driver_routes(id) on delete restrict,
  seat_qty smallint not null check (seat_qty between 1 and 2),
  state public.reservation_state not null default 'HELD',
  released_at timestamptz,
  created_at timestamptz not null default now(),
  check ((state = 'HELD' and released_at is null) or (state = 'RELEASED' and released_at is not null))
);

create table public.pickup_challenges (
  booking_id uuid primary key references public.bookings(id) on delete restrict,
  otp_hash text not null,
  attempts smallint not null default 0 check (attempts between 0 and 3),
  max_attempts smallint not null default 3 check (max_attempts = 3),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create table public.booking_events (
  id uuid primary key default extensions.gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  event_type text not null check (event_type ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  actor_id uuid references public.profiles(id) on delete set null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz not null default now()
);

create table public.audit_events (
  id uuid primary key default extensions.gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  entity_type text not null check (entity_type ~ '^[a-z][a-z0-9_]{1,63}$'),
  entity_id uuid,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  occurred_at timestamptz not null default now()
);

create table public.idempotency_keys (
  actor_id uuid not null references public.profiles(id) on delete restrict,
  operation text not null check (operation ~ '^[a-z][a-z0-9_]{2,63}$'),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$'),
  request_hash bytea not null,
  response_body jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (actor_id, operation, idempotency_key)
);

create table public.incidents (
  id uuid primary key default extensions.gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete restrict,
  booking_id uuid references public.bookings(id) on delete restrict,
  route_id uuid references public.driver_routes(id) on delete restrict,
  category text not null check (category ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  severity public.incident_severity not null,
  description text not null check (char_length(trim(description)) between 10 and 2000),
  state public.incident_state not null default 'OPEN',
  assigned_to uuid references public.profiles(id) on delete set null,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolution text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state in ('RESOLVED', 'CLOSED') and resolved_at is not null) or (state not in ('RESOLVED', 'CLOSED')))
);

create index driver_routes_active_idx on public.driver_routes (departure_at, id) where state in ('PUBLISHED', 'DEPARTED');
create index route_stops_route_sequence_idx on public.route_stops (route_id, sequence);
create index ride_requests_passenger_idx on public.ride_requests (passenger_id, created_at desc);
create index match_runs_request_idx on public.match_runs (request_id, created_at desc);
create index match_candidates_run_idx on public.match_candidates (match_run_id, decision, score desc nulls last);
create index ride_offers_request_idx on public.ride_offers (request_id, state, expires_at);
create index bookings_route_state_idx on public.bookings (route_id, state);
create index bookings_passenger_idx on public.bookings (passenger_id, created_at desc);
create index booking_events_booking_idx on public.booking_events (booking_id, occurred_at);
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id, occurred_at desc);
create index incidents_state_idx on public.incidents (state, severity, created_at desc);

create function private.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function private.prevent_immutable_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = 'PT403', message = 'IMMUTABLE_EVENT_LOG';
end;
$$;

create function private.enforce_forward_stop_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pickup_sequence smallint;
  v_drop_sequence smallint;
begin
  select sequence into v_pickup_sequence
  from public.route_stops
  where route_id = new.route_id and id = new.pickup_stop_id;
  select sequence into v_drop_sequence
  from public.route_stops
  where route_id = new.route_id and id = new.drop_stop_id;

  if v_pickup_sequence is null or v_drop_sequence is null or v_pickup_sequence >= v_drop_sequence then
    raise exception using errcode = 'PT409', message = 'PICKUP_MUST_PRECEDE_DROP';
  end if;
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function private.set_updated_at();
create trigger driver_profiles_set_updated_at before update on public.driver_profiles
for each row execute function private.set_updated_at();
create trigger places_set_updated_at before update on public.places
for each row execute function private.set_updated_at();
create trigger driver_routes_set_updated_at before update on public.driver_routes
for each row execute function private.set_updated_at();
create trigger ride_requests_set_updated_at before update on public.ride_requests
for each row execute function private.set_updated_at();
create trigger ride_offers_set_updated_at before update on public.ride_offers
for each row execute function private.set_updated_at();
create trigger ride_offers_forward_stop_order before insert or update on public.ride_offers
for each row execute function private.enforce_forward_stop_order();
create trigger bookings_set_updated_at before update on public.bookings
for each row execute function private.set_updated_at();
create trigger bookings_forward_stop_order before insert or update on public.bookings
for each row execute function private.enforce_forward_stop_order();
create trigger idempotency_keys_set_updated_at before update on public.idempotency_keys
for each row execute function private.set_updated_at();
create trigger incidents_set_updated_at before update on public.incidents
for each row execute function private.set_updated_at();
create trigger booking_events_immutable before update or delete on public.booking_events
for each row execute function private.prevent_immutable_mutation();
create trigger audit_events_immutable before update or delete on public.audit_events
for each row execute function private.prevent_immutable_mutation();

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, phone_e164)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Lift member'
    ),
    nullif(new.phone, '')
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'PASSENGER')
  on conflict do nothing;

  return new;
end;
$$;

insert into public.profiles (id, display_name, phone_e164)
select
  u.id,
  coalesce(
    nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'Lift member'
  ),
  nullif(u.phone, '')
from auth.users u
on conflict (id) do nothing;

insert into public.user_roles (user_id, role)
select p.id, 'PASSENGER'
from public.profiles p
on conflict do nothing;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

create function private.current_actor_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
begin
  v_actor_id := auth.uid();
  if v_actor_id is null then
    raise exception using errcode = 'PT401', message = 'AUTH_REQUIRED';
  end if;
  return v_actor_id;
end;
$$;

create function private.current_user_is_ops()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles roles
    where roles.user_id = auth.uid()
      and roles.role = 'OPS'
  );
$$;

create function private.require_role(p_actor_id uuid, p_role public.app_role)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.user_roles roles
    where roles.user_id = p_actor_id
      and roles.role = p_role
  ) then
    raise exception using errcode = 'PT403', message = 'ROLE_REQUIRED';
  end if;
end;
$$;

create function private.require_approved_driver(p_actor_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_role(p_actor_id, 'DRIVER');

  if not exists (
    select 1
    from public.driver_profiles drivers
    where drivers.user_id = p_actor_id
      and drivers.approval_status = 'APPROVED'
  ) then
    raise exception using errcode = 'PT403', message = 'DRIVER_NOT_APPROVED';
  end if;
end;
$$;

create function private.claim_idempotency(
  p_actor_id uuid,
  p_operation text,
  p_idempotency_key text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.idempotency_keys%rowtype;
  v_hash bytea;
begin
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$' then
    raise exception using errcode = 'PT400', message = 'INVALID_IDEMPOTENCY_KEY';
  end if;

  v_hash := extensions.digest(convert_to(coalesce(p_payload, '{}'::jsonb)::text, 'utf8'), 'sha256');

  insert into public.idempotency_keys (actor_id, operation, idempotency_key, request_hash)
  values (p_actor_id, p_operation, p_idempotency_key, v_hash)
  on conflict (actor_id, operation, idempotency_key)
  do update set updated_at = now()
  returning * into v_row;

  if v_row.request_hash <> v_hash then
    raise exception using errcode = 'PT409', message = 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD';
  end if;

  return v_row.response_body;
end;
$$;

create function private.complete_idempotency(
  p_actor_id uuid,
  p_operation text,
  p_idempotency_key text,
  p_response jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.idempotency_keys
  set response_body = p_response
  where actor_id = p_actor_id
    and operation = p_operation
    and idempotency_key = p_idempotency_key;

  if not found then
    raise exception using errcode = 'PT409', message = 'IDEMPOTENCY_CONTEXT_MISSING';
  end if;
end;
$$;

create function private.append_audit(
  p_actor_id uuid,
  p_event_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_data jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, data)
  values (p_actor_id, p_event_type, p_entity_type, p_entity_id, coalesce(p_data, '{}'::jsonb));
end;
$$;

create function private.append_booking_event(
  p_booking_id uuid,
  p_actor_id uuid,
  p_event_type text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.booking_events (booking_id, actor_id, event_type, payload)
  values (p_booking_id, p_actor_id, p_event_type, coalesce(p_payload, '{}'::jsonb));
end;
$$;

create function private.release_capacity(
  p_booking_id uuid,
  p_route_id uuid,
  p_seat_qty smallint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.capacity_reservations
  set state = 'RELEASED', released_at = now()
  where booking_id = p_booking_id
    and route_id = p_route_id
    and state = 'HELD';

  if found then
    update public.driver_routes
    set seat_reserved = seat_reserved - p_seat_qty,
        version = version + 1
    where id = p_route_id
      and seat_reserved >= p_seat_qty;

    if not found then
      raise exception using errcode = 'PT409', message = 'CAPACITY_LEDGER_INCONSISTENT';
    end if;
  end if;
end;
$$;

-- Driver route commands -----------------------------------------------------

create function api.create_route(
  p_departure_at timestamptz,
  p_seat_capacity smallint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_route_id uuid;
  v_existing jsonb;
  v_response jsonb;
begin
  v_actor_id := private.current_actor_id();
  v_existing := private.claim_idempotency(
    v_actor_id,
    'create_route',
    p_idempotency_key,
    jsonb_build_object('departureAt', p_departure_at, 'seatCapacity', p_seat_capacity)
  );
  if v_existing is not null then return v_existing; end if;

  perform private.require_approved_driver(v_actor_id);

  if p_departure_at is null or p_departure_at <= now() + interval '5 minutes' then
    raise exception using errcode = 'PT400', message = 'INVALID_DEPARTURE_TIME';
  end if;
  if p_seat_capacity is null or p_seat_capacity not between 1 and 4 then
    raise exception using errcode = 'PT400', message = 'INVALID_SEAT_CAPACITY';
  end if;

  insert into public.driver_routes (driver_id, departure_at, seat_capacity)
  values (v_actor_id, p_departure_at, p_seat_capacity)
  returning id into v_route_id;

  v_response := jsonb_build_object('routeId', v_route_id, 'state', 'DRAFT', 'version', 1);
  perform private.append_audit(v_actor_id, 'ROUTE_CREATED', 'driver_route', v_route_id, v_response);
  perform private.complete_idempotency(v_actor_id, 'create_route', p_idempotency_key, v_response);
  return v_response;
end;
$$;

create function api.add_route_stop(
  p_route_id uuid,
  p_place_id uuid,
  p_planned_eta timestamptz,
  p_cumulative_m integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_route public.driver_routes%rowtype;
  v_place public.places%rowtype;
  v_previous_stop public.route_stops%rowtype;
  v_sequence smallint;
  v_stop_id uuid;
  v_existing jsonb;
  v_response jsonb;
begin
  v_actor_id := private.current_actor_id();
  v_existing := private.claim_idempotency(
    v_actor_id,
    'add_route_stop',
    p_idempotency_key,
    jsonb_build_object('routeId', p_route_id, 'placeId', p_place_id, 'plannedEta', p_planned_eta, 'cumulativeM', p_cumulative_m)
  );
  if v_existing is not null then return v_existing; end if;

  select * into v_route
  from public.driver_routes
  where id = p_route_id
  for update;
  if not found then raise exception using errcode = 'PT404', message = 'ROUTE_NOT_FOUND'; end if;
  if v_route.driver_id <> v_actor_id then raise exception using errcode = 'PT403', message = 'ROUTE_NOT_OWNED'; end if;
  if v_route.state <> 'DRAFT' then raise exception using errcode = 'PT409', message = 'ROUTE_ALREADY_PUBLISHED'; end if;

  select * into v_place
  from public.places
  where id = p_place_id and is_active;
  if not found then raise exception using errcode = 'PT400', message = 'STOP_NOT_APPROVED'; end if;
  if not (v_place.approved_pickup or v_place.approved_drop) then
    raise exception using errcode = 'PT400', message = 'STOP_NOT_APPROVED';
  end if;
  if p_planned_eta is null or p_planned_eta < v_route.departure_at then
    raise exception using errcode = 'PT400', message = 'INVALID_STOP_ETA';
  end if;
  if p_cumulative_m is null or p_cumulative_m < 0 then
    raise exception using errcode = 'PT400', message = 'INVALID_STOP_DISTANCE';
  end if;

  select * into v_previous_stop
  from public.route_stops
  where route_id = p_route_id
  order by sequence desc
  limit 1;
  if v_previous_stop.id is not null
    and (p_planned_eta < v_previous_stop.planned_eta or p_cumulative_m < v_previous_stop.cumulative_m) then
    raise exception using errcode = 'PT400', message = 'ROUTE_STOPS_MUST_BE_MONOTONIC';
  end if;

  select coalesce(max(sequence), -1) + 1 into v_sequence
  from public.route_stops
  where route_id = p_route_id;

  insert into public.route_stops (route_id, place_id, sequence, planned_eta, cumulative_m, pickup_allowed, drop_allowed)
  values (p_route_id, p_place_id, v_sequence, p_planned_eta, p_cumulative_m, v_place.approved_pickup, v_place.approved_drop)
  returning id into v_stop_id;

  update public.driver_routes set version = version + 1 where id = p_route_id;

  v_response := jsonb_build_object('routeId', p_route_id, 'stopId', v_stop_id, 'sequence', v_sequence);
  perform private.append_audit(v_actor_id, 'ROUTE_STOP_ADDED', 'driver_route', p_route_id, v_response);
  perform private.complete_idempotency(v_actor_id, 'add_route_stop', p_idempotency_key, v_response);
  return v_response;
end;
$$;

create function api.publish_route(p_route_id uuid, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_route public.driver_routes%rowtype;
  v_stop_count integer;
  v_pickup_count integer;
  v_drop_count integer;
  v_existing jsonb;
  v_response jsonb;
begin
  v_actor_id := private.current_actor_id();
  v_existing := private.claim_idempotency(v_actor_id, 'publish_route', p_idempotency_key, jsonb_build_object('routeId', p_route_id));
  if v_existing is not null then return v_existing; end if;

  perform private.require_approved_driver(v_actor_id);
  select * into v_route from public.driver_routes where id = p_route_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'ROUTE_NOT_FOUND'; end if;
  if v_route.driver_id <> v_actor_id then raise exception using errcode = 'PT403', message = 'ROUTE_NOT_OWNED'; end if;
  if v_route.state <> 'DRAFT' then raise exception using errcode = 'PT409', message = 'ROUTE_ALREADY_PUBLISHED'; end if;
  if v_route.departure_at <= now() + interval '5 minutes' then
    raise exception using errcode = 'PT409', message = 'ROUTE_DEPARTURE_TOO_SOON';
  end if;

  select count(*), count(*) filter (where pickup_allowed), count(*) filter (where drop_allowed)
  into v_stop_count, v_pickup_count, v_drop_count
  from public.route_stops where route_id = p_route_id;
  if v_stop_count < 2 or v_pickup_count = 0 or v_drop_count = 0 then
    raise exception using errcode = 'PT400', message = 'ROUTE_STOPS_INCOMPLETE';
  end if;

  update public.driver_routes
  set state = 'PUBLISHED', published_at = now(), version = version + 1
  where id = p_route_id
  returning * into v_route;

  v_response := jsonb_build_object('routeId', p_route_id, 'state', v_route.state, 'version', v_route.version);
  perform private.append_audit(v_actor_id, 'ROUTE_PUBLISHED', 'driver_route', p_route_id, v_response);
  perform private.complete_idempotency(v_actor_id, 'publish_route', p_idempotency_key, v_response);
  return v_response;
end;
$$;

create function api.update_route_progress(
  p_route_id uuid,
  p_current_stop_sequence smallint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_route public.driver_routes%rowtype;
  v_existing jsonb;
  v_response jsonb;
begin
  v_actor_id := private.current_actor_id();
  v_existing := private.claim_idempotency(
    v_actor_id,
    'update_route_progress',
    p_idempotency_key,
    jsonb_build_object('routeId', p_route_id, 'currentStopSequence', p_current_stop_sequence)
  );
  if v_existing is not null then return v_existing; end if;

  select * into v_route from public.driver_routes where id = p_route_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'ROUTE_NOT_FOUND'; end if;
  if v_route.driver_id <> v_actor_id then raise exception using errcode = 'PT403', message = 'ROUTE_NOT_OWNED'; end if;
  if v_route.state not in ('PUBLISHED', 'DEPARTED') then
    raise exception using errcode = 'PT409', message = 'ROUTE_PROGRESS_NOT_ALLOWED';
  end if;
  if p_current_stop_sequence is null or p_current_stop_sequence < v_route.current_stop_sequence then
    raise exception using errcode = 'PT409', message = 'ROUTE_PROGRESS_CANNOT_MOVE_BACKWARD';
  end if;
  if not exists (
    select 1 from public.route_stops
    where route_id = p_route_id and sequence = p_current_stop_sequence
  ) then
    raise exception using errcode = 'PT400', message = 'ROUTE_STOP_SEQUENCE_NOT_FOUND';
  end if;

  update public.driver_routes
  set state = 'DEPARTED', current_stop_sequence = p_current_stop_sequence, version = version + 1
  where id = p_route_id
  returning * into v_route;

  v_response := jsonb_build_object(
    'routeId', p_route_id,
    'state', v_route.state,
    'currentStopSequence', v_route.current_stop_sequence,
    'version', v_route.version
  );
  perform private.append_audit(v_actor_id, 'ROUTE_PROGRESS_UPDATED', 'driver_route', p_route_id, v_response);
  perform private.complete_idempotency(v_actor_id, 'update_route_progress', p_idempotency_key, v_response);
  return v_response;
end;
$$;

-- Passenger request and matching commands ----------------------------------

create function api.create_ride_request(
  p_pickup_place_id uuid,
  p_drop_place_id uuid,
  p_earliest_departure_at timestamptz,
  p_latest_departure_at timestamptz,
  p_seat_qty smallint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_pickup public.places%rowtype;
  v_drop public.places%rowtype;
  v_request_id uuid;
  v_existing jsonb;
  v_response jsonb;
begin
  v_actor_id := private.current_actor_id();
  v_existing := private.claim_idempotency(
    v_actor_id,
    'create_ride_request',
    p_idempotency_key,
    jsonb_build_object(
      'pickupPlaceId', p_pickup_place_id,
      'dropPlaceId', p_drop_place_id,
      'earliestDepartureAt', p_earliest_departure_at,
      'latestDepartureAt', p_latest_departure_at,
      'seatQty', p_seat_qty
    )
  );
  if v_existing is not null then return v_existing; end if;

  perform private.require_role(v_actor_id, 'PASSENGER');
  if p_pickup_place_id is null or p_drop_place_id is null or p_pickup_place_id = p_drop_place_id then
    raise exception using errcode = 'PT400', message = 'INVALID_REQUEST_STOPS';
  end if;
  if p_earliest_departure_at is null
    or p_latest_departure_at is null
    or p_latest_departure_at < p_earliest_departure_at
    or p_earliest_departure_at < now() - interval '5 minutes' then
    raise exception using errcode = 'PT400', message = 'INVALID_REQUEST_WINDOW';
  end if;
  if p_seat_qty is null or p_seat_qty not between 1 and 2 then
    raise exception using errcode = 'PT400', message = 'INVALID_SEAT_QUANTITY';
  end if;

  select * into v_pickup from public.places where id = p_pickup_place_id and is_active;
  if not found or not v_pickup.approved_pickup then
    raise exception using errcode = 'PT400', message = 'PICKUP_STOP_NOT_APPROVED';
  end if;
  select * into v_drop from public.places where id = p_drop_place_id and is_active;
  if not found or not v_drop.approved_drop then
    raise exception using errcode = 'PT400', message = 'DROP_STOP_NOT_APPROVED';
  end if;

  insert into public.ride_requests (
    passenger_id, pickup_place_id, drop_place_id, earliest_departure_at, latest_departure_at, seat_qty
  ) values (
    v_actor_id, p_pickup_place_id, p_drop_place_id, p_earliest_departure_at, p_latest_departure_at, p_seat_qty
  ) returning id into v_request_id;

  v_response := jsonb_build_object('requestId', v_request_id, 'state', 'OPEN');
  perform private.append_audit(v_actor_id, 'RIDE_REQUEST_CREATED', 'ride_request', v_request_id, v_response);
  perform private.complete_idempotency(v_actor_id, 'create_ride_request', p_idempotency_key, v_response);
  return v_response;
end;
$$;

create function api.match_ride_request(p_request_id uuid, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_request public.ride_requests%rowtype;
  v_route public.driver_routes%rowtype;
  v_pickup_stop public.route_stops%rowtype;
  v_drop_stop public.route_stops%rowtype;
  v_driver_status public.driver_approval_status;
  v_match_run_id uuid;
  v_candidate_id uuid;
  v_offer_count integer := 0;
  v_decision public.candidate_decision;
  v_reasons jsonb;
  v_score smallint;
  v_expires_at timestamptz;
  v_existing jsonb;
  v_offers jsonb;
  v_response jsonb;
begin
  v_actor_id := private.current_actor_id();
  v_existing := private.claim_idempotency(v_actor_id, 'match_ride_request', p_idempotency_key, jsonb_build_object('requestId', p_request_id));
  if v_existing is not null then return v_existing; end if;

  -- Lock prior offers before the request. select_offer and accept_offer use
  -- the same order (offer, then request), avoiding an offer/request deadlock.
  perform 1
  from public.ride_offers
  where request_id = p_request_id and state in ('PENDING', 'SELECTED')
  order by id
  for update;

  select * into v_request from public.ride_requests where id = p_request_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'RIDE_REQUEST_NOT_FOUND'; end if;
  if v_request.passenger_id <> v_actor_id then raise exception using errcode = 'PT403', message = 'RIDE_REQUEST_NOT_OWNED'; end if;
  if v_request.state not in ('OPEN', 'MATCHED') then
    raise exception using errcode = 'PT409', message = 'RIDE_REQUEST_NOT_MATCHABLE';
  end if;

  update public.ride_offers
  set state = 'STALE'
  where request_id = p_request_id and state in ('PENDING', 'SELECTED');

  insert into public.match_runs (request_id, initiated_by, input_snapshot)
  values (
    p_request_id,
    v_actor_id,
    jsonb_build_object(
      'pickupPlaceId', v_request.pickup_place_id,
      'dropPlaceId', v_request.drop_place_id,
      'earliestDepartureAt', v_request.earliest_departure_at,
      'latestDepartureAt', v_request.latest_departure_at,
      'seatQty', v_request.seat_qty
    )
  ) returning id into v_match_run_id;

  for v_route in
    select routes.*
    from public.driver_routes routes
    where routes.state in ('PUBLISHED', 'DEPARTED')
      and routes.departure_at >= now() - interval '5 minutes'
    order by routes.departure_at, routes.id
  loop
    v_pickup_stop := null;
    v_drop_stop := null;
    v_driver_status := null;
    select approval_status into v_driver_status from public.driver_profiles where user_id = v_route.driver_id;
    select * into v_pickup_stop
    from public.route_stops
    where route_id = v_route.id and place_id = v_request.pickup_place_id;
    select * into v_drop_stop
    from public.route_stops
    where route_id = v_route.id and place_id = v_request.drop_place_id;

    if v_driver_status is distinct from 'APPROVED' then
      v_decision := 'DRIVER_NOT_APPROVED';
      v_reasons := jsonb_build_array('DRIVER_NOT_APPROVED');
      v_score := null;
    elsif v_route.seat_capacity - v_route.seat_reserved < v_request.seat_qty then
      v_decision := 'CAPACITY_EXHAUSTED';
      v_reasons := jsonb_build_array('CAPACITY_EXHAUSTED');
      v_score := null;
    elsif v_pickup_stop.id is null or v_drop_stop.id is null then
      v_decision := 'OUTSIDE_ROUTE';
      v_reasons := jsonb_build_array('ROUTE_DOES_NOT_CONTAIN_BOTH_STOPS');
      v_score := null;
    elsif not v_pickup_stop.pickup_allowed or not v_drop_stop.drop_allowed then
      v_decision := 'UNAPPROVED_STOP';
      v_reasons := jsonb_build_array('STOP_SNAPSHOT_NOT_APPROVED');
      v_score := null;
    elsif v_pickup_stop.sequence >= v_drop_stop.sequence then
      v_decision := 'WRONG_DIRECTION';
      v_reasons := jsonb_build_array('PICKUP_MUST_PRECEDE_DROP');
      v_score := null;
    elsif v_pickup_stop.sequence <= v_route.current_stop_sequence then
      v_decision := 'PICKUP_BEHIND_DRIVER';
      v_reasons := jsonb_build_array('PICKUP_ALREADY_PASSED');
      v_score := null;
    elsif v_pickup_stop.planned_eta < v_request.earliest_departure_at
      or v_pickup_stop.planned_eta > v_request.latest_departure_at then
      v_decision := 'TIME_WINDOW_MISS';
      v_reasons := jsonb_build_array('PICKUP_ETA_OUTSIDE_REQUEST_WINDOW');
      v_score := null;
    else
      v_decision := 'ELIGIBLE';
      v_reasons := '[]'::jsonb;
      v_score := greatest(
        1,
        least(
          100,
          100
          - floor(abs(extract(epoch from (v_pickup_stop.planned_eta - v_request.earliest_departure_at)) / 60))::integer
          - (v_route.seat_reserved * 5)
        )
      )::smallint;
    end if;

    insert into public.match_candidates (
      match_run_id, request_id, route_id, pickup_stop_id, drop_stop_id, route_version,
      pickup_eta, drop_eta, decision, score, reason_codes
    ) values (
      v_match_run_id, p_request_id, v_route.id, v_pickup_stop.id, v_drop_stop.id, v_route.version,
      v_pickup_stop.planned_eta, v_drop_stop.planned_eta, v_decision, v_score, v_reasons
    ) returning id into v_candidate_id;

    if v_decision = 'ELIGIBLE' then
      v_expires_at := least(v_request.latest_departure_at, now() + interval '5 minutes');
      if v_expires_at > now() then
        insert into public.ride_offers (
          match_run_id, request_id, route_id, pickup_stop_id, drop_stop_id, route_version,
          seat_qty, score, pickup_eta, drop_eta, expires_at
        ) values (
          v_match_run_id, p_request_id, v_route.id, v_pickup_stop.id, v_drop_stop.id, v_route.version,
          v_request.seat_qty, v_score, v_pickup_stop.planned_eta, v_drop_stop.planned_eta, v_expires_at
        );
        v_offer_count := v_offer_count + 1;
      end if;
    end if;
  end loop;

  update public.match_runs set state = 'COMPLETED', completed_at = now() where id = v_match_run_id;
  update public.ride_requests set state = case when v_offer_count > 0 then 'MATCHED' else 'OPEN' end where id = p_request_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'offerId', offers.id,
        'routeId', offers.route_id,
        'driverName', profiles.display_name,
        'score', offers.score,
        'pickupEta', offers.pickup_eta,
        'dropEta', offers.drop_eta,
        'seatQty', offers.seat_qty,
        'routeVersion', offers.route_version,
        'expiresAt', offers.expires_at
      ) order by offers.score desc, offers.pickup_eta
    ),
    '[]'::jsonb
  ) into v_offers
  from public.ride_offers offers
  join public.driver_routes routes on routes.id = offers.route_id
  join public.profiles profiles on profiles.id = routes.driver_id
  where offers.match_run_id = v_match_run_id;

  v_response := jsonb_build_object('matchRunId', v_match_run_id, 'offers', v_offers);
  perform private.append_audit(v_actor_id, 'MATCH_COMPLETED', 'ride_request', p_request_id, jsonb_build_object('matchRunId', v_match_run_id, 'offerCount', v_offer_count));
  perform private.complete_idempotency(v_actor_id, 'match_ride_request', p_idempotency_key, v_response);
  return v_response;
end;
$$;

create function api.select_offer(p_offer_id uuid, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_offer public.ride_offers%rowtype;
  v_request public.ride_requests%rowtype;
  v_existing jsonb;
  v_response jsonb;
begin
  v_actor_id := private.current_actor_id();
  v_existing := private.claim_idempotency(v_actor_id, 'select_offer', p_idempotency_key, jsonb_build_object('offerId', p_offer_id));
  if v_existing is not null then return v_existing; end if;

  select * into v_offer from public.ride_offers where id = p_offer_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'OFFER_NOT_FOUND'; end if;
  select * into v_request from public.ride_requests where id = v_offer.request_id for update;
  if v_request.passenger_id <> v_actor_id then raise exception using errcode = 'PT403', message = 'OFFER_NOT_OWNED'; end if;
  if v_offer.expires_at <= now() then raise exception using errcode = 'PT409', message = 'OFFER_EXPIRED'; end if;
  if v_request.state <> 'MATCHED' then raise exception using errcode = 'PT409', message = 'RIDE_REQUEST_NOT_SELECTABLE'; end if;
  if v_offer.state not in ('PENDING', 'SELECTED') then raise exception using errcode = 'PT409', message = 'OFFER_NOT_SELECTABLE'; end if;

  if v_offer.state = 'PENDING' then
    update public.ride_offers set state = 'SELECTED', selected_at = now() where id = p_offer_id;
  end if;

  v_response := jsonb_build_object('offerId', p_offer_id, 'state', 'SELECTED');
  perform private.append_audit(v_actor_id, 'OFFER_SELECTED', 'ride_offer', p_offer_id, jsonb_build_object('requestId', v_offer.request_id));
  perform private.complete_idempotency(v_actor_id, 'select_offer', p_idempotency_key, v_response);
  return v_response;
end;
$$;

-- Atomic capacity reservation and lifecycle commands -----------------------

create function api.accept_offer(p_offer_id uuid, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_offer public.ride_offers%rowtype;
  v_request public.ride_requests%rowtype;
  v_route public.driver_routes%rowtype;
  v_pickup_stop public.route_stops%rowtype;
  v_drop_stop public.route_stops%rowtype;
  v_booking_id uuid;
  v_existing jsonb;
  v_response jsonb;
begin
  v_actor_id := private.current_actor_id();
  v_existing := private.claim_idempotency(v_actor_id, 'accept_offer', p_idempotency_key, jsonb_build_object('offerId', p_offer_id));
  if v_existing is not null then return v_existing; end if;

  perform private.require_approved_driver(v_actor_id);

  -- Keep the lock order stable across reservation callers: offer, request, route.
  select * into v_offer from public.ride_offers where id = p_offer_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'OFFER_NOT_FOUND'; end if;
  select * into v_request from public.ride_requests where id = v_offer.request_id for update;
  select * into v_route from public.driver_routes where id = v_offer.route_id for update;

  if v_route.driver_id <> v_actor_id then raise exception using errcode = 'PT403', message = 'OFFER_NOT_ASSIGNED_TO_DRIVER'; end if;
  if v_offer.state <> 'SELECTED' then raise exception using errcode = 'PT409', message = 'OFFER_NOT_SELECTED'; end if;
  if v_offer.expires_at <= now() then raise exception using errcode = 'PT409', message = 'OFFER_EXPIRED'; end if;
  if v_request.state <> 'MATCHED' then raise exception using errcode = 'PT409', message = 'RIDE_REQUEST_NOT_BOOKABLE'; end if;
  if v_route.state not in ('PUBLISHED', 'DEPARTED') then raise exception using errcode = 'PT409', message = 'ROUTE_UNAVAILABLE'; end if;
  if v_route.version <> v_offer.route_version then raise exception using errcode = 'PT409', message = 'ROUTE_VERSION_CHANGED'; end if;

  select * into v_pickup_stop from public.route_stops where route_id = v_route.id and id = v_offer.pickup_stop_id;
  select * into v_drop_stop from public.route_stops where route_id = v_route.id and id = v_offer.drop_stop_id;
  if v_pickup_stop.id is null or v_drop_stop.id is null
    or not v_pickup_stop.pickup_allowed
    or not v_drop_stop.drop_allowed
    or v_pickup_stop.sequence >= v_drop_stop.sequence
    or v_pickup_stop.sequence <= v_route.current_stop_sequence then
    raise exception using errcode = 'PT409', message = 'OFFER_NO_LONGER_VALID';
  end if;
  if v_pickup_stop.planned_eta < v_request.earliest_departure_at
    or v_pickup_stop.planned_eta > v_request.latest_departure_at then
    raise exception using errcode = 'PT409', message = 'OFFER_TIME_WINDOW_CHANGED';
  end if;

  update public.driver_routes
  set seat_reserved = seat_reserved + v_offer.seat_qty,
      version = version + 1
  where id = v_route.id
    and state in ('PUBLISHED', 'DEPARTED')
    and version = v_offer.route_version
    and seat_capacity - seat_reserved >= v_offer.seat_qty
  returning * into v_route;
  if not found then raise exception using errcode = 'PT409', message = 'CAPACITY_CONFLICT'; end if;

  insert into public.bookings (
    offer_id, request_id, route_id, passenger_id, driver_id, pickup_stop_id, drop_stop_id,
    route_version, seat_qty, state
  ) values (
    v_offer.id, v_request.id, v_route.id, v_request.passenger_id, v_actor_id, v_offer.pickup_stop_id, v_offer.drop_stop_id,
    v_route.version, v_offer.seat_qty, 'DRIVER_EN_ROUTE'
  ) returning id into v_booking_id;

  insert into public.capacity_reservations (booking_id, route_id, seat_qty)
  values (v_booking_id, v_route.id, v_offer.seat_qty);

  update public.ride_offers set state = 'ACCEPTED', accepted_at = now() where id = v_offer.id;
  update public.ride_requests set state = 'BOOKED' where id = v_request.id;

  perform private.append_booking_event(v_booking_id, v_actor_id, 'BOOKING_CONFIRMED', jsonb_build_object('offerId', v_offer.id, 'seatQty', v_offer.seat_qty));
  perform private.append_audit(v_actor_id, 'OFFER_ACCEPTED', 'booking', v_booking_id, jsonb_build_object('offerId', v_offer.id, 'routeId', v_route.id));

  v_response := jsonb_build_object('bookingId', v_booking_id, 'state', 'DRIVER_EN_ROUTE', 'routeVersion', v_route.version);
  perform private.complete_idempotency(v_actor_id, 'accept_offer', p_idempotency_key, v_response);
  return v_response;
end;
$$;

create function api.mark_driver_arrived(p_booking_id uuid, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_booking public.bookings%rowtype;
  v_existing jsonb;
  v_response jsonb;
begin
  v_actor_id := private.current_actor_id();
  v_existing := private.claim_idempotency(v_actor_id, 'mark_driver_arrived', p_idempotency_key, jsonb_build_object('bookingId', p_booking_id));
  if v_existing is not null then return v_existing; end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'BOOKING_NOT_FOUND'; end if;
  if v_booking.driver_id <> v_actor_id then raise exception using errcode = 'PT403', message = 'BOOKING_NOT_ASSIGNED_TO_DRIVER'; end if;

  if v_booking.state = 'DRIVER_EN_ROUTE' then
    update public.bookings
    set state = 'DRIVER_ARRIVED', driver_arrived_at = now(), version = version + 1
    where id = p_booking_id;
    perform private.append_booking_event(p_booking_id, v_actor_id, 'DRIVER_ARRIVED');
    perform private.append_audit(v_actor_id, 'DRIVER_ARRIVED', 'booking', p_booking_id);
  elsif v_booking.state <> 'DRIVER_ARRIVED' then
    raise exception using errcode = 'PT409', message = 'INVALID_BOOKING_TRANSITION';
  end if;

  v_response := jsonb_build_object('bookingId', p_booking_id, 'state', 'DRIVER_ARRIVED', 'pickupOtpAvailableForPassenger', true);
  perform private.complete_idempotency(v_actor_id, 'mark_driver_arrived', p_idempotency_key, v_response);
  return v_response;
end;
$$;

create function api.reveal_pickup_otp_once(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_booking public.bookings%rowtype;
  v_challenge public.pickup_challenges%rowtype;
  v_had_challenge boolean := false;
  v_entropy bytea;
  v_otp text;
  v_expires_at timestamptz := now() + interval '2 minutes';
begin
  v_actor_id := private.current_actor_id();
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'BOOKING_NOT_FOUND'; end if;
  if v_booking.passenger_id <> v_actor_id then raise exception using errcode = 'PT403', message = 'BOOKING_NOT_ASSIGNED_TO_PASSENGER'; end if;
  if v_booking.state <> 'DRIVER_ARRIVED' then raise exception using errcode = 'PT409', message = 'PICKUP_OTP_NOT_READY'; end if;

  select * into v_challenge from public.pickup_challenges where booking_id = p_booking_id for update;
  v_had_challenge := found;
  if v_had_challenge and v_challenge.expires_at > now() and v_challenge.attempts < v_challenge.max_attempts then
    raise exception using errcode = 'PT409', message = 'PICKUP_OTP_ALREADY_ISSUED';
  end if;

  -- The code is cryptographically generated, returned only in this one
  -- passenger-authenticated response, and never persisted, audited, or cached.
  v_entropy := extensions.gen_random_bytes(4);
  v_otp := lpad(
    ((
      get_byte(v_entropy, 0)::bigint * 16777216
      + get_byte(v_entropy, 1)::bigint * 65536
      + get_byte(v_entropy, 2)::bigint * 256
      + get_byte(v_entropy, 3)::bigint
    ) % 1000000)::text,
    6,
    '0'
  );

  if v_had_challenge then
    -- An expired or attempt-exhausted code can be rotated by the passenger.
    -- No previous plaintext is retained, replayed, or written to audit data.
    update public.pickup_challenges
    set otp_hash = extensions.crypt(v_otp, extensions.gen_salt('bf', 10)),
        attempts = 0,
        expires_at = v_expires_at,
        consumed_at = null,
        created_at = now()
    where booking_id = p_booking_id;
  else
    insert into public.pickup_challenges (booking_id, otp_hash, expires_at)
    values (p_booking_id, extensions.crypt(v_otp, extensions.gen_salt('bf', 10)), v_expires_at);
  end if;

  perform private.append_booking_event(
    p_booking_id,
    v_actor_id,
    case when v_had_challenge then 'PICKUP_OTP_REISSUED' else 'PICKUP_OTP_ISSUED' end
  );
  perform private.append_audit(
    v_actor_id,
    case when v_had_challenge then 'PICKUP_OTP_REISSUED' else 'PICKUP_OTP_ISSUED' end,
    'booking',
    p_booking_id
  );
  return jsonb_build_object('bookingId', p_booking_id, 'pickupOtp', v_otp, 'expiresAt', v_expires_at);
end;
$$;

create function api.verify_pickup_otp(p_booking_id uuid, p_otp text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_booking public.bookings%rowtype;
  v_challenge public.pickup_challenges%rowtype;
  v_remaining_attempts smallint;
begin
  v_actor_id := private.current_actor_id();
  if p_otp is null or p_otp !~ '^[0-9]{6}$' then
    raise exception using errcode = 'PT400', message = 'INVALID_PICKUP_OTP_FORMAT';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'BOOKING_NOT_FOUND'; end if;
  if v_booking.driver_id <> v_actor_id then raise exception using errcode = 'PT403', message = 'BOOKING_NOT_ASSIGNED_TO_DRIVER'; end if;
  if v_booking.state = 'OTP_VERIFIED' then
    return jsonb_build_object('bookingId', p_booking_id, 'state', 'OTP_VERIFIED', 'alreadyVerified', true);
  end if;
  if v_booking.state <> 'DRIVER_ARRIVED' then
    raise exception using errcode = 'PT409', message = 'PICKUP_OTP_NOT_READY';
  end if;

  select * into v_challenge from public.pickup_challenges where booking_id = p_booking_id for update;
  if not found then raise exception using errcode = 'PT409', message = 'PICKUP_OTP_NOT_ISSUED'; end if;
  if v_challenge.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'PICKUP_OTP_EXPIRED');
  end if;
  if v_challenge.attempts >= v_challenge.max_attempts then
    return jsonb_build_object('ok', false, 'code', 'PICKUP_OTP_ATTEMPTS_EXHAUSTED');
  end if;

  if extensions.crypt(p_otp, v_challenge.otp_hash) <> v_challenge.otp_hash then
    update public.pickup_challenges set attempts = attempts + 1 where booking_id = p_booking_id
    returning max_attempts - attempts into v_remaining_attempts;
    perform private.append_booking_event(p_booking_id, v_actor_id, 'PICKUP_OTP_FAILED', jsonb_build_object('attemptsRemaining', v_remaining_attempts));
    perform private.append_audit(v_actor_id, 'PICKUP_OTP_FAILED', 'booking', p_booking_id, jsonb_build_object('attemptsRemaining', v_remaining_attempts));
    return jsonb_build_object('ok', false, 'code', 'PICKUP_OTP_INVALID', 'attemptsRemaining', v_remaining_attempts);
  end if;

  update public.pickup_challenges set consumed_at = now() where booking_id = p_booking_id;
  update public.bookings
  set state = 'OTP_VERIFIED', otp_verified_at = now(), version = version + 1
  where id = p_booking_id;
  perform private.append_booking_event(p_booking_id, v_actor_id, 'PICKUP_OTP_VERIFIED');
  perform private.append_audit(v_actor_id, 'PICKUP_OTP_VERIFIED', 'booking', p_booking_id);
  return jsonb_build_object('ok', true, 'bookingId', p_booking_id, 'state', 'OTP_VERIFIED');
end;
$$;

create function api.propose_drop(p_booking_id uuid, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_booking public.bookings%rowtype;
  v_existing jsonb;
  v_response jsonb;
begin
  v_actor_id := private.current_actor_id();
  v_existing := private.claim_idempotency(v_actor_id, 'propose_drop', p_idempotency_key, jsonb_build_object('bookingId', p_booking_id));
  if v_existing is not null then return v_existing; end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'BOOKING_NOT_FOUND'; end if;
  if v_booking.driver_id <> v_actor_id then raise exception using errcode = 'PT403', message = 'BOOKING_NOT_ASSIGNED_TO_DRIVER'; end if;

  if v_booking.state = 'OTP_VERIFIED' then
    update public.bookings
    set state = 'DROP_PROPOSED', drop_proposed_at = now(), version = version + 1
    where id = p_booking_id;
    perform private.append_booking_event(p_booking_id, v_actor_id, 'DROP_PROPOSED');
    perform private.append_audit(v_actor_id, 'DROP_PROPOSED', 'booking', p_booking_id);
  elsif v_booking.state <> 'DROP_PROPOSED' then
    raise exception using errcode = 'PT409', message = 'INVALID_BOOKING_TRANSITION';
  end if;

  v_response := jsonb_build_object('bookingId', p_booking_id, 'state', 'DROP_PROPOSED');
  perform private.complete_idempotency(v_actor_id, 'propose_drop', p_idempotency_key, v_response);
  return v_response;
end;
$$;

create function api.confirm_drop(p_booking_id uuid, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_booking public.bookings%rowtype;
  v_route public.driver_routes%rowtype;
  v_existing jsonb;
  v_response jsonb;
begin
  v_actor_id := private.current_actor_id();
  v_existing := private.claim_idempotency(v_actor_id, 'confirm_drop', p_idempotency_key, jsonb_build_object('bookingId', p_booking_id));
  if v_existing is not null then return v_existing; end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'BOOKING_NOT_FOUND'; end if;
  if v_booking.passenger_id <> v_actor_id then raise exception using errcode = 'PT403', message = 'BOOKING_NOT_ASSIGNED_TO_PASSENGER'; end if;
  select * into v_route from public.driver_routes where id = v_booking.route_id for update;

  if v_booking.state = 'DROP_PROPOSED' then
    update public.bookings
    set state = 'COMPLETED', completed_at = now(), version = version + 1
    where id = p_booking_id;
    perform private.release_capacity(p_booking_id, v_booking.route_id, v_booking.seat_qty);
    update public.ride_requests set state = 'COMPLETED' where id = v_booking.request_id;
    perform private.append_booking_event(p_booking_id, v_actor_id, 'DROP_CONFIRMED');
    perform private.append_audit(v_actor_id, 'DROP_CONFIRMED', 'booking', p_booking_id);
  elsif v_booking.state <> 'COMPLETED' then
    raise exception using errcode = 'PT409', message = 'INVALID_BOOKING_TRANSITION';
  end if;

  v_response := jsonb_build_object('bookingId', p_booking_id, 'state', 'COMPLETED');
  perform private.complete_idempotency(v_actor_id, 'confirm_drop', p_idempotency_key, v_response);
  return v_response;
end;
$$;

-- Pilot operations -----------------------------------------------------------

create function api.set_driver_approval(
  p_driver_id uuid,
  p_status public.driver_approval_status,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_existing jsonb;
  v_response jsonb;
begin
  v_actor_id := private.current_actor_id();
  v_existing := private.claim_idempotency(
    v_actor_id,
    'set_driver_approval',
    p_idempotency_key,
    jsonb_build_object('driverId', p_driver_id, 'status', p_status, 'reason', p_reason)
  );
  if v_existing is not null then return v_existing; end if;

  perform private.require_role(v_actor_id, 'OPS');
  if p_status is null then
    raise exception using errcode = 'PT400', message = 'INVALID_DRIVER_APPROVAL_STATUS';
  end if;
  if p_reason is not null and char_length(trim(p_reason)) > 500 then
    raise exception using errcode = 'PT400', message = 'APPROVAL_REASON_TOO_LONG';
  end if;
  if not exists (
    select 1 from public.user_roles roles where roles.user_id = p_driver_id and roles.role = 'DRIVER'
  ) then
    raise exception using errcode = 'PT409', message = 'USER_NOT_REGISTERED_AS_DRIVER';
  end if;

  insert into public.driver_profiles (user_id, approval_status, approval_reason, reviewed_by, reviewed_at)
  values (
    p_driver_id,
    p_status,
    nullif(trim(p_reason), ''),
    case when p_status = 'PENDING' then null else v_actor_id end,
    case when p_status = 'PENDING' then null else now() end
  )
  on conflict (user_id) do update
  set approval_status = excluded.approval_status,
      approval_reason = excluded.approval_reason,
      reviewed_by = excluded.reviewed_by,
      reviewed_at = excluded.reviewed_at;

  v_response := jsonb_build_object('driverId', p_driver_id, 'approvalStatus', p_status);
  perform private.append_audit(v_actor_id, 'DRIVER_APPROVAL_UPDATED', 'driver_profile', p_driver_id, v_response);
  perform private.complete_idempotency(v_actor_id, 'set_driver_approval', p_idempotency_key, v_response);
  return v_response;
end;
$$;

create function api.report_incident(
  p_booking_id uuid,
  p_category text,
  p_severity public.incident_severity,
  p_description text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_booking public.bookings%rowtype;
  v_incident_id uuid;
  v_existing jsonb;
  v_response jsonb;
begin
  v_actor_id := private.current_actor_id();
  v_existing := private.claim_idempotency(
    v_actor_id,
    'report_incident',
    p_idempotency_key,
    jsonb_build_object('bookingId', p_booking_id, 'category', p_category, 'severity', p_severity, 'description', p_description)
  );
  if v_existing is not null then return v_existing; end if;

  if p_category is null or p_category !~ '^[A-Z][A-Z0-9_]{2,63}$' then
    raise exception using errcode = 'PT400', message = 'INVALID_INCIDENT_CATEGORY';
  end if;
  if p_severity is null then
    raise exception using errcode = 'PT400', message = 'INVALID_INCIDENT_SEVERITY';
  end if;
  if p_description is null or char_length(trim(p_description)) not between 10 and 2000 then
    raise exception using errcode = 'PT400', message = 'INVALID_INCIDENT_DESCRIPTION';
  end if;

  if p_booking_id is not null then
    select * into v_booking from public.bookings where id = p_booking_id;
    if not found then raise exception using errcode = 'PT404', message = 'BOOKING_NOT_FOUND'; end if;
    if v_actor_id not in (v_booking.passenger_id, v_booking.driver_id) and not private.current_user_is_ops() then
      raise exception using errcode = 'PT403', message = 'INCIDENT_NOT_ASSOCIATED_WITH_ACTOR';
    end if;
  end if;

  insert into public.incidents (reporter_id, booking_id, route_id, category, severity, description)
  values (v_actor_id, p_booking_id, v_booking.route_id, p_category, p_severity, trim(p_description))
  returning id into v_incident_id;

  v_response := jsonb_build_object('incidentId', v_incident_id, 'state', 'OPEN');
  perform private.append_audit(v_actor_id, 'INCIDENT_REPORTED', 'incident', v_incident_id, jsonb_build_object('bookingId', p_booking_id, 'severity', p_severity));
  perform private.complete_idempotency(v_actor_id, 'report_incident', p_idempotency_key, v_response);
  return v_response;
end;
$$;

create function api.resolve_incident(p_incident_id uuid, p_resolution text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_incident public.incidents%rowtype;
  v_existing jsonb;
  v_response jsonb;
begin
  v_actor_id := private.current_actor_id();
  v_existing := private.claim_idempotency(
    v_actor_id,
    'resolve_incident',
    p_idempotency_key,
    jsonb_build_object('incidentId', p_incident_id, 'resolution', p_resolution)
  );
  if v_existing is not null then return v_existing; end if;

  perform private.require_role(v_actor_id, 'OPS');
  if p_resolution is null or char_length(trim(p_resolution)) not between 5 and 2000 then
    raise exception using errcode = 'PT400', message = 'INVALID_INCIDENT_RESOLUTION';
  end if;
  select * into v_incident from public.incidents where id = p_incident_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'INCIDENT_NOT_FOUND'; end if;

  update public.incidents
  set state = 'RESOLVED', resolution = trim(p_resolution), resolved_by = v_actor_id, resolved_at = now(), assigned_to = v_actor_id
  where id = p_incident_id;

  v_response := jsonb_build_object('incidentId', p_incident_id, 'state', 'RESOLVED');
  perform private.append_audit(v_actor_id, 'INCIDENT_RESOLVED', 'incident', p_incident_id, v_response);
  perform private.complete_idempotency(v_actor_id, 'resolve_incident', p_idempotency_key, v_response);
  return v_response;
end;
$$;

create function api.pilot_metrics(
  p_from timestamptz default now() - interval '30 days',
  p_to timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_rejections jsonb;
begin
  v_actor_id := private.current_actor_id();
  perform private.require_role(v_actor_id, 'OPS');
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > interval '90 days' then
    raise exception using errcode = 'PT400', message = 'INVALID_METRICS_WINDOW';
  end if;

  select coalesce(jsonb_object_agg(decision, total), '{}'::jsonb)
  into v_rejections
  from (
    select decision::text as decision, count(*) as total
    from public.match_candidates
    where created_at >= p_from and created_at < p_to and decision <> 'ELIGIBLE'
    group by decision
  ) rejection_counts;

  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'requestsCreated', (select count(*) from public.ride_requests where created_at >= p_from and created_at < p_to),
    'matchRuns', (select count(*) from public.match_runs where created_at >= p_from and created_at < p_to),
    'eligibleCandidates', (select count(*) from public.match_candidates where created_at >= p_from and created_at < p_to and decision = 'ELIGIBLE'),
    'offersCreated', (select count(*) from public.ride_offers where created_at >= p_from and created_at < p_to),
    'bookingsConfirmed', (select count(*) from public.bookings where created_at >= p_from and created_at < p_to),
    'tripsCompleted', (select count(*) from public.bookings where completed_at >= p_from and completed_at < p_to),
    'otpFailures', (select count(*) from public.booking_events where occurred_at >= p_from and occurred_at < p_to and event_type = 'PICKUP_OTP_FAILED'),
    'openIncidents', (select count(*) from public.incidents where state in ('OPEN', 'ACKNOWLEDGED')),
    'rejectionsByReason', v_rejections
  );
end;
$$;

-- RLS and privileges ---------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.driver_profiles enable row level security;
alter table public.places enable row level security;
alter table public.driver_routes enable row level security;
alter table public.route_stops enable row level security;
alter table public.ride_requests enable row level security;
alter table public.match_runs enable row level security;
alter table public.match_candidates enable row level security;
alter table public.ride_offers enable row level security;
alter table public.bookings enable row level security;
alter table public.capacity_reservations enable row level security;
alter table public.pickup_challenges enable row level security;
alter table public.booking_events enable row level security;
alter table public.audit_events enable row level security;
alter table public.idempotency_keys enable row level security;
alter table public.incidents enable row level security;

create policy profiles_read_self_or_ops on public.profiles
for select to authenticated
using (id = auth.uid() or private.current_user_is_ops());

create policy user_roles_read_self_or_ops on public.user_roles
for select to authenticated
using (user_id = auth.uid() or private.current_user_is_ops());

create policy driver_profiles_read_self_or_ops on public.driver_profiles
for select to authenticated
using (user_id = auth.uid() or private.current_user_is_ops());

create policy places_read_active on public.places
for select to authenticated
using (is_active or private.current_user_is_ops());

create policy routes_read_owner_or_ops on public.driver_routes
for select to authenticated
using (driver_id = auth.uid() or private.current_user_is_ops());

create policy route_stops_read_owner_or_ops on public.route_stops
for select to authenticated
using (
  private.current_user_is_ops()
  or exists (
    select 1 from public.driver_routes routes
    where routes.id = route_stops.route_id and routes.driver_id = auth.uid()
  )
);

create policy ride_requests_read_owner_or_ops on public.ride_requests
for select to authenticated
using (passenger_id = auth.uid() or private.current_user_is_ops());

create policy match_runs_read_request_owner_or_ops on public.match_runs
for select to authenticated
using (
  private.current_user_is_ops()
  or exists (
    select 1 from public.ride_requests requests
    where requests.id = match_runs.request_id and requests.passenger_id = auth.uid()
  )
);

create policy match_candidates_read_party_or_ops on public.match_candidates
for select to authenticated
using (
  private.current_user_is_ops()
  or exists (
    select 1 from public.ride_requests requests
    where requests.id = match_candidates.request_id and requests.passenger_id = auth.uid()
  )
  or exists (
    select 1 from public.driver_routes routes
    where routes.id = match_candidates.route_id and routes.driver_id = auth.uid()
  )
);

create policy ride_offers_read_party_or_ops on public.ride_offers
for select to authenticated
using (
  private.current_user_is_ops()
  or exists (
    select 1 from public.ride_requests requests
    where requests.id = ride_offers.request_id and requests.passenger_id = auth.uid()
  )
  or exists (
    select 1 from public.driver_routes routes
    where routes.id = ride_offers.route_id and routes.driver_id = auth.uid()
  )
);

create policy bookings_read_party_or_ops on public.bookings
for select to authenticated
using (passenger_id = auth.uid() or driver_id = auth.uid() or private.current_user_is_ops());

create policy capacity_reservations_read_ops on public.capacity_reservations
for select to authenticated
using (private.current_user_is_ops());

create policy booking_events_read_party_or_ops on public.booking_events
for select to authenticated
using (
  private.current_user_is_ops()
  or exists (
    select 1 from public.bookings bookings
    where bookings.id = booking_events.booking_id
      and (bookings.passenger_id = auth.uid() or bookings.driver_id = auth.uid())
  )
);

create policy audit_events_read_ops on public.audit_events
for select to authenticated
using (private.current_user_is_ops());

create policy idempotency_keys_read_owner on public.idempotency_keys
for select to authenticated
using (actor_id = auth.uid());

create policy incidents_read_party_or_ops on public.incidents
for select to authenticated
using (
  reporter_id = auth.uid()
  or private.current_user_is_ops()
  or exists (
    select 1 from public.bookings bookings
    where bookings.id = incidents.booking_id
      and (bookings.passenger_id = auth.uid() or bookings.driver_id = auth.uid())
  )
);

revoke all on schema private from public;
revoke all on schema api from public;
grant usage on schema private to authenticated;
grant usage on schema api to authenticated;

revoke all on public.profiles, public.user_roles, public.driver_profiles, public.places,
  public.driver_routes, public.route_stops, public.ride_requests, public.match_runs,
  public.match_candidates, public.ride_offers, public.bookings, public.capacity_reservations,
  public.pickup_challenges, public.booking_events, public.audit_events, public.idempotency_keys,
  public.incidents from anon, authenticated;

grant select on public.profiles, public.user_roles, public.driver_profiles, public.places,
  public.driver_routes, public.route_stops, public.ride_requests, public.match_runs,
  public.match_candidates, public.ride_offers, public.bookings, public.capacity_reservations,
  public.booking_events, public.audit_events, public.idempotency_keys, public.incidents to authenticated;

revoke all on all functions in schema private from public;
revoke all on all functions in schema api from public;
grant execute on function private.current_user_is_ops() to authenticated;
grant execute on all functions in schema api to authenticated;
