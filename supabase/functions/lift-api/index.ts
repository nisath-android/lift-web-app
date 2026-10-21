import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type JsonObject = Record<string, unknown>;

const defaultOrigins = [
  "http://127.0.0.1:4173",
  "http://localhost:4173",
  "https://lift-route-match-poc-2026.surebread129.chatgpt.site",
];

const allowedOrigins = new Set(
  (Deno.env.get("LIFT_ALLOWED_ORIGINS") ?? defaultOrigins.join(","))
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabasePublishableKey =
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  Deno.env.get("SB_PUBLISHABLE_KEY") ??
  Deno.env.get("SUPABASE_ANON_KEY");

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const idempotencyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const otpPattern = /^\d{6}$/;

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

  if (origin && allowedOrigins.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function json(request: Request, status: number, body: JsonObject): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(request) });
}

function errorResponse(request: Request, status: number, code: string): Response {
  return json(request, status, { error: { code } });
}

function requireObject(value: unknown): JsonObject {
  if (!isObject(value)) throw new RequestValidationError("INVALID_PAYLOAD");
  return value;
}

function requireString(payload: JsonObject, key: string, maxLength = 2000): string {
  const value = payload[key];
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new RequestValidationError(`INVALID_${toErrorToken(key)}`);
  }
  return value.trim();
}

function optionalString(payload: JsonObject, key: string, maxLength = 2000): string | null {
  const value = payload[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new RequestValidationError(`INVALID_${toErrorToken(key)}`);
  }
  return value.trim();
}

function requireUuid(payload: JsonObject, key: string): string {
  const value = requireString(payload, key, 36);
  if (!uuidPattern.test(value)) throw new RequestValidationError(`INVALID_${toErrorToken(key)}`);
  return value;
}

function optionalUuid(payload: JsonObject, key: string): string | null {
  const value = optionalString(payload, key, 36);
  if (value !== null && !uuidPattern.test(value)) throw new RequestValidationError(`INVALID_${toErrorToken(key)}`);
  return value;
}

function requireInteger(payload: JsonObject, key: string, minimum: number, maximum: number): number {
  const value = payload[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RequestValidationError(`INVALID_${toErrorToken(key)}`);
  }
  return value;
}

function requireTimestamp(payload: JsonObject, key: string): string {
  const value = requireString(payload, key, 64);
  if (Number.isNaN(Date.parse(value))) throw new RequestValidationError(`INVALID_${toErrorToken(key)}`);
  return value;
}

function requireEnum<T extends string>(payload: JsonObject, key: string, values: readonly T[]): T {
  const value = requireString(payload, key, 64) as T;
  if (!values.includes(value)) throw new RequestValidationError(`INVALID_${toErrorToken(key)}`);
  return value;
}

function requireIdempotencyKey(body: JsonObject): string {
  const value = requireString(body, "idempotencyKey", 128);
  if (!idempotencyPattern.test(value)) throw new RequestValidationError("INVALID_IDEMPOTENCY_KEY");
  return value;
}

function toErrorToken(value: string): string {
  return value.replace(/([A-Z])/g, "_$1").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_/, "").toUpperCase();
}

class RequestValidationError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function statusForRpcError(error: { code?: string; message?: string }): number {
  switch (error.code) {
    case "PT400":
    case "PGRST116":
      return 400;
    case "PT401":
      return 401;
    case "PT403":
      return 403;
    case "PT404":
      return 404;
    case "PT409":
      return 409;
    default:
      return 500;
  }
}

function safeRpcCode(error: { code?: string; message?: string }): string {
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(error.message ?? "")
    ? (error.message as string)
    : "REQUEST_FAILED";
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (request.method !== "POST") return errorResponse(request, 405, "METHOD_NOT_ALLOWED");

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 20_000) {
    return errorResponse(request, 413, "REQUEST_TOO_LARGE");
  }
  if (!supabaseUrl || !supabasePublishableKey) {
    return errorResponse(request, 500, "FUNCTION_NOT_CONFIGURED");
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return errorResponse(request, 401, "AUTH_REQUIRED");

  let body: JsonObject;
  try {
    body = requireObject(await request.json());
  } catch (error) {
    return errorResponse(
      request,
      400,
      error instanceof RequestValidationError ? error.code : "INVALID_JSON_BODY",
    );
  }

  const supabase = createClient(supabaseUrl, supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return errorResponse(request, 401, "AUTH_REQUIRED");

  try {
    const action = requireString(body, "action", 64);
    const payload = requireObject(body.payload ?? {});
    let functionName: string;
    let args: JsonObject;

    switch (action) {
      case "create-route":
        functionName = "create_route";
        args = {
          p_departure_at: requireTimestamp(payload, "departureAt"),
          p_seat_capacity: requireInteger(payload, "seatCapacity", 1, 4),
          p_idempotency_key: requireIdempotencyKey(body),
        };
        break;
      case "add-route-stop":
        functionName = "add_route_stop";
        args = {
          p_route_id: requireUuid(payload, "routeId"),
          p_place_id: requireUuid(payload, "placeId"),
          p_planned_eta: requireTimestamp(payload, "plannedEta"),
          p_cumulative_m: requireInteger(payload, "cumulativeM", 0, 2_000_000),
          p_idempotency_key: requireIdempotencyKey(body),
        };
        break;
      case "publish-route":
        functionName = "publish_route";
        args = { p_route_id: requireUuid(payload, "routeId"), p_idempotency_key: requireIdempotencyKey(body) };
        break;
      case "update-route-progress":
        functionName = "update_route_progress";
        args = {
          p_route_id: requireUuid(payload, "routeId"),
          p_current_stop_sequence: requireInteger(payload, "currentStopSequence", 0, 255),
          p_idempotency_key: requireIdempotencyKey(body),
        };
        break;
      case "create-ride-request":
        functionName = "create_ride_request";
        args = {
          p_pickup_place_id: requireUuid(payload, "pickupPlaceId"),
          p_drop_place_id: requireUuid(payload, "dropPlaceId"),
          p_earliest_departure_at: requireTimestamp(payload, "earliestDepartureAt"),
          p_latest_departure_at: requireTimestamp(payload, "latestDepartureAt"),
          p_seat_qty: requireInteger(payload, "seatQty", 1, 2),
          p_idempotency_key: requireIdempotencyKey(body),
        };
        break;
      case "match-ride-request":
        functionName = "match_ride_request";
        args = { p_request_id: requireUuid(payload, "requestId"), p_idempotency_key: requireIdempotencyKey(body) };
        break;
      case "select-offer":
        functionName = "select_offer";
        args = { p_offer_id: requireUuid(payload, "offerId"), p_idempotency_key: requireIdempotencyKey(body) };
        break;
      case "accept-offer":
        functionName = "accept_offer";
        args = { p_offer_id: requireUuid(payload, "offerId"), p_idempotency_key: requireIdempotencyKey(body) };
        break;
      case "driver-arrived":
        functionName = "mark_driver_arrived";
        args = { p_booking_id: requireUuid(payload, "bookingId"), p_idempotency_key: requireIdempotencyKey(body) };
        break;
      case "reveal-pickup-otp":
        functionName = "reveal_pickup_otp_once";
        args = { p_booking_id: requireUuid(payload, "bookingId") };
        break;
      case "verify-pickup-otp": {
        const otp = requireString(payload, "otp", 6);
        if (!otpPattern.test(otp)) throw new RequestValidationError("INVALID_PICKUP_OTP_FORMAT");
        functionName = "verify_pickup_otp";
        args = { p_booking_id: requireUuid(payload, "bookingId"), p_otp: otp };
        break;
      }
      case "propose-drop":
        functionName = "propose_drop";
        args = { p_booking_id: requireUuid(payload, "bookingId"), p_idempotency_key: requireIdempotencyKey(body) };
        break;
      case "confirm-drop":
        functionName = "confirm_drop";
        args = { p_booking_id: requireUuid(payload, "bookingId"), p_idempotency_key: requireIdempotencyKey(body) };
        break;
      case "set-driver-approval":
        functionName = "set_driver_approval";
        args = {
          p_driver_id: requireUuid(payload, "driverId"),
          p_status: requireEnum(payload, "status", ["PENDING", "APPROVED", "SUSPENDED", "REJECTED"]),
          p_reason: optionalString(payload, "reason", 500),
          p_idempotency_key: requireIdempotencyKey(body),
        };
        break;
      case "report-incident":
        functionName = "report_incident";
        args = {
          p_booking_id: optionalUuid(payload, "bookingId"),
          p_category: requireEnum(payload, "category", ["SAFETY", "NO_SHOW", "CONDUCT", "ROUTE", "OTHER"]),
          p_severity: requireEnum(payload, "severity", ["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
          p_description: requireString(payload, "description", 2000),
          p_idempotency_key: requireIdempotencyKey(body),
        };
        break;
      case "resolve-incident":
        functionName = "resolve_incident";
        args = {
          p_incident_id: requireUuid(payload, "incidentId"),
          p_resolution: requireString(payload, "resolution", 2000),
          p_idempotency_key: requireIdempotencyKey(body),
        };
        break;
      case "pilot-metrics":
        functionName = "pilot_metrics";
        args = {
          p_from: payload.from === undefined ? undefined : requireTimestamp(payload, "from"),
          p_to: payload.to === undefined ? undefined : requireTimestamp(payload, "to"),
        };
        break;
      default:
        return errorResponse(request, 404, "UNKNOWN_ACTION");
    }

    // The database shape is generated after the first remote deployment.
    // Keep the untyped boundary here; inputs and returned error codes are
    // validated in this function, and RPC authorization remains in Postgres.
    const { data, error } = await (supabase as any).schema("api").rpc(functionName, args);
    if (error) return errorResponse(request, statusForRpcError(error), safeRpcCode(error));

    if (isObject(data) && data.ok === false) {
      const code = typeof data.code === "string" ? data.code : "REQUEST_CONFLICT";
      const response: JsonObject = { error: { code } };
      if (typeof data.attemptsRemaining === "number") response.attemptsRemaining = data.attemptsRemaining;
      return json(request, 409, response);
    }

    return json(request, 200, { data });
  } catch (error) {
    if (error instanceof RequestValidationError) return errorResponse(request, 400, error.code);
    return errorResponse(request, 500, "UNEXPECTED_FUNCTION_ERROR");
  }
});
