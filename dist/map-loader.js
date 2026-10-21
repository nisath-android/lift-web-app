(() => {
  "use strict";
  const key = window.LIFT_CONFIG?.mapsApiKey; if (!key) return;
  window.initLiftGoogleMap = () => {
    const canvas = document.getElementById("googleMap"); if (!canvas || !window.google?.maps) return;
    const route = [{ lat: 11.018304, lng: 76.967037 }, { lat: 11.022917, lng: 76.982641 }, { lat: 11.030327, lng: 77.020746 }, { lat: 11.023351, lng: 77.042661 }, { lat: 11.053912, lng: 77.019782 }, { lat: 11.078776, lng: 77.001151 }];
    const map = new google.maps.Map(canvas, { center: route[2], zoom: 13, disableDefaultUI: true, gestureHandling: "cooperative" });
    new google.maps.Polyline({ map, path: route, strokeColor: "#5fe2bb", strokeOpacity: 0.9, strokeWeight: 6 });
    new google.maps.Marker({ map, position: route[1], title: "Approved pickup corridor" }); canvas.parentElement.classList.add("maps-loaded");
  };
  const script = document.createElement("script"); script.async = true; script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=initLiftGoogleMap`; document.head.append(script);
})();
