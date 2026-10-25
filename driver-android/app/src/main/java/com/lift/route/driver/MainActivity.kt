package com.lift.route.driver

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Logout
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.MarkerState
import com.google.maps.android.compose.Polyline
import com.google.maps.android.compose.rememberCameraPositionState

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { LiftDriverTheme { LiftDriverApp() } }
    }
}

@Composable
private fun LiftDriverApp(viewModel: DriverViewModel = viewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    when {
        !state.configured -> ConfigurationRequired()
        !state.signedIn -> SignInScreen(state = state, onSignIn = viewModel::signIn)
        else -> DriverHome(
            state = state,
            onSignOut = viewModel::signOut,
            onPublishRoute = viewModel::publishPilotRoute,
            onRefreshOffers = viewModel::refreshOffers,
            onAcceptOffer = viewModel::acceptOffer,
        )
    }
}

@Composable
private fun ConfigurationRequired() {
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier.padding(28.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text("Lift Driver", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(16.dp))
            Text("Android setup needed", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(8.dp))
            Text("Copy local.properties.example to local.properties and add the Supabase publishable key, project URL, and Android-restricted Maps key. Never place a service-role key in this app.")
        }
    }
}

@Composable
private fun SignInScreen(state: DriverUiState, onSignIn: (String, String) -> Unit) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier.padding(28.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text("Lift Driver", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Text("Closed pilot driver console", color = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(28.dp))
            OutlinedTextField(email, { email = it }, label = { Text("Driver email") }, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(password, { password = it }, label = { Text("Password") }, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(16.dp))
            Button(
                onClick = { onSignIn(email, password) },
                enabled = !state.busy && email.isNotBlank() && password.length >= 8,
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (state.busy) "Signing in…" else "Sign in as driver") }
            Spacer(Modifier.height(12.dp))
            Text(state.status, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(20.dp))
            Text("Only accounts given the DRIVER role and APPROVED status by Operations can publish routes or accept offers.", style = MaterialTheme.typography.bodySmall)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DriverHome(
    state: DriverUiState,
    onSignOut: () -> Unit,
    onPublishRoute: () -> Unit,
    onRefreshOffers: () -> Unit,
    onAcceptOffer: (String) -> Unit,
) {
    Scaffold(
        topBar = {
            CenterAlignedTopAppBar(
                title = { Text("Lift Driver") },
                actions = { IconButton(onClick = onSignOut) { Icon(Icons.Rounded.Logout, "Sign out") } },
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 18.dp, top = padding.calculateTopPadding() + 8.dp, end = 18.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item { DriverStatusCard(state.status, state.busy) }
            item { RouteMap() }
            item {
                Text("Pilot route", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text("Gandhipuram → Saravanampatti · six approved stops", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            item {
                Button(onClick = onPublishRoute, enabled = !state.busy, modifier = Modifier.fillMaxWidth()) {
                    Text("Publish planned pilot route")
                }
            }
            item {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    Text("Selected passenger offers", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                    IconButton(onClick = onRefreshOffers, enabled = !state.busy) { Icon(Icons.Rounded.Refresh, "Refresh offers") }
                }
            }
            if (state.offers.isEmpty()) {
                item { Text("No selected offers to accept.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            } else {
                items(state.offers, key = { it.offerId }) { offer -> OfferCard(offer, state.busy, onAcceptOffer) }
            }
            item { Text("Acceptance is atomic: the backend rechecks forward route order and seat capacity before it creates a booking.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}

@Composable
private fun DriverStatusCard(message: String, busy: Boolean) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) {
        Row(modifier = Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            if (busy) CircularProgressIndicator(modifier = Modifier.size(22.dp), strokeWidth = 2.dp)
            else Box(Modifier.size(10.dp).background(Color(0xFF1A8F66), RoundedCornerShape(10.dp)))
            Spacer(Modifier.width(12.dp))
            Text(message, modifier = Modifier.weight(1f))
        }
    }
}

@Composable
private fun RouteMap() {
    val gandhipuram = LatLng(11.0168, 76.9674)
    val saravanampatti = LatLng(11.0796, 77.0029)
    val corridor = listOf(
        gandhipuram,
        LatLng(11.0208, 76.9783),
        LatLng(11.0258, 76.9900),
        LatLng(11.0435, 77.0002),
        LatLng(11.0595, 77.0016),
        saravanampatti,
    )
    val camera = rememberCameraPositionState {
        position = CameraPosition.fromLatLngZoom(LatLng(11.047, 76.986), 12.3f)
    }
    Card(modifier = Modifier.fillMaxWidth()) {
        GoogleMap(
            modifier = Modifier.fillMaxWidth().height(238.dp),
            cameraPositionState = camera,
        ) {
            Polyline(points = corridor, color = Color(0xFF1A8F66), width = 12f)
            Marker(state = MarkerState(gandhipuram), title = "Gandhipuram", snippet = "Approved start")
            Marker(state = MarkerState(saravanampatti), title = "Saravanampatti", snippet = "Approved end")
        }
    }
}

@Composable
private fun OfferCard(offer: DriverOffer, busy: Boolean, onAcceptOffer: (String) -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("${offer.pickupName} → ${offer.dropName}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(6.dp))
            Text("${offer.passengerName} · ${offer.seatQty} seat", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(14.dp))
            Button(onClick = { onAcceptOffer(offer.offerId) }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("Accept with server capacity check") }
        }
    }
}

private val LiftDark = Color(0xFF102923)
private val LiftGreen = Color(0xFF1A8F66)

@Composable
private fun LiftDriverTheme(content: @Composable () -> Unit) {
    val scheme = androidx.compose.material3.lightColorScheme(
        primary = LiftDark,
        onPrimary = Color.White,
        secondary = LiftGreen,
        background = Color(0xFFF5F7F5),
        surface = Color.White,
    )
    MaterialTheme(colorScheme = scheme, content = content)
}

@Preview(showBackground = true)
@Composable
private fun DriverPreview() = LiftDriverTheme { DriverStatusCard("No selected offers right now.", false) }
