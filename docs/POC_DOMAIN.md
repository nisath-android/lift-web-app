# Planned-route POC domain rules

## Purpose

The first pilot demonstrates a conservative matcher over ordered, approved stops. It does not infer a route from straight-line distance, send a driver to a passenger, or treat a passenger confirmation as a payment event.

## Matching invariant

A route is eligible only when all of these rules are true:

1. The route is `PUBLISHED` and is in planned mode.
2. Both requested stops occur in the route’s immutable stop sequence.
3. `pickup.sequence < drop.sequence`.
4. `pickup.sequence` is ahead of the driver’s current confirmed route progress.
5. The requested seat count is no greater than `seat_capacity - seat_reserved`.
6. The pickup and drop have a positive approved-roadside safety status.
7. The pickup ETA fits the request time window.

The browser demo implements these rules with seeded data, derives an ETA for the selected stop, and freezes the accepted route snapshot. It is intentionally browser-local. The Supabase MVP migration now calculates and enforces these rules server-side inside a database transaction for every reservation; the UI remains to be connected to it.

## Lifecycle separation

| Aggregate | State path | Important rule |
| --- | --- | --- |
| Ride request | `OPEN → MATCHED → BOOKED → COMPLETED` | `CANCELLED` and `EXPIRED` are terminal. |
| Driver route | `DRAFT → PUBLISHED → DEPARTED → COMPLETED` | Route edits after a booking require compatibility revalidation. |
| Offer | `PENDING → SELECTED → ACCEPTED` | An offer is separate from a booking and captures the route version and expiry. |
| Booking/trip | `DRIVER_EN_ROUTE → DRIVER_ARRIVED → OTP_VERIFIED → DROP_PROPOSED → COMPLETED` | Only a valid, single-use pickup OTP can start a trip. The backend caps attempts at three, expires it after two minutes, stores only a hash, and never writes the plaintext to audit data. |
| Payment | `NOT_CREATED` in this POC | Trip completion is never proof of payment. |

## Capacity transaction

The POC only simulates a seat hold in one browser and releases it after the demo drop is confirmed. It does not claim atomicity.

Production must lock the active route row and atomically check available capacity before incrementing `seat_reserved`. Any later simultaneous acceptance must get a `409 CAPACITY_CONFLICT`; it must never create an accepted booking beyond capacity.

## Auditable decisions

For each request, persist both accepted candidates and rejected reasons such as `WRONG_DIRECTION`, `PICKUP_BEHIND_DRIVER`, `CAPACITY_EXHAUSTED`, `OUTSIDE_ROUTE`, and `TIME_WINDOW_MISS`. This supports operations review without exposing passenger data to unrelated drivers.

## Launch flags

| Flag | POC value | Meaning |
| --- | --- | --- |
| `PAID_RIDES_ENABLED` | `false` | No payment intent, QR, settlement, or receipt may be created. |
| `ROAMING_ENABLED` | `false` | Only driver-declared planned routes can be matched. |
| `PLANNED_ROUTE_ENABLED` | `true` | Enables the stop-order matcher. |
| `VEHICLE_CATEGORY_ENABLED` | `PILOT_ONLY` | Keeps activation constrained pending compliance approval. |
