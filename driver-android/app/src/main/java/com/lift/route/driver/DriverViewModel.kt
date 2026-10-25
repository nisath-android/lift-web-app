package com.lift.route.driver

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class DriverUiState(
    val configured: Boolean = LiftSupabase.isConfigured,
    val signedIn: Boolean = false,
    val busy: Boolean = false,
    val status: String = "Sign in with an approved driver account.",
    val offers: List<DriverOffer> = emptyList(),
)

class DriverViewModel : ViewModel() {
    private val api = DriverApi()
    private val _state = MutableStateFlow(DriverUiState())
    val state = _state.asStateFlow()

    init {
        if (LiftSupabase.isConfigured) {
            _state.value = _state.value.copy(signedIn = api.hasSession())
        }
    }

    fun signIn(email: String, password: String) = runAction {
        api.signIn(email, password)
        _state.value = _state.value.copy(signedIn = true, status = "Signed in. Checking approved driver offers…")
        refreshOffers()
    }

    fun signOut() = runAction {
        api.signOut()
        _state.value = DriverUiState(configured = LiftSupabase.isConfigured, status = "Signed out.")
    }

    fun publishPilotRoute() = runAction {
        val routeId = api.publishPilotRoute()
        _state.value = _state.value.copy(status = "Route $routeId is published for the closed pilot.")
    }

    fun refreshOffers() = runAction {
        val offers = api.loadSelectedOffers()
        _state.value = _state.value.copy(offers = offers, status = if (offers.isEmpty()) "No selected offers right now." else "${offers.size} selected offer(s) ready for review.")
    }

    fun acceptOffer(offerId: String) = runAction {
        val bookingId = api.acceptOffer(offerId)
        _state.value = _state.value.copy(status = "Seat reserved server-side. Booking $bookingId.")
        refreshOffers()
    }

    private fun runAction(block: suspend () -> Unit) {
        if (!_state.value.configured) return
        viewModelScope.launch {
            _state.value = _state.value.copy(busy = true)
            try {
                block()
            } catch (error: Throwable) {
                _state.value = _state.value.copy(status = error.message ?: "Driver action could not be completed.")
            } finally {
                _state.value = _state.value.copy(busy = false)
            }
        }
    }
}
