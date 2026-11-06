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
  let autocompleteService;
  let placesService;
  let inlinePlacesService;
  let predictionIndex = new Map();
  const inlinePredictionIndex = { pickup: new Map(), drop: new Map() };
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

  function selectSuggestion(id) {
    const item = predictionIndex.get(id);
    if (!item) return;
    clearSuggestions();
    if (item.stop) {
      const point = { lat: item.stop.lat, lng: item.stop.lng };
      map?.panTo(point); map?.setZoom(16); updateSelection(point, item.stop.name); setStatus("Approved pilot stop selected.");
      return;
    }
    if (!placesService) { setStatus("Google address details are unavailable. Select an approved pilot stop or pin the map."); return; }
    setStatus("Loading address…");
    placesService.getDetails({ placeId: item.placeId, fields: ["formatted_address", "geometry", "name"] }, (place, status) => {
      if (status !== "OK" || !place?.geometry?.location) { setStatus("Address details could not be loaded. Try another suggestion."); return; }
      const point = { lat: place.geometry.location.lat(), lng: place.geometry.location.lng() };
      map.panTo(point); map.setZoom(16); updateSelection(point, place.formatted_address || place.name || item.primary); setStatus("Address selected. Confirm to continue.");
    });
  }

  function fetchSuggestions() {
    const query = el("locationSearchInput").value.trim();
    clearSuggestions();
    if (query.length < 2) return;
    if (!autocompleteService) { showPilotStopSuggestions(query); return; }
    autocompleteService.getPlacePredictions({ input: query, componentRestrictions: { country: "in" } }, (predictions, status) => {
      if (status !== "OK" || !predictions?.length) { showPilotStopSuggestions(query); return; }
      showSuggestions(predictions.slice(0, 5).map((prediction) => ({ id: `google:${prediction.place_id}`, placeId: prediction.place_id, primary: prediction.structured_formatting?.main_text || prediction.description, secondary: prediction.structured_formatting?.secondary_text || "Google address" })));
    });
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
    node.innerHTML = items.map((item) => `<button type="button" class="inline-location-suggestion" data-inline-location-suggestion="${escapeHtml(item.id)}"><span>${escapeHtml(item.primary)}</span><small>${escapeHtml(item.secondary || "Google address")}</small></button>`).join("");
    node.hidden = !items.length;
  }

  function ensureInlinePlaces() {
    if (!window.google?.maps?.places) return false;
    if (!autocompleteService && google.maps.places.AutocompleteService) autocompleteService = new google.maps.places.AutocompleteService();
    if (!inlinePlacesService && google.maps.places.PlacesService) inlinePlacesService = new google.maps.places.PlacesService(document.createElement("div"));
    return Boolean(autocompleteService && inlinePlacesService);
  }

  function pilotMatches(query) {
    const term = query.toLowerCase();
    return approvedStops.filter((stop) => stop.name.toLowerCase().includes(term)).slice(0, 5)
      .map((stop) => ({ id: `pilot:${stop.id}`, primary: stop.name, secondary: "Approved pilot stop", stop }));
  }

  function fetchInlineSuggestions(mode) {
    const input = inlineInputNode(mode);
    const query = input?.value.trim() || "";
    clearInlineSuggestions(mode);
    if (!query) return;
    if (!ensureInlinePlaces()) { showInlineSuggestions(mode, pilotMatches(query)); return; }
    autocompleteService.getPlacePredictions({ input: query, componentRestrictions: { country: "in" } }, (predictions, status) => {
      if (status !== "OK" || !predictions?.length) { showInlineSuggestions(mode, pilotMatches(query)); return; }
      showInlineSuggestions(mode, predictions.slice(0, 5).map((prediction) => ({
        id: `google:${prediction.place_id}`,
        placeId: prediction.place_id,
        primary: prediction.structured_formatting?.main_text || prediction.description,
        secondary: prediction.structured_formatting?.secondary_text || "Google address"
      })));
    });
  }

  function commitInlineLocation(mode, address, point, stop = nearestStop(point)) {
    clearInlineSuggestions(mode);
    const input = inlineInputNode(mode);
    if (input) input.value = address;
    window.dispatchEvent(new CustomEvent("lift:location-selected", { detail: { mode, stopId: stop.id, address, stopName: stop.name } }));
  }

  function selectInlineSuggestion(mode, id) {
    const item = inlinePredictionIndex[mode].get(id);
    if (!item) return;
    if (item.stop) {
      commitInlineLocation(mode, item.stop.name, { lat: item.stop.lat, lng: item.stop.lng }, item.stop);
      return;
    }
    if (!ensureInlinePlaces()) return;
    inlinePlacesService.getDetails({ placeId: item.placeId, fields: ["formatted_address", "geometry", "name"] }, (place, status) => {
      if (status !== "OK" || !place?.geometry?.location) return;
      const point = { lat: place.geometry.location.lat(), lng: place.geometry.location.lng() };
      commitInlineLocation(mode, place.formatted_address || place.name || item.primary, point);
    });
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
    if (google.maps.places?.AutocompleteService && google.maps.places?.PlacesService) {
      autocompleteService = new google.maps.places.AutocompleteService();
      placesService = new google.maps.places.PlacesService(map);
    }
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
    window.addEventListener("lift:maps-ready", () => { ensureGooglePicker(); ensureInlinePlaces(); });
  });

  window.LiftLocationPicker = Object.freeze({ open });
})();
