# LIFT authentication — Email OTP + phone login alias

## Current pilot model

Both the Passenger PWA and the Driver Android app use the same low-cost account model:

1. The user enters an email address and receives a six-digit Supabase email OTP.
2. The app verifies that OTP. The verified email is the account's identity and recovery channel.
3. The user enters a phone number and a password. The phone number is normalized to E.164 format and stored only as a private login alias.
4. Subsequent sign-in uses **phone number + password**. The secure server-side gateway resolves the private alias and verifies the password against the underlying Supabase email account.
5. Password reset starts with an email OTP, then lets the verified user choose a new password.

There is no SMS, WhatsApp, Firebase phone verification, or phone OTP in this pilot. A phone number must never be presented as ownership-verified until a real SMS/voice verification provider is enabled.

## User-facing behaviour

| Product | Create account | Sign in | Password recovery |
| --- | --- | --- | --- |
| Passenger PWA | verified email OTP → name, phone login ID, password | phone + password | verified email OTP → new password |
| Driver Android app | verified email OTP → name, phone login ID, password | phone + password | verified email OTP → new password |

Driver self-registration does **not** grant driver privileges. Operations must first assign the `DRIVER` role and approve the driver before that account can publish pilot routes.

## Supabase components

- `private.login_phone_aliases`: unique private `phone_e164 → user_id` mapping, with RLS on and no browser access.
- `api.claim_login_phone_alias` and `api.resolve_login_phone_alias`: service-role-only operations; the former atomically claims an alias and the latter lets the server resolve it without exposing the private schema through the Data API.
- `auth-gateway` Edge Function: performs phone/password sign-in without revealing which phone aliases exist, and completes registration only for a user with `email_confirmed_at`.
- Supabase Auth: issues email OTPs and stores password credentials. The PWA and Android app contain only publishable client credentials—never a service-role secret.

## Required dashboard setting

In Supabase Dashboard, configure Email OTP before pilot users sign up:

1. Open **Authentication → Email Templates → Magic Link**.
2. Use the email-token variable `{{ .Token }}` in the subject/body, for example:

   ```html
   <h2>LIFT verification code</h2>
   <p>Your code is: <strong>{{ .Token }}</strong></p>
   <p>This code expires soon. Do not share it.</p>
   ```

3. Set the email OTP expiry and rate limits appropriate for the closed pilot.
4. Before production, configure a reputable SMTP provider and a verified sender domain. The default Supabase email service is only for limited testing.

## Security boundaries

- The browser and Android app cannot query phone aliases or map a number to an email address.
- Wrong phone/password pairs return one generic sign-in error, reducing account enumeration.
- Password changes and alias claims run only after an authenticated, email-verified session.
- Changing the phone login ID replaces the old private alias atomically; it never marks the new number verified.
- Later, add SMS/voice OTP only when genuine phone ownership proof is required for rides, payouts, or safety checks.

## Implementation files

- `supabase/migrations/20261106132508_email_verified_phone_alias_auth.sql`
- `supabase/migrations/20261106134315_resolve_private_phone_alias.sql`
- `supabase/migrations/20261106134430_allow_service_role_private_login_aliases.sql`
- `supabase/functions/auth-gateway/index.ts`
- `dist/live-client.js` and `dist/index.html` for the Passenger PWA
- `driver-android/app/src/main/java/com/lift/route/driver/DriverApi.kt`
- `driver-android/app/src/main/java/com/lift/route/driver/DriverViewModel.kt`
- `driver-android/app/src/main/java/com/lift/route/driver/MainActivity.kt`
