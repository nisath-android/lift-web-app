package com.lift.route.driver

import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.functions.Functions
import io.github.jan.supabase.auth.Auth

/**
 * The Android app intentionally receives only a Supabase publishable key.
 * All business mutations remain behind the JWT-protected lift-api Edge Function.
 */
object LiftSupabase {
    val isConfigured: Boolean
        get() = BuildConfig.SUPABASE_URL.isNotBlank() && BuildConfig.SUPABASE_PUBLISHABLE_KEY.isNotBlank()

    val client by lazy {
        check(isConfigured) {
            "Missing SUPABASE_URL. Create driver-android/local.properties from local.properties.example."
        }

        createSupabaseClient(
            supabaseUrl = BuildConfig.SUPABASE_URL,
            supabaseKey = BuildConfig.SUPABASE_PUBLISHABLE_KEY,
        ) {
            install(Auth)
            install(Functions)
        }
    }
}
