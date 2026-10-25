package com.lift.route.driver

import io.github.jan.supabase.functions.functions
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import io.ktor.client.statement.bodyAsText
import java.time.Instant
import java.util.UUID
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put

data class DriverOffer(
    val offerId: String,
    val passengerName: String,
    val pickupName: String,
    val dropName: String,
    val seatQty: Int,
)

/** Calls the existing JWT-protected lift-api Edge Function; no direct table writes occur here. */
class DriverApi {
    private val client get() = LiftSupabase.client
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun signIn(email: String, password: String) {
        client.auth.signInWith(Email) {
            this.email = email.trim()
            this.password = password
        }
    }

    suspend fun signOut() = client.auth.signOut()

    fun hasSession(): Boolean = client.auth.currentSessionOrNull() != null

    suspend fun publishPilotRoute(): String {
        val departure = Instant.now().plusSeconds(20 * 60)
        val route = invoke(
            action = "create-route",
            payload = buildJsonObject {
                put("departureAt", departure.toString())
                put("seatCapacity", 2)
            },
        ).jsonObject
        val routeId = route["routeId"]?.jsonPrimitive?.content
            ?: error("Route identifier missing from the server response")

        pilotPlaceIds.forEachIndexed { index, placeId ->
            invoke(
                action = "add-route-stop",
                payload = buildJsonObject {
                    put("routeId", routeId)
                    put("placeId", placeId)
                    put("plannedEta", departure.plusSeconds(index * 8L * 60).toString())
                    put("cumulativeM", index * 1300)
                },
            )
        }
        invoke("publish-route", buildJsonObject { put("routeId", routeId) })
        return routeId
    }

    suspend fun loadSelectedOffers(): List<DriverOffer> {
        val result = invoke("list-driver-offers")
        val offers = result as? JsonArray ?: return emptyList()
        return offers.mapNotNull { item ->
            val row = item.jsonObject
            val offerId = row["offerId"]?.jsonPrimitive?.content ?: return@mapNotNull null
            DriverOffer(
                offerId = offerId,
                passengerName = row["passengerName"]?.jsonPrimitive?.content ?: "Passenger",
                pickupName = row["pickupName"]?.jsonPrimitive?.content ?: "Approved pickup",
                dropName = row["dropName"]?.jsonPrimitive?.content ?: "Approved drop",
                seatQty = row["seatQty"]?.jsonPrimitive?.intOrNull ?: 1,
            )
        }
    }

    suspend fun acceptOffer(offerId: String): String {
        val result = invoke("accept-offer", buildJsonObject { put("offerId", offerId) }).jsonObject
        return result["bookingId"]?.jsonPrimitive?.content ?: "created"
    }

    private suspend fun invoke(action: String, payload: JsonObject = buildJsonObject {}): JsonElement {
        val request = buildJsonObject {
            put("action", action)
            put("payload", payload)
            if (action != "list-driver-offers") put("idempotencyKey", UUID.randomUUID().toString())
        }
        val response = client.functions.invoke(function = "lift-api", body = request)
        val envelope = json.parseToJsonElement(response.bodyAsText()).jsonObject
        val errorCode = envelope["error"]?.jsonObject?.get("code")?.jsonPrimitive?.content
        if (errorCode != null) error(errorCode)
        return envelope["data"] ?: error("EMPTY_SERVER_RESPONSE")
    }

    private companion object {
        // Approved Coimbatore pilot stops. IDs mirror the audited Supabase migration.
        val pilotPlaceIds = listOf(
            "10000000-0000-4000-8000-000000000001",
            "10000000-0000-4000-8000-000000000002",
            "10000000-0000-4000-8000-000000000003",
            "10000000-0000-4000-8000-000000000004",
            "10000000-0000-4000-8000-000000000005",
            "10000000-0000-4000-8000-000000000006",
        )
    }
}
