# Lift implementation handover

**Document version:** 1.0.0  
**Prepared:** 2026-10-21  
**Database query / migration version:** `20261020211524_lift_backend_mvp`  
**Edge API contract version:** 1.0.0  
**Implementation commit:** `513c108` — `Build Supabase backend MVP skeleton`

## Executive status

The browser proof of concept is still running as a local simulation. The backend MVP foundation is now present in this repository: a Supabase schema, Row Level Security (RLS), server-side route matching, transactional seat booking, OTP trip hand-off, audit history, and pilot-operations commands.

It has **not** been connected to a remote Lift Supabase project or to the static UI yet. No unrelated Supabase project was changed.

## Completed work

| Area | Delivered |
| --- | --- |
| Supabase project scaffold | `supabase/config.toml`, environment template, Edge Function structure, migrations, and pgTAP checks. |
| Authentication and roles | Auth user → profile trigger; default `PASSENGER` role; controlled `DRIVER` and `OPS` roles; Ops driver approval. |
| Data model | Profiles, routes/stops, approved places, requests, match runs/candidates, offers, bookings, reservation ledger, OTP challenges, incidents, idempotency, and audit events. |
| Security | RLS on all MVP tables; clients cannot directly change capacity, approval, booking state, OTP data, or audit history. Domain changes go through the private `api` RPC boundary. |
| Matching | Only approved drivers, active approved stops, correct travel direction, valid time window, and available capacity result in an offer. Rejections are retained with a reason. |
| Atomic booking | `accept_offer` uses locks and a conditional capacity update to prevent two passengers taking the same final seat. It rechecks route version, time, stops, state, and availability before booking. |
| Trip hand-off | Driver arrival, passenger one-time OTP reveal, driver OTP verification, drop proposal, and passenger drop confirmation. OTP is hash-only, short-lived, attempt-limited, and excluded from audit records. |
| Operations | Driver approval, incident reporting/resolution, immutable audit events, and closed-pilot metrics. |

## Versioned query contract

`20261020211524_lift_backend_mvp` is the current single source of truth for database queries and rules. It must be deployed as one Supabase migration, in order, and must not be edited after it has been pushed to a shared environment. Future database changes must use a new timestamped migration, for example `YYYYMMDDHHMMSS_lift_backend_v1_1.sql`.

| Query group | Version | RPC queries |
| --- | --- | --- |
| Route management | `20261020211524` | `create_route`, `add_route_stop`, `publish_route`, `update_route_progress` |
| Passenger request and matching | `20261020211524` | `create_ride_request`, `match_ride_request`, `select_offer` |
| Reservation and lifecycle | `20261020211524` | `accept_offer`, `mark_driver_arrived`, `reveal_pickup_otp_once`, `verify_pickup_otp`, `propose_drop`, `confirm_drop` |
| Operations | `20261020211524` | `set_driver_approval`, `report_incident`, `resolve_incident`, `pilot_metrics` |

All domain commands are called through one authenticated Edge Function endpoint with this envelope:

```json
{
  "action": "accept-offer",
  "idempotencyKey": "unique-client-operation-key",
  "payload": {}
}
```

Every state-changing command needs an idempotency key except the OTP reveal/verification flow. OTP does not keep an idempotency record because the key or a cached response must never become a source of the pickup code.

## Source map

| Source | Purpose |
| --- | --- |
| `supabase/migrations/20261020211524_lift_backend_mvp.sql` | Versioned schema, policies, triggers, indexes, and all RPC query implementations. |
| `supabase/functions/lift-api/index.ts` | JWT-protected HTTP action router, validation, CORS policy, and API error mapping. |
| `supabase/tests/lift_backend_test.sql` | pgTAP structural and security regression checks. |
| `supabase/.env.example` | Safe local environment-variable template. |
| `docs/BACKEND_MVP.md` | Full local-development, deployment, and pilot operating guide. |

## Verification completed

- Edge Function type-check passed with Deno.
- Supabase configuration parsed successfully.
- API documentation YAML parsed successfully.
- Git whitespace validation passed.
- Review fixes included the correct E.164 phone expression and safe OTP rotation after expiry or attempt exhaustion.

## Verification still required

Runtime database validation needs Docker Desktop or another supported local Supabase/Postgres runtime. It was not run in this workspace because Docker is unavailable.

```powershell
npx supabase start
npx supabase db reset
npx supabase test db
```

Before a live pilot, also test two simultaneous accepts for the final seat and confirm that exactly one succeeds.

## Deployment and integration remaining

1. Choose or create a dedicated **Lift** Supabase project.
2. Link it with `npx supabase link --project-ref <lift-project-ref>`.
3. Configure Supabase Auth redirect URLs for the deployed site and local development.
4. Expose only the `api` schema in Supabase API settings; do not expose `private`.
5. Deploy the query version: `npx supabase db push`.
6. Set `LIFT_ALLOWED_ORIGINS` as an Edge Function secret and deploy `lift-api` with JWT verification enabled.
7. Give the first pilot Ops/Driver roles through the controlled SQL bootstrap in `docs/BACKEND_MVP.md`.
8. Replace browser-local state in `dist/app.js` with Auth plus `supabase.functions.invoke('lift-api', ...)` calls.
9. Add Google Maps only as display/search UI after a browser-restricted Maps key is supplied; matching and seat capacity must remain server-side.

## Explicitly out of scope today

- Payments and payouts
- Live GPS tracking / driver roaming
- Dynamic routing-provider calls
- Public self-service driver approval
- A remote production deployment

## Change-log rule

For every backend change, add a new dated migration and update this table:

| Next change | Required versioning action |
| --- | --- |
| New database rule/query | New `supabase/migrations/<timestamp>_*.sql` file; do not rewrite an already-deployed migration. |
| New Edge action | Increase the Edge API contract version and document its action, payload, auth rule, and errors. |
| Behavioural change | Add/extend pgTAP coverage and run it against a local or remote test database. |

