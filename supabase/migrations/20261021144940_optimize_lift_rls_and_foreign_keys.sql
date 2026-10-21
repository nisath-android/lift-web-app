-- Lift backend MVP v1.1: cache identity/role checks in RLS plans and cover
-- foreign-key joins. This is intentionally a new migration: v1.0 is immutable.

create or replace function private.current_user_is_ops()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles roles
    where roles.user_id = (select auth.uid())
      and roles.role = 'OPS'
  );
$$;

drop policy profiles_read_self_or_ops on public.profiles;
create policy profiles_read_self_or_ops on public.profiles
for select to authenticated
using (id = (select auth.uid()) or (select private.current_user_is_ops()));

drop policy user_roles_read_self_or_ops on public.user_roles;
create policy user_roles_read_self_or_ops on public.user_roles
for select to authenticated
using (user_id = (select auth.uid()) or (select private.current_user_is_ops()));

drop policy driver_profiles_read_self_or_ops on public.driver_profiles;
create policy driver_profiles_read_self_or_ops on public.driver_profiles
for select to authenticated
using (user_id = (select auth.uid()) or (select private.current_user_is_ops()));

drop policy places_read_active on public.places;
create policy places_read_active on public.places
for select to authenticated
using (is_active or (select private.current_user_is_ops()));

drop policy routes_read_owner_or_ops on public.driver_routes;
create policy routes_read_owner_or_ops on public.driver_routes
for select to authenticated
using (driver_id = (select auth.uid()) or (select private.current_user_is_ops()));

drop policy route_stops_read_owner_or_ops on public.route_stops;
create policy route_stops_read_owner_or_ops on public.route_stops
for select to authenticated
using (
  (select private.current_user_is_ops())
  or exists (
    select 1 from public.driver_routes routes
    where routes.id = route_stops.route_id and routes.driver_id = (select auth.uid())
  )
);

drop policy ride_requests_read_owner_or_ops on public.ride_requests;
create policy ride_requests_read_owner_or_ops on public.ride_requests
for select to authenticated
using (passenger_id = (select auth.uid()) or (select private.current_user_is_ops()));

drop policy match_runs_read_request_owner_or_ops on public.match_runs;
create policy match_runs_read_request_owner_or_ops on public.match_runs
for select to authenticated
using (
  (select private.current_user_is_ops())
  or exists (
    select 1 from public.ride_requests requests
    where requests.id = match_runs.request_id and requests.passenger_id = (select auth.uid())
  )
);

drop policy match_candidates_read_party_or_ops on public.match_candidates;
create policy match_candidates_read_party_or_ops on public.match_candidates
for select to authenticated
using (
  (select private.current_user_is_ops())
  or exists (
    select 1 from public.ride_requests requests
    where requests.id = match_candidates.request_id and requests.passenger_id = (select auth.uid())
  )
  or exists (
    select 1 from public.driver_routes routes
    where routes.id = match_candidates.route_id and routes.driver_id = (select auth.uid())
  )
);

drop policy ride_offers_read_party_or_ops on public.ride_offers;
create policy ride_offers_read_party_or_ops on public.ride_offers
for select to authenticated
using (
  (select private.current_user_is_ops())
  or exists (
    select 1 from public.ride_requests requests
    where requests.id = ride_offers.request_id and requests.passenger_id = (select auth.uid())
  )
  or exists (
    select 1 from public.driver_routes routes
    where routes.id = ride_offers.route_id and routes.driver_id = (select auth.uid())
  )
);

drop policy bookings_read_party_or_ops on public.bookings;
create policy bookings_read_party_or_ops on public.bookings
for select to authenticated
using (
  passenger_id = (select auth.uid())
  or driver_id = (select auth.uid())
  or (select private.current_user_is_ops())
);

drop policy capacity_reservations_read_ops on public.capacity_reservations;
create policy capacity_reservations_read_ops on public.capacity_reservations
for select to authenticated
using ((select private.current_user_is_ops()));

drop policy booking_events_read_party_or_ops on public.booking_events;
create policy booking_events_read_party_or_ops on public.booking_events
for select to authenticated
using (
  (select private.current_user_is_ops())
  or exists (
    select 1 from public.bookings bookings
    where bookings.id = booking_events.booking_id
      and (bookings.passenger_id = (select auth.uid()) or bookings.driver_id = (select auth.uid()))
  )
);

drop policy audit_events_read_ops on public.audit_events;
create policy audit_events_read_ops on public.audit_events
for select to authenticated
using ((select private.current_user_is_ops()));

drop policy idempotency_keys_read_owner on public.idempotency_keys;
create policy idempotency_keys_read_owner on public.idempotency_keys
for select to authenticated
using (actor_id = (select auth.uid()));

drop policy incidents_read_party_or_ops on public.incidents;
create policy incidents_read_party_or_ops on public.incidents
for select to authenticated
using (
  reporter_id = (select auth.uid())
  or (select private.current_user_is_ops())
  or exists (
    select 1 from public.bookings bookings
    where bookings.id = incidents.booking_id
      and (bookings.passenger_id = (select auth.uid()) or bookings.driver_id = (select auth.uid()))
  )
);

-- pickup_challenges deliberately remains policy-free: no client role receives
-- any table privilege, and the OTP is accessible only through guarded API RPCs.

create index audit_events_actor_id_idx on public.audit_events (actor_id);
create index booking_events_actor_id_idx on public.booking_events (actor_id);
create index bookings_driver_id_idx on public.bookings (driver_id);
create index bookings_route_drop_stop_idx on public.bookings (route_id, drop_stop_id);
create index bookings_route_pickup_stop_idx on public.bookings (route_id, pickup_stop_id);
create index capacity_reservations_route_id_idx on public.capacity_reservations (route_id);
create index driver_profiles_reviewed_by_idx on public.driver_profiles (reviewed_by);
create index driver_routes_driver_id_idx on public.driver_routes (driver_id);
create index incidents_assigned_to_idx on public.incidents (assigned_to);
create index incidents_booking_id_idx on public.incidents (booking_id);
create index incidents_reporter_id_idx on public.incidents (reporter_id);
create index incidents_resolved_by_idx on public.incidents (resolved_by);
create index incidents_route_id_idx on public.incidents (route_id);
create index match_candidates_request_id_idx on public.match_candidates (request_id);
create index match_candidates_route_drop_stop_idx on public.match_candidates (route_id, drop_stop_id);
create index match_candidates_route_id_idx on public.match_candidates (route_id);
create index match_candidates_route_pickup_stop_idx on public.match_candidates (route_id, pickup_stop_id);
create index match_runs_initiated_by_idx on public.match_runs (initiated_by);
create index ride_offers_match_run_id_idx on public.ride_offers (match_run_id);
create index ride_offers_route_drop_stop_idx on public.ride_offers (route_id, drop_stop_id);
create index ride_offers_route_id_idx on public.ride_offers (route_id);
create index ride_offers_route_pickup_stop_idx on public.ride_offers (route_id, pickup_stop_id);
create index ride_requests_drop_place_id_idx on public.ride_requests (drop_place_id);
create index ride_requests_pickup_place_id_idx on public.ride_requests (pickup_place_id);
create index route_stops_place_id_idx on public.route_stops (place_id);
create index user_roles_granted_by_idx on public.user_roles (granted_by);
