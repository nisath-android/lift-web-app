-- Closed pilot v1.2: controlled Coimbatore stops and a driver-only pending
-- offer feed. Place UUIDs are stable public identifiers, not secrets.

insert into public.places (
  id, name, latitude, longitude, approved_pickup, approved_drop, is_active
) values
  ('10000000-0000-4000-8000-000000000001', 'Gandhipuram Bus Stand', 11.018304, 76.967037, true, true, true),
  ('10000000-0000-4000-8000-000000000002', 'Nava India', 11.022917, 76.982641, true, true, true),
  ('10000000-0000-4000-8000-000000000003', 'Peelamedu', 11.030327, 77.020746, true, true, true),
  ('10000000-0000-4000-8000-000000000004', 'Hope College', 11.023351, 77.042661, true, true, true),
  ('10000000-0000-4000-8000-000000000005', 'Vilankurichi', 11.053912, 77.019782, true, true, true),
  ('10000000-0000-4000-8000-000000000006', 'Saravanampatti', 11.078776, 77.001151, true, true, true)
on conflict (id) do update
set name = excluded.name,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    approved_pickup = excluded.approved_pickup,
    approved_drop = excluded.approved_drop,
    is_active = excluded.is_active,
    updated_at = now();

create function api.list_driver_offers()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
begin
  v_actor_id := private.current_actor_id();
  perform private.require_approved_driver(v_actor_id);

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'offerId', offers.id,
        'state', offers.state,
        'seatQty', offers.seat_qty,
        'expiresAt', offers.expires_at,
        'score', offers.score,
        'pickupEta', offers.pickup_eta,
        'dropEta', offers.drop_eta,
        'passengerName', passengers.display_name,
        'pickupName', pickup_places.name,
        'dropName', drop_places.name
      ) order by offers.expires_at asc, offers.score desc
    )
    from public.ride_offers offers
    join public.driver_routes routes on routes.id = offers.route_id
    join public.ride_requests requests on requests.id = offers.request_id
    join public.profiles passengers on passengers.id = requests.passenger_id
    join public.places pickup_places on pickup_places.id = requests.pickup_place_id
    join public.places drop_places on drop_places.id = requests.drop_place_id
    where routes.driver_id = v_actor_id
      and offers.state = 'SELECTED'
      and offers.expires_at > now()
  ), '[]'::jsonb);
end;
$$;

revoke all on function api.list_driver_offers() from public;
grant execute on function api.list_driver_offers() to authenticated;
