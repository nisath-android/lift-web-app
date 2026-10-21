# Lift backend MVP

This is the implementation contract for the closed pilot. It is deliberately separate from the static browser POC: the POC UI is not yet connected to this backend.

## What is implemented

- Supabase Auth identities become a `profiles` row and receive the `PASSENGER` role automatically.
- Drivers need both a `DRIVER` role and an Ops-owned `APPROVED` driver profile before they can create or publish routes.
- Matching persists every candidate/rejection, creates expiring offers, and only matches forward, approved, in-window route stops.
- `accept_offer` locks offer → request → route, rechecks route version/stops/time/capacity, conditionally reserves seats, writes the booking and reservation ledger, and returns `409` on a conflict.
- Lifecycle commands enforce the caller: driver arrives/proposes drop; passenger reveals the pickup code once and confirms drop; driver verifies the code.
- The six-digit pickup code is generated server-side, stored only as a bcrypt-style `pgcrypto` hash, expires in two minutes, and has three attempts. It is returned once per active challenge to the authenticated passenger with `Cache-Control: no-store`; it is not in event/audit tables. After expiry or attempt exhaustion, the passenger can rotate it without recovering the old value.
- Audit events are append-only. Ops can approve drivers, resolve incidents, and query pilot metrics.

## Local development

Prerequisites: Docker Desktop running, Node.js, and the Supabase CLI. The repository already contains the Supabase project scaffold.

```powershell
cd E:\GOOGLE_ANTIGRAVITY_WORKSPACE\LIFT\lift-route-match-poc
npx supabase start
npx supabase db reset
npx supabase test db
npx supabase functions serve lift-api --env-file supabase/.env
```

Copy `supabase/.env.example` to `supabase/.env` only for local development. It is ignored by Git. The browser may receive only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`; never put a service-role key in `dist/` or any browser bundle.

The Edge Function accepts one `POST` envelope:

```json
{
  "action": "create-ride-request",
  "idempotencyKey": "a-unique-client-operation-key",
  "payload": {}
}
```

Supported actions are `create-route`, `add-route-stop`, `publish-route`, `update-route-progress`, `create-ride-request`, `match-ride-request`, `select-offer`, `accept-offer`, `driver-arrived`, `reveal-pickup-otp`, `verify-pickup-otp`, `propose-drop`, `confirm-drop`, `set-driver-approval`, `report-incident`, `resolve-incident`, and `pilot-metrics`.

Every command except OTP reveal/verify and read-only metrics requires an idempotency key. OTP requests intentionally do not store a key or plaintext code, preventing a retry cache from becoming a code store.

## Remote deployment checklist

Use a fresh or explicitly confirmed **Lift** Supabase project; do not link an unrelated project.

1. Link the chosen project: `npx supabase link --project-ref <lift-project-ref>`.
2. In the Supabase Dashboard, configure Auth for the pilot and add the deployed website URL plus local development URLs as redirect URLs.
3. In Dashboard **Settings → API**, expose the `api` schema. Keep `auto-expose new tables` disabled and do not expose the `private` schema.
4. Deploy the migration: `npx supabase db push`.
5. Set the non-secret CORS list: `npx supabase secrets set LIFT_ALLOWED_ORIGINS=<comma-separated-origins>`.
6. Deploy: `npx supabase functions deploy lift-api`. Keep JWT verification enabled.
7. Run a signed-in smoke test for passenger, approved driver, and Ops roles. Test a same-seat double accept and verify exactly one succeeds.

Supabase provides the function URL and publishable/anon key. The current function uses the caller's JWT and does not require the service-role key. If a future server-to-server integration needs that key, store it only as an Edge Function secret.

## Closed-pilot bootstrapping

For the first 10–20 people, create accounts first. An operator then grants roles from the SQL editor or an admin-only migration. Do not make a public "grant role" endpoint.

```sql
-- Replace the UUID after the person has signed in once and has a profiles row.
insert into public.user_roles (user_id, role)
values ('<user-id>', 'OPS')
on conflict do nothing;

insert into public.user_roles (user_id, role)
values ('<driver-user-id>', 'DRIVER')
on conflict do nothing;
```

The Ops user can then use `set-driver-approval` through `lift-api`. Add a small, controlled set of `places` with approved pickup/drop flags through the SQL editor or a reviewed migration. Only these stops can be used in a request or published route.

Track `pilot-metrics` for requests, candidates/rejection reasons, offer conversion, confirmed/completed bookings, OTP failures, and open incidents. Keep payment, GPS, roaming, and map-provider routing disabled for this pilot.

## Before connecting the current UI

Replace the local simulation state in `dist/app.js` with Auth session handling and `supabase.functions.invoke('lift-api', ...)`; do not call domain tables directly. Add the project URL and publishable key through a build-time configuration file that is not committed with a secret. Keep the current map display-only when the Google Maps key is supplied; matching/capacity must remain server-side.
