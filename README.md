# Lift — planned-route matching POC

An interactive, browser-only proof of concept for the core Lift product idea: match a passenger to a driver only when the pickup and drop are forward along the driver’s already-planned route, an approved stop exists, and seat capacity remains.

## Run locally

```powershell
cd E:\GOOGLE_ANTIGRAVITY_WORKSPACE\LIFT\lift-route-match-poc\dist
python -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173`.

## What the prototype includes

- Passenger route request using seeded Coimbatore stops.
- Forward-order, safe-stop, time, and capacity filtering.
- Two eligible seeded routes plus rejected reverse-direction and full-capacity cases.
- Passenger selection → driver acceptance → arrival → pickup OTP → drop proposal → passenger confirmation.
- Driver workspace with an explicit seat lock and no roaming mode.
- Operations screen with decision trace, audit events, and server-side feature-flag concepts.
- Accessible responsive UI with a map-independent explanation of every route decision.

## Intentional boundaries

This is a visual and interaction POC; it has no backend, persistent storage, live GPS, payment processing, identity verification, routing-provider calls, or real-world dispatch. `PAID_RIDES_ENABLED` and `ROAMING_ENABLED` are deliberately displayed as disabled.

The production-shaped contract and schema that should back this UI are included in [docs/openapi.yaml](docs/openapi.yaml), [docs/POC_DOMAIN.md](docs/POC_DOMAIN.md), and [database/001_poc_schema.sql](database/001_poc_schema.sql).

## Manual acceptance walkthrough

1. Leave the default `Nava India → Peelamedu` request selected: the app should show two compatible drivers.
2. Reserve Asha’s lift, then open **Driver console** and accept the request.
3. Mark arrival, copy the displayed four-digit pickup code, and verify it in the driver console.
4. Finish at the drop-off, return to **Passenger**, and confirm the demo drop.
5. Open **Operations** to inspect the audit events and rejected candidates.
6. Choose a reverse direction or two seats and search again to observe safe no-match/capacity behavior.
