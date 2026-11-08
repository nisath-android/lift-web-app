import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type JsonObject = Record<string, unknown>;

const defaultOrigins = [
  "http://127.0.0.1:4173",
  "http://localhost:4173",
  "http://127.0.0.1:4174",
  "http://localhost:4174",
  "https://lift-route-match-poc-2026.surebread129.chatgpt.site",
  "https://lift-web-app.vercel.app",
];

const allowedOrigins = new Set(
  (Deno.env.get("LIFT_ALLOWED_ORIGINS") ?? defaultOrigins.join(","))
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const publishableKey =
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  Deno.env.get("SB_PUBLISHABLE_KEY") ??
  Deno.env.get("SUPABASE_ANON_KEY");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const phonePattern = /^\+[1-9]\d{6,14}$/;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
  if (origin && allowedOrigins.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function respond(request: Request, status: number, body: JsonObject): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(request) });
}

function fail(request: Request, status: number, code: string): Response {
  return respond(request, status, { error: { code } });
}

function stringField(payload: JsonObject, key: string, minimum: number, maximum: number): string | null {
  const value = payload[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= minimum && trimmed.length <= maximum ? trimmed : null;
}

function passwordField(payload: JsonObject): string | null {
  const value = payload.password;
  return typeof value === "string" && value.length >= 10 && value.length <= 128 ? value : null;
}

function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  return value?.startsWith("Bearer ") ? value : null;
}

function sessionPayload(session: { access_token: string; refresh_token: string; expires_in: number; token_type: string }) {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresIn: session.expires_in,
    tokenType: session.token_type,
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (request.method !== "POST") return fail(request, 405, "METHOD_NOT_ALLOWED");
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) return fail(request, 500, "FUNCTION_NOT_CONFIGURED");

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 10_000) return fail(request, 413, "REQUEST_TOO_LARGE");

  let body: JsonObject;
  try {
    const parsed: unknown = await request.json();
    if (!isObject(parsed)) return fail(request, 400, "INVALID_PAYLOAD");
    body = parsed;
  } catch {
    return fail(request, 400, "INVALID_JSON_BODY");
  }

  const action = stringField(body, "action", 1, 64);
  if (!action) return fail(request, 400, "INVALID_ACTION");

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (action === "password-sign-in") {
    const phone = stringField(body, "phone", 8, 16);
    const password = passwordField(body);
    if (!phone || !phonePattern.test(phone) || !password) return fail(request, 400, "INVALID_LOGIN_INPUT");

    const { data: userId, error: aliasLookupError } = await admin
      .schema("api")
      .rpc("resolve_login_phone_alias", { p_phone_e164: phone });
    if (aliasLookupError || typeof userId !== "string") return fail(request, 401, "INVALID_LOGIN");

    const { data: userResult } = await admin.auth.admin.getUserById(userId);
    const email = userResult.user?.email;
    if (!email) return fail(request, 401, "INVALID_LOGIN");

    const auth = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await auth.auth.signInWithPassword({ email, password });
    if (error || !data.session) return fail(request, 401, "INVALID_LOGIN");
    return respond(request, 200, { data: { session: sessionPayload(data.session) } });
  }

  if (action !== "complete-registration") return fail(request, 404, "UNKNOWN_ACTION");

  const authorization = bearerToken(request);
  if (!authorization) return fail(request, 401, "AUTH_REQUIRED");
  const displayName = stringField(body, "displayName", 1, 80);
  const phone = stringField(body, "phone", 8, 16);
  const password = passwordField(body);
  if (!displayName || !phone || !phonePattern.test(phone) || !password) return fail(request, 400, "INVALID_REGISTRATION_INPUT");

  const userClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  const user = userData.user;
  if (userError || !user || !user.email_confirmed_at) return fail(request, 403, "EMAIL_VERIFICATION_REQUIRED");

  const { error: passwordError } = await admin.auth.admin.updateUserById(user.id, { password });
  if (passwordError) return fail(request, 400, "PASSWORD_UPDATE_FAILED");

  const { error: aliasError } = await admin.schema("api").rpc("claim_login_phone_alias", {
    p_user_id: user.id,
    p_phone_e164: phone,
  });
  if (aliasError) {
    if (aliasError.code === "PT409" || aliasError.message === "PHONE_ALREADY_IN_USE") {
      return fail(request, 409, "PHONE_ALREADY_IN_USE");
    }
    return fail(request, 500, "PHONE_ALIAS_UPDATE_FAILED");
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({ display_name: displayName, phone_e164: phone })
    .eq("id", user.id);
  if (profileError) return fail(request, 500, "PROFILE_UPDATE_FAILED");

  return respond(request, 200, { data: { phoneE164: phone, emailVerified: true } });
});
