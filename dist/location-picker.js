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
  let autocomplete;
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

    if (google.maps.places?.Autocomplete) {
      autocomplete = new google.maps.places.Autocomplete(el("locationSearchInput"), {
        componentRestrictions: { country: "in" }, fields: ["formatted_address", "geometry", "name"]
      });
      autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace();
        if (!place.geometry?.location) { setStatus("Choose an address from the suggestions."); return; }
        const point = { lat: place.geometry.location.lat(), lng: place.geometry.location.lng() };
        map.panTo(point); map.setZoom(16); updateSelection(point, place.formatted_address || place.name || "Selected address");
        setStatus("Address selected. Confirm to keep the nearest approved pilot stop.");
      });
    }
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
    if (!ensureGooglePicker()) { setStatus("Google Maps is unavailable. You can still choose an approved pilot stop from the request form."); return; }
    setTimeout(() => google.maps.event.trigger(map, "resize"), 0);
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
    window.addEventListener("lift:maps-ready", ensureGooglePicker);
  });

  window.LiftLocationPicker = Object.freeze({ open });
})();
