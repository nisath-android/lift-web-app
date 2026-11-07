(() => {
  "use strict";
  const key = window.LIFT_CONFIG?.mapsApiKey; if (!key) return;
  const passengerLocations = {
    pickup: { point: { lat: 11.022917, lng: 76.982641 }, address: "Nava India" },
    drop: { point: { lat: 11.030327, lng: 77.020746 }, address: "Peelamedu" }
  };
  let map;
  let pickupMarker;
  let dropMarker;
  let passengerLine;

  const setMarker = (marker, position, label, title, color) => {
    if (marker) marker.setMap(null);
    return new google.maps.Marker({
      map,
      position,
      label: { text: label, color: "#ffffff", fontWeight: "700" },
      title,
      icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: color, fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 2, scale: 11 }
    });
  };

  const renderPassengerRoute = () => {
    if (!map || !passengerLocations.pickup?.point || !passengerLocations.drop?.point) return;
    const pickup = passengerLocations.pickup;
    const drop = passengerLocations.drop;
    pickupMarker = setMarker(pickupMarker, pickup.point, "P", `Pickup: ${pickup.address}`, "#008b9a");
    dropMarker = setMarker(dropMarker, drop.point, "D", `Drop: ${drop.address}`, "#2563eb");
    if (passengerLine) passengerLine.setMap(null);
    passengerLine = new google.maps.Polyline({
      map,
      path: [pickup.point, drop.point],
      strokeColor: "#2563eb",
      strokeOpacity: 0.9,
      strokeWeight: 5,
      icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, strokeColor: "#dbeafe", scale: 3 }, offset: "0", repeat: "14px" }]
    });
    const bounds = new google.maps.LatLngBounds();
    bounds.extend(pickup.point); bounds.extend(drop.point);
    if (pickup.point.lat === drop.point.lat && pickup.point.lng === drop.point.lng) map.setCenter(pickup.point);
    else map.fitBounds(bounds, { top: 48, right: 48, bottom: 48, left: 48 });
  };

  window.addEventListener("lift:location-selected", (event) => {
    const { mode, point, address } = event.detail || {};
    if (!passengerLocations[mode] || !point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return;
    passengerLocations[mode] = { point, address: address || `${mode === "pickup" ? "Pickup" : "Drop"} location` };
    renderPassengerRoute();
  });

  window.initLiftGoogleMap = () => {
    const canvas = document.getElementById("googleMap"); if (!canvas || !window.google?.maps) return;
    const route = [{ lat: 11.018304, lng: 76.967037 }, { lat: 11.022917, lng: 76.982641 }, { lat: 11.030327, lng: 77.020746 }, { lat: 11.023351, lng: 77.042661 }, { lat: 11.053912, lng: 77.019782 }, { lat: 11.078776, lng: 77.001151 }];
    map = new google.maps.Map(canvas, { center: route[2], zoom: 13, disableDefaultUI: true, gestureHandling: "cooperative" });
    new google.maps.Polyline({ map, path: route, strokeColor: "#5fe2bb", strokeOpacity: 0.9, strokeWeight: 6 });
    new google.maps.Marker({ map, position: route[1], title: "Approved pickup corridor" });
    renderPassengerRoute();
    canvas.parentElement.classList.add("maps-loaded");
    window.dispatchEvent(new Event("lift:maps-ready"));
  };
  const script = document.createElement("script"); script.async = true; script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&callback=initLiftGoogleMap`; document.head.append(script);
})();
