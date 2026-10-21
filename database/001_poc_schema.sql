-- HISTORICAL POC DOMAIN SKETCH ONLY — not the backend implementation source.
-- It intentionally lacks Supabase Auth FKs, RLS, driver approval, immutable
-- audit events, idempotency, and atomic reservation enforcement. Use
-- supabase/migrations/20261020211524_lift_backend_mvp.sql for the MVP schema.
-- Add PostGIS geometry and real routing provider snapshots in a later phase;
-- never use a Redis GEO result as the source of truth for booking capacity.

create extension if not exists pgcrypto;

create type route_state as enum ('DRAFT', 'PUBLISHED', 'DEPARTED', 'COMPLETED', 'CANCELLED');
create type request_state as enum ('OPEN', 'MATCHED', 'BOOKED', 'CANCELLED', 'EXPIRED');
create type booking_state as enum ('OFFERED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'OTP_VERIFIED', 'DROP_PROPOSED', 'COMPLETED', 'CANCELLED');
create type candidate_decision as enum ('ELIGIBLE', 'WRONG_DIRECTION', 'PICKUP_BEHIND_DRIVER', 'CAPACITY_EXHAUSTED', 'OUTSIDE_ROUTE', 'TIME_WINDOW_MISS');

create table places (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  latitude numeric(9, 6) not null,
  longitude numeric(9, 6) not null,
  approved_pickup boolean not null default true,
  approved_drop boolean not null default true,
  created_at timestamptz not null default now()
);

create table driver_routes (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null,
  departure_at timestamptz not null,
  state route_state not null default 'DRAFT',
  seat_capacity smallint not null check (seat_capacity > 0 and seat_capacity <= 4),
  seat_reserved smallint not null default 0 check (seat_reserved >= 0 and seat_reserved <= seat_capacity),
  route_progress numeric(4, 3) not null default 0 check (route_progress >= 0 and route_progress <= 1),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table route_stops (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references driver_routes(id) on delete cascade,
  place_id uuid not null references places(id),
  sequence smallint not null check (sequence >= 0),
  planned_eta timestamptz not null,
  cumulative_m integer not null check (cumulative_m >= 0),
  unique (route_id, sequence),
  unique (route_id, place_id)
);

create table ride_requests (
  id uuid primary key default gen_random_uuid(),
  passenger_id uuid not null,
  pickup_place_id uuid not null references places(id),
  drop_place_id uuid not null references places(id),
  earliest_departure_at timestamptz not null,
  latest_departure_at timestamptz not null,
  seat_qty smallint not null check (seat_qty > 0 and seat_qty <= 2),
  state request_state not null default 'OPEN',
  created_at timestamptz not null default now(),
  check (pickup_place_id <> drop_place_id),
  check (latest_departure_at >= earliest_departure_at)
);

create table match_candidates (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references ride_requests(id) on delete cascade,
  route_id uuid not null references driver_routes(id) on delete cascade,
  pickup_stop_id uuid references route_stops(id),
  drop_stop_id uuid references route_stops(id),
  decision candidate_decision not null,
  score smallint check (score between 0 and 100),
  reasons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (request_id, route_id)
);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references ride_requests(id),
  route_id uuid not null references driver_routes(id),
  pickup_stop_id uuid not null references route_stops(id),
  drop_stop_id uuid not null references route_stops(id),
  seat_qty smallint not null check (seat_qty > 0),
  state booking_state not null default 'OFFERED',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table pickup_challenges (
  booking_id uuid primary key references bookings(id) on delete cascade,
  otp_hash text not null,
  attempts smallint not null default 0 check (attempts >= 0),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create table booking_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  event_type text not null,
  actor_type text not null check (actor_type in ('passenger', 'driver', 'system', 'operations')),
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index driver_routes_active_idx on driver_routes (departure_at) where state = 'PUBLISHED';
create index route_stops_route_sequence_idx on route_stops (route_id, sequence);
create index match_candidates_request_idx on match_candidates (request_id, decision, score desc);
create index booking_events_booking_idx on booking_events (booking_id, occurred_at);

-- Example reservation pattern. The API transaction must first validate that
-- pickup/drop stop order and ETA are still valid for the route version.
-- select * from driver_routes where id = :route_id for update;
-- update driver_routes
--    set seat_reserved = seat_reserved + :seat_qty, version = version + 1, updated_at = now()
--  where id = :route_id
--    and state = 'PUBLISHED'
--    and seat_capacity - seat_reserved >= :seat_qty;
-- Require exactly one updated row before inserting the booking.
