begin;
select plan(17);

select ok(exists (select 1 from pg_namespace where nspname = 'api'), 'API schema exists');
select ok(exists (select 1 from pg_namespace where nspname = 'private'), 'private schema exists');
select ok(exists (select 1 from pg_extension where extname = 'pgcrypto'), 'pgcrypto is enabled for OTP hashing');

select ok(
  exists (
    select 1
    from pg_constraint constraints
    join pg_class tables on tables.oid = constraints.conrelid
    join pg_namespace schemas on schemas.oid = tables.relnamespace
    where schemas.nspname = 'public'
      and tables.relname = 'profiles'
      and constraints.contype = 'f'
      and pg_get_constraintdef(constraints.oid) like '%auth.users%'
  ),
  'profiles are tied to Supabase Auth users'
);

select ok(
  (select count(*) from pg_class tables join pg_namespace schemas on schemas.oid = tables.relnamespace
   where schemas.nspname = 'public'
     and tables.relname in (
       'profiles', 'user_roles', 'driver_profiles', 'places', 'driver_routes', 'route_stops',
       'ride_requests', 'match_runs', 'match_candidates', 'ride_offers', 'bookings',
       'capacity_reservations', 'pickup_challenges', 'booking_events', 'audit_events',
       'idempotency_keys', 'incidents'
     )
     and tables.relrowsecurity) = 17,
  'all MVP public tables have RLS enabled'
);

select ok(
  not has_table_privilege('authenticated', 'public.driver_routes', 'INSERT')
  and not has_table_privilege('authenticated', 'public.driver_routes', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.bookings', 'INSERT')
  and not has_table_privilege('authenticated', 'public.bookings', 'UPDATE'),
  'authenticated users cannot mutate routes or bookings directly'
);

select ok(
  not has_table_privilege('authenticated', 'public.pickup_challenges', 'SELECT'),
  'OTP hashes cannot be read through the Data API'
);

select ok(
  exists (
    select 1
    from pg_constraint constraints
    join pg_class tables on tables.oid = constraints.conrelid
    join pg_namespace schemas on schemas.oid = tables.relnamespace
    where schemas.nspname = 'public'
      and tables.relname = 'route_stops'
      and constraints.contype = 'u'
      and pg_get_constraintdef(constraints.oid) = 'UNIQUE (route_id, id)'
  ),
  'route stop composite identity prevents cross-route stop references'
);

select ok(
  (select count(*)
   from pg_constraint constraints
   join pg_class tables on tables.oid = constraints.conrelid
   join pg_namespace schemas on schemas.oid = tables.relnamespace
   where schemas.nspname = 'public'
     and tables.relname in ('ride_offers', 'bookings')
     and constraints.contype = 'f'
     and pg_get_constraintdef(constraints.oid) like '%FOREIGN KEY (route_id, pickup_stop_id)%route_stops(route_id, id)%') = 2,
  'offers and bookings enforce pickup stop ownership by route'
);

select ok(
  exists (
    select 1
    from pg_trigger triggers
    join pg_class tables on tables.oid = triggers.tgrelid
    join pg_namespace schemas on schemas.oid = tables.relnamespace
    where schemas.nspname = 'public'
      and tables.relname = 'bookings'
      and triggers.tgname = 'bookings_forward_stop_order'
  ),
  'bookings reject a pickup sequence at or after its drop sequence'
);

select ok(to_regprocedure('api.accept_offer(uuid,text)') is not null, 'atomic offer-accept RPC exists');
select ok(to_regprocedure('api.reveal_pickup_otp_once(uuid)') is not null, 'one-time passenger OTP RPC exists');
select ok(to_regprocedure('api.verify_pickup_otp(uuid,text)') is not null, 'driver OTP verification RPC exists');
select ok(to_regprocedure('api.pilot_metrics(timestamp with time zone,timestamp with time zone)') is not null, 'ops metrics RPC exists');

select ok(
  not has_function_privilege('anon', 'api.accept_offer(uuid,text)'::regprocedure, 'EXECUTE')
  and has_function_privilege('authenticated', 'api.accept_offer(uuid,text)'::regprocedure, 'EXECUTE'),
  'only authenticated callers can invoke API RPCs'
);

select throws_ok(
  $$select api.create_route(now() + interval '10 minutes', 1, 'idempotency-key-0001')$$,
  'PT401',
  'AUTH_REQUIRED',
  'RPC rejects requests without a JWT subject'
);

select ok(
  exists (
    select 1
    from pg_index indexes
    join pg_class tables on tables.oid = indexes.indrelid
    join pg_class index_class on index_class.oid = indexes.indexrelid
    join pg_namespace schemas on schemas.oid = tables.relnamespace
    where schemas.nspname = 'public'
      and tables.relname = 'driver_routes'
      and index_class.relname = 'driver_routes_active_idx'
  ),
  'published route lookup has a partial index'
);

select * from finish();
rollback;
