package com.lift.route.driver

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class DriverAuthStep { SIGN_IN, EMAIL, EMAIL_CODE, ACCOUNT_DETAILS, RESET_PASSWORD }

data class DriverUiState(
    val configured: Boolean = LiftSupabase.isConfigured,
    val signedIn: Boolean = false,
    val busy: Boolean = false,
    val status: String = "Sign in with an approved driver account.",
    val offers: List<DriverOffer> = emptyList(),
    val authStep: DriverAuthStep = DriverAuthStep.SIGN_IN,
    val authFlow: String = "sign-in",
    val pendingEmail: String = "",
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

    fun signIn(phone: String, password: String) = runAction {
        api.signIn(phone, password)
        _state.value = _state.value.copy(signedIn = true, status = "Signed in. Checking approved driver offers…")
        refreshOffers()
    }

    fun startSignUp() {
        _state.value = _state.value.copy(authStep = DriverAuthStep.EMAIL, authFlow = "sign-up", status = "Enter your verified email to receive a code.")
    }

    fun startPasswordReset() {
        _state.value = _state.value.copy(authStep = DriverAuthStep.EMAIL, authFlow = "reset", status = "Enter your verified recovery email.")
    }

    fun returnToSignIn() {
        _state.value = _state.value.copy(authStep = DriverAuthStep.SIGN_IN, authFlow = "sign-in", pendingEmail = "", status = "Sign in with an approved driver account.")
    }

    fun sendEmailCode(email: String) = runAction {
        api.sendEmailCode(email, createUser = _state.value.authFlow == "sign-up")
        _state.value = _state.value.copy(authStep = DriverAuthStep.EMAIL_CODE, pendingEmail = email.trim(), status = "Email code sent. Check inbox and spam folder.")
    }

    fun verifyEmailCode(code: String) = runAction {
        api.verifyEmailCode(_state.value.pendingEmail, code)
        val reset = _state.value.authFlow == "reset"
        _state.value = _state.value.copy(
            authStep = if (reset) DriverAuthStep.RESET_PASSWORD else DriverAuthStep.ACCOUNT_DETAILS,
            status = if (reset) "Email verified. Choose a new password." else "Email verified. Add your phone login ID and password.",
        )
    }

    fun finishRegistration(name: String, phone: String, password: String) = runAction {
        api.finishRegistration(name, phone, password)
        _state.value = _state.value.copy(signedIn = true, status = "Account ready. Operations must approve this driver before route publishing is available.")
        refreshOffers()
    }

    fun finishPasswordReset(password: String) = runAction {
        api.resetPassword(password)
        _state.value = _state.value.copy(authStep = DriverAuthStep.SIGN_IN, authFlow = "sign-in", pendingEmail = "", status = "Password updated. Sign in with phone and password.")
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
