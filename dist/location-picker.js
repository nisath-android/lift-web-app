(() => {
  "use strict";

  const approvedStops = [
    { id: "gandhipuram", name: "Gandhipuram Bus Stand", lat: 11.018304, lng: 76.967037 },
    { id: "nava-india", name: "Nava India", lat: 11.022917, lng: 76.982641 },
    { id: "peelamedu", name: "Peelamedu", lat: 11.030327, lng: 77.020746 },
    { id: "hope-college", name: "Hope College", lat: 11.023351, lng: 77.042661 },
    { id: "vilankurichi", name: "Vilankurichi", lat: 11.053912, lng: 77.019782 },
    { id: "saravanampatti", name: "Saravanampatti", lat: 11.078776, lng: 77.001151 }
  ];

  let mode = "pickup";
  let map;
  let marker;
  let geocoder;
  let placesLibrary;
  let placesBlocked = false;
  let predictionIndex = new Map();
  const inlinePredictionIndex = { pickup: new Map(), drop: new Map() };
  const autocompleteTokens = { dialog: null, pickup: null, drop: null };
  let suggestionTimer;
  let selected;

  const el = (id) => document.getElementById(id);
  const dialog = () => el("locationDialog");
  const distanceKm = (a, b) => {
    const radians = (value) => value * Math.PI / 180;
    const dLat = radians(b.lat - a.lat); const dLng = radians(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 6371 * (2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)));
  };
  const nearestStop = (point) => approvedStops.reduce((nearest, stop) => distanceKm(point, stop) < distanceKm(point, nearest) ? stop : nearest, approvedStops[0]);
  const setStatus = (message) => { el("locationStatus").textContent = message; };
  const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

  function clearSuggestions() {
    el("locationSuggestions").hidden = true;
    el("locationSuggestions").innerHTML = "";
    predictionIndex = new Map();
  }

  function showSuggestions(items, source = "google") {
    const node = el("locationSuggestions");
    predictionIndex = new Map(items.map((item) => [item.id, item]));
    node.innerHTML = items.length ? items.map((item) => `<button type="button" class="location-suggestion" data-location-suggestion="${escapeHtml(item.id)}" role="option"><span>${escapeHtml(item.primary)}</span><small>${escapeHtml(item.secondary || (source === "google" ? "Google address" : "Approved pilot stop"))}</small></button>`).join("") : "";
    node.hidden = !items.length;
  }

  function showPilotStopSuggestions(query) {
    const term = query.toLowerCase();
    const matches = approvedStops.filter((stop) => stop.name.toLowerCase().includes(term)).slice(0, 5)
      .map((stop) => ({ id: `pilot:${stop.id}`, primary: stop.name, secondary: "Approved pilot stop", stop }));
    showSuggestions(matches, "pilot");
  }

  async function loadPrediction(item, scope) {
    const place = item.placePrediction.toPlace();
    await place.fetchFields({ fields: ["displayName", "formattedAddress", "location"] });
    autocompleteTokens[scope] = null;
    if (!place.location) throw new Error("PLACE_LOCATION_UNAVAILABLE");
    return {
      point: { lat: place.location.lat(), lng: place.location.lng() },
      address: place.formattedAddress || place.displayName || item.primary
    };
  }

  async function selectSuggestion(id) {
    const item = predictionIndex.get(id);
    if (!item) return;
    clearSuggestions();
    if (item.stop) {
      const point = { lat: item.stop.lat, lng: item.stop.lng };
      map?.panTo(point); map?.setZoom(16); updateSelection(point, item.stop.name); setStatus("Approved pilot stop selected.");
      return;
    }
    setStatus("Loading address…");
    try {
      const result = await loadPrediction(item, "dialog");
      map.panTo(result.point); map.setZoom(16); updateSelection(result.point, result.address); setStatus("Address selected. Confirm to continue.");
    } catch { setStatus("Address details could not be loaded. Try another suggestion."); }
  }

  async function getGoogleSuggestions(query, scope) {
    if (!window.google?.maps?.importLibrary) return null;
    try {
      if (!placesLibrary) placesLibrary = await google.maps.importLibrary("places");
      const { AutocompleteSuggestion, AutocompleteSessionToken } = placesLibrary;
      if (!AutocompleteSuggestion || !AutocompleteSessionToken) return null;
      if (!autocompleteTokens[scope]) autocompleteTokens[scope] = new AutocompleteSessionToken();
      const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: query,
        includedRegionCodes: ["IN"],
        sessionToken: autocompleteTokens[scope]
      });
      placesBlocked = false;
      return (suggestions || []).slice(0, 6).flatMap((suggestion, index) => {
        const prediction = suggestion.placePrediction;
        if (!prediction) return [];
        return [{
          id: `google:${scope}:${Date.now()}:${index}`,
          placePrediction: prediction,
          primary: prediction.text?.text || "Google address",
          secondary: "Google address"
        }];
      });
    } catch (error) {
      placesBlocked = true;
      console.warn("Places API (New) autocomplete is unavailable", error);
      return null;
    }
  }

  async function fetchSuggestions() {
    const query = el("locationSearchInput").value.trim();
    clearSuggestions();
    if (!query) return;
    const items = await getGoogleSuggestions(query, "dialog");
    if (el("locationSearchInput").value.trim() !== query) return;
    if (!items?.length) { showPilotStopSuggestions(query); return; }
    showSuggestions(items);
  }

  function inlineSuggestionNode(mode) { return el(`${mode}InlineSuggestions`); }
  function inlineInputNode(mode) { return el(`${mode}LocationText`); }

  function clearInlineSuggestions(mode) {
    const node = inlineSuggestionNode(mode);
    if (!node) return;
    node.hidden = true;
    node.innerHTML = "";
    inlinePredictionIndex[mode] = new Map();
  }

  function showInlineSuggestions(mode, items) {
    const node = inlineSuggestionNode(mode);
    if (!node) return;
    inlinePredictionIndex[mode] = new Map(items.map((item) => [item.id, item]));
    node.innerHTML = items.map((item) => item.notice
      ? `<div class="inline-location-notice" role="status"><strong>${escapeHtml(item.primary)}</strong><small>${escapeHtml(item.secondary)}</small></div>`
      : `<button type="button" class="inline-location-suggestion" data-inline-location-suggestion="${escapeHtml(item.id)}" role="option"><span class="inline-suggestion-icon" aria-hidden="true">⌖</span><span class="inline-suggestion-copy"><strong>${escapeHtml(item.primary)}</strong><small>${escapeHtml(item.secondary || "Google address")}</small></span></button>`).join("");
    node.hidden = !items.length;
  }

  function pilotMatches(query) {
    const term = query.toLowerCase();
    return approvedStops.filter((stop) => stop.name.toLowerCase().includes(term)).slice(0, 5)
      .map((stop) => ({ id: `pilot:${stop.id}`, primary: stop.name, secondary: "Approved pilot stop", stop }));
  }

  async function fetchInlineSuggestions(mode) {
    const input = inlineInputNode(mode);
    const query = input?.value.trim() || "";
    clearInlineSuggestions(mode);
    if (!query) return;
    const items = await getGoogleSuggestions(query, mode);
    if (inlineInputNode(mode)?.value.trim() !== query) return;
    const fallback = pilotMatches(query);
    showInlineSuggestions(mode, items?.length ? items : (fallback.length ? fallback : (placesBlocked ? [{
      id: "places-unavailable",
      notice: true,
      primary: "Address search is temporarily unavailable",
      secondary: "Use the map-pin button to choose this location."
    }] : [])));
  }

  function commitInlineLocation(mode, address, point, stop = nearestStop(point)) {
    clearInlineSuggestions(mode);
    const input = inlineInputNode(mode);
    if (input) input.value = address;
    window.dispatchEvent(new CustomEvent("lift:location-selected", { detail: { mode, stopId: stop.id, address, stopName: stop.name } }));
  }

  async function selectInlineSuggestion(mode, id) {
    const item = inlinePredictionIndex[mode].get(id);
    if (!item) return;
    if (item.stop) {
      commitInlineLocation(mode, item.stop.name, { lat: item.stop.lat, lng: item.stop.lng }, item.stop);
      return;
    }
    try {
      const result = await loadPrediction(item, mode);
      commitInlineLocation(mode, result.address, result.point);
    } catch { clearInlineSuggestions(mode); }
  }

  function updateSelection(point, address) {
    const stop = nearestStop(point);
    selected = { point, address: address || "Pinned location", stop };
    if (marker) { marker.setPosition(point); marker.setVisible(true); }
    const distance = distanceKm(point, stop);
    el("locationSelectedAddress").textContent = selected.address;
    el("locationApprovedStop").textContent = `Matching will use approved pilot stop: ${stop.name} · ${distance.toFixed(1)} km away`;
    el("locationConfirmButton").disabled = false;
  }

  function reverseGeocode(point) {
    if (!geocoder) { updateSelection(point, "Pinned location"); return; }
    setStatus("Finding the address…");
    geocoder.geocode({ location: point }, (results, status) => {
      const address = status === "OK" && results?.[0]?.formatted_address ? results[0].formatted_address : "Pinned location";
      updateSelection(point, address);
      setStatus("Pin moved. Confirm to use the closest approved pilot stop.");
    });
  }

  function ensureGooglePicker() {
    if (!window.google?.maps || map) return Boolean(map);
    const coimbatore = { lat: 11.036, lng: 77.01 };
    map = new google.maps.Map(el("locationPickerMap"), { center: coimbatore, zoom: 12, disableDefaultUI: true, zoomControl: true, clickableIcons: false });
    marker = new google.maps.Marker({ map, visible: false, draggable: true, title: "Selected location" });
    geocoder = new google.maps.Geocoder();
    map.addListener("click", (event) => reverseGeocode({ lat: event.latLng.lat(), lng: event.latLng.lng() }));
    marker.addListener("dragend", (event) => reverseGeocode({ lat: event.latLng.lat(), lng: event.latLng.lng() }));

    return true;
  }

  function runTextSearch() {
    const query = el("locationSearchInput").value.trim();
    if (!query || !geocoder) return;
    setStatus("Searching address…");
    geocoder.geocode({ address: `${query}, Coimbatore, Tamil Nadu` }, (results, status) => {
      if (status !== "OK" || !results?.[0]) { setStatus("Address not found. Try a clearer landmark or pin the map."); return; }
      const point = { lat: results[0].geometry.location.lat(), lng: results[0].geometry.location.lng() };
      map.panTo(point); map.setZoom(16); updateSelection(point, results[0].formatted_address); setStatus("Address selected. Confirm to continue.");
    });
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) { setStatus("Current location is not available in this browser. Pin the map instead."); return; }
    setStatus("Getting your current location…");
    navigator.geolocation.getCurrentPosition(
      (position) => { const point = { lat: position.coords.latitude, lng: position.coords.longitude }; map.panTo(point); map.setZoom(16); reverseGeocode(point); },
      () => setStatus("Location permission was not granted. You can search or pin the map."),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  function open(nextMode) {
    mode = nextMode;
    selected = null;
    el("locationDialogEyebrow").textContent = `${mode === "pickup" ? "Pickup" : "Drop"} point`;
    el("locationDialogTitle").textContent = `Choose ${mode === "pickup" ? "pickup" : "drop"} location`;
    el("locationSearchInput").value = "";
    el("locationSelectedAddress").textContent = "Choose a point to continue";
    el("locationApprovedStop").textContent = "Only approved pilot stops can be sent to a driver.";
    el("locationConfirmButton").disabled = true;
    setStatus("Type an address, use current location, or tap the map.");
    dialog().showModal();
    if (!ensureGooglePicker()) { setStatus("Google Maps is unavailable. Matching pilot-stop suggestions are still available."); setTimeout(() => el("locationSearchInput").focus(), 0); return; }
    setTimeout(() => google.maps.event.trigger(map, "resize"), 0);
    setTimeout(() => el("locationSearchInput").focus(), 0);
  }

  function confirm() {
    if (!selected) return;
    window.dispatchEvent(new CustomEvent("lift:location-selected", { detail: { mode, stopId: selected.stop.id, address: selected.address, stopName: selected.stop.name } }));
    dialog().close();
  }

  document.addEventListener("DOMContentLoaded", () => {
    el("locationDialogClose").addEventListener("click", () => dialog().close());
    el("locationCancelButton").addEventListener("click", () => dialog().close());
    el("locationConfirmButton").addEventListener("click", confirm);
    el("locationCurrentButton").addEventListener("click", useCurrentLocation);
    el("locationSearchInput").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); runTextSearch(); } });
    el("locationSearchInput").addEventListener("input", () => { clearTimeout(suggestionTimer); suggestionTimer = setTimeout(fetchSuggestions, 180); });
    el("locationSuggestions").addEventListener("click", (event) => { const button = event.target.closest("[data-location-suggestion]"); if (button) selectSuggestion(button.dataset.locationSuggestion); });
    ["pickup", "drop"].forEach((inlineMode) => {
      const input = inlineInputNode(inlineMode);
      const suggestions = inlineSuggestionNode(inlineMode);
      input?.addEventListener("input", () => { clearTimeout(suggestionTimer); suggestionTimer = setTimeout(() => fetchInlineSuggestions(inlineMode), 180); });
      input?.addEventListener("keydown", (event) => { if (event.key === "Escape") clearInlineSuggestions(inlineMode); });
      suggestions?.addEventListener("click", (event) => { const button = event.target.closest("[data-inline-location-suggestion]"); if (button) selectInlineSuggestion(inlineMode, button.dataset.inlineLocationSuggestion); });
    });
    window.addEventListener("lift:maps-ready", () => {
      ensureGooglePicker();
      if (window.google?.maps?.importLibrary) google.maps.importLibrary("places").then((library) => { placesLibrary = library; }).catch(() => {});
    });
  });

  window.LiftLocationPicker = Object.freeze({ open });
})();
