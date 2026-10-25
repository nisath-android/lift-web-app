# Lift Driver Android

Native Android companion for **approved drivers only**. Passenger booking remains in the `dist/` Progressive Web App.

## Identity

- Application ID / Android package: `com.lift.route.driver`
- Stack: Kotlin, Jetpack Compose, Google Maps Compose, Supabase Auth and Edge Functions.
- Backend boundary: the app calls only the JWT-protected `lift-api` Edge Function. Capacity, route-order validation, approval, and booking creation stay enforced in Supabase.

## Local setup

1. Open this `driver-android` folder in Android Studio.
2. Copy `local.properties.example` to `local.properties`.
3. Add the existing Lift Supabase project URL and its **publishable** key. Never add a service-role key.
4. Create a **new Android-restricted** Google Maps key. Restrict it to package `com.lift.route.driver` and the SHA-1 of the debug/release signing certificate that will run the app. Put it in `MAPS_API_KEY`.
5. Sync Gradle and run on an Android 8.0+ device or emulator with Google Play services.

## Pilot onboarding

1. The driver creates/signs into the existing email/password account.
2. Operations grants the user the `DRIVER` role and marks the driver `APPROVED` in the backend.
3. The driver signs in here, publishes the six fixed pilot stops, reviews selected offers, and accepts an offer.

This client intentionally has no self-service driver-role grant, payment, or free-form pickup feature.
