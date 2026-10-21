# Lift — planned-route matching POC + backend MVP scaffold

An interactive proof of concept for the core Lift product idea: match a passenger to a driver only when the pickup and drop are forward along the driver’s already-planned route, an approved stop exists, and seat capacity remains.

## Run locally

```powershell
cd E:\GOOGLE_ANTIGRAVITY_WORKSPACE\LIFT\lift-route-match-poc\dist
python -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173`.

## What the prototype includes

- Passenger route request using seeded Coimbatore stops.
- Forward-order, approved-stop, per-stop ETA, and capacity filtering.
- Two eligible seeded routes plus rejected default-direction and full-capacity cases.
- Passenger selection → driver acceptance → arrival → attempt-capped pickup OTP → drop proposal → passenger confirmation.
- Driver workspace with a clearly labelled browser-only seat simulation and no roaming mode.
- Operations screen with a browser-local decision trace and server-side feature-flag concepts.
- Accessible responsive UI with a map-independent explanation of every route decision.

## Backend MVP scaffold

The real backend foundation is now deployed to the dedicated **Lift** Supabase project in `ap-south-1`, but is **not wired into the static UI yet**. It includes:

- Supabase Auth-backed profiles, passenger/driver/ops roles, and driver approval.
- PostgreSQL tables, RLS, immutable audit events, approved stops, matching history, offers, incidents, and pilot metrics.
- Security-definer RPCs for route publication, server-side matching, atomic seat reservation, lifecycle changes, and one-time pickup OTP verification.
- A protected `lift-api` Edge Function that passes the caller JWT into the API schema; it does not use a browser-held service-role key.
- pgTAP schema/security checks.

Start with [docs/IMPLEMENTATION_HANDOVER_v1.0.md](docs/IMPLEMENTATION_HANDOVER_v1.0.md) for the completed-work status and versioned query contract, then use [docs/BACKEND_MVP.md](docs/BACKEND_MVP.md) for the operational guide. The implementation source of truth is [supabase/migrations/20261020211524_lift_backend_mvp.sql](supabase/migrations/20261020211524_lift_backend_mvp.sql) and [supabase/functions/lift-api/index.ts](supabase/functions/lift-api/index.ts).

## Intentional boundaries

The current browser UI is still a visual and interaction POC: it has no live backend connection, GPS, payments, routing-provider calls, or real-world dispatch. Its current seat and OTP screens are browser-local demos; the new backend is the source of truth once the client is connected. `PAID_RIDES_ENABLED` and `ROAMING_ENABLED` remain deliberately disabled.

The historical POC contract and domain sketch remain in [docs/openapi.yaml](docs/openapi.yaml), [docs/POC_DOMAIN.md](docs/POC_DOMAIN.md), and [database/001_poc_schema.sql](database/001_poc_schema.sql). They are not the deployed backend contract; see [docs/BACKEND_MVP.md](docs/BACKEND_MVP.md) instead.

## Manual acceptance walkthrough

1. Leave the default `Nava India → Peelamedu` request selected: the app should show two compatible drivers.
2. Reserve Asha’s lift, then open **Driver console** and accept the request.
3. Mark arrival, copy the displayed four-digit pickup code, and verify it in the driver console.
4. Finish at the drop-off, return to **Passenger**, and confirm the demo drop.
5. Open **Operations** to inspect the audit events and rejected candidates.
6. Search at `9:00 AM` to observe time-window rejection, choose two seats to observe capacity rejection, or try `Hope College → Gandhipuram` to see the reverse-planned Kiran route render in its own direction.
