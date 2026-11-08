(() => {
  "use strict";
  const key = window.LIFT_CONFIG?.mapsApiKey; if (!key) return;

  const CORRIDOR_ROAD_POLYLINE = "a`gbA{rwtMBb@{AJJ|BsEZA\\nAfLj@dGO@_B_Pg@yDGKy@eI_BeNc@iDAm@]aDCmBQqXGsJi@FmB`@eATi@Fa@qBsBkIUq@Ye@Qe@MaAQwBAmA|Dq@}Dp@Eu@Mu@M]MSOg@S_Aw@uFmA}DIe@Ue@w@}@Uw@MqAfBQNMjA{ANUNIb@BdD^jBRp@@jCGxBEPyBPw@Nc@Ty@Lq@E_AO_A?i@^{B^mBN]R[HSn@}@@Em@w@k@{@}@aB{@gCi@qBsA}F_@qBa@_EUgFG_BKqBUwAS}@{@eCqAcDy@gCSgAe@kEKuAg@mDi@cDUuBW}Dk@wGGsAs@cGSsBk@uLa@}M]{ES_DcBaOY}BEi@Mi@qB_FWs@[Rv@`Cd@lAFf@AXUb@k@v@g@j@uD~EmFxHQJ]d@ODa@TY@c@KUYQYK]IaBMkDEs@W}Aq@kCU_ASmAOIESFOPGN@JN?NGL\\bB\\lAb@~APlA`@rILf@TZRDT@XIr@a@JDDECMBQpAgBdBiClCuDvAiBpA_BTa@@ME_@Wm@qC}IRIPMuAwDsAcCmFsI`@UvEnH|AnCf@hArA~DlBhFd@dA~@`DLJTDJ?nGyAdAY`Dq@|BYlEi@dI}@vASbCg@|HuAlBg@lCWnCG`AQJ?rAJlBClAOnA_@dCw@vGaArAObCk@~L}CfAc@tA_@l@KHIbBe@dCy@|@a@hJ}ErBoAzBaAxJiFqAmO}@oHmEKeDUg@]oD}A}@{@cBk@GKEoDEKQKcDm@}AUyACqAK}@Q{@e@c@KeAMkCc@yBQiDDqCGuAIgDY[@MHaC\\_@@UKc@Es@BcAbAKD{@CuB?UoAsCiPsDhAq@R}E`BaAV{A^cAJyCJi@wIi@aIGk@kBJ}Ex@Ms@K_B{@RA@TGf@MJ~ALr@|Ey@jBKFj@hAhQHnAxCKbAK|Cw@pFkBx@SlDgApAg@vAa@nAg@HAnC{@|I}B~E_AfB_@tEgAjHeBpAc@xBk@h@EjAU~LsC|Ck@NCZ`DtA|JHv@tAbJ`AlHtCjSpAdKp@fHr@rIJ|Aj@lHO@MeASoCKoBcBr@uC~AuB~@cCjAqBhAyDlBwDlBmBz@}Af@sA\\O@y@NiAZgAb@qJbCkDx@cBVaALkFv@mDhAgATm@FmBBsAKK?gAPoCFgCVmBf@_KfBaATyBXcHv@eFj@eBV{EdAuD~@eB^[JMLj@jEc@Fk@uEEi@Mi@qB_FaEcLsAcC_GkJgCaEqFeHwCqEoDcGmCwDgDgE_HyHq@s@aBwBiBmC_BuBy@C_BIwEUc@?aDGmJGm@GgBEgA@mBAM~CmCQGJMxAApDB|DGxJCdBCpIEhBmBIaIOMfEWnDy@rSELUFkDb@{CX_Fn@aGlAiDl@QH_BRYF}APf@pIFjBAjG\\?]?DdD?xC_FBB~GCXs@lAy@x@CZFxDwBKgEYwCGsAAeF?e@CuC[oCG_BAwIUqEKQAqBYgAI}B]a@QeAaAu@Wq@UiBy@i@Yc@Mk@CwBVgA@sEEqAFa@AGES[OCmCLkDDkANuBJKt@AxCRpQA|@Q~AqAlIk@zF]fDu@fEUpCOhBOr@UpBC`ADh@\\hBRrBF|A@PIzDq@E_AIuB[AL{@~C?bA@^{CeBQL_HKAx@G?";
  const DEFAULT_PASSENGER_ROAD_POLYLINE = "g|gbAqtztM}Dp@Eu@Mu@M]MSOg@S_Aw@uFmA}DIe@Ue@w@}@Uw@MqAfBQNMjA{ANUNIb@BdD^jBRp@@jCGxBEPyBPw@Nc@Ty@Lq@E_AO_A?i@^{B^mBN]R[HSn@}@@Em@w@k@{@}@aB{@gCi@qBsA}F_@qBa@_EUgFG_BKqBUwAS}@{@eCqAcDy@gCSgAe@kEKuAg@mDi@cDUuBW}Dk@wGGsAs@cGSsBk@uLa@}M]{ES_DcBaOY}BEi@Mi@qB_FWs@[Rv@`Cd@lAFf@AXUb@k@v@g@j@uD~EmFxHQJ]d@ODa@TY@c@KUYQYK]IaBMkDEs@W}Aq@kCU_ASmAOIESFOPGN@JN?NGL\\bB\\lA";

  const passengerLocations = {
    pickup: { point: { lat: 11.022917, lng: 76.982641 }, address: "Nava India" },
    drop: { point: { lat: 11.030327, lng: 77.020746 }, address: "Peelamedu" }
  };

  let map;
  let pickupMarker;
  let dropMarker;
  let corridorPolyline;
  let passengerPolyline;
  let routeRequestVersion = 0;

  function decodePolyline(encoded) {
    if (!encoded) return [];
    const points = [];
    let index = 0;
    const len = encoded.length;
    let lat = 0;
    let lng = 0;
    while (index < len) {
      let b;
      let shift = 0;
      let result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
      lat += dlat;

      shift = 0;
      result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
      lng += dlng;

      points.push({ lat: lat / 1e5, lng: lng / 1e5 });
    }
    return points;
  }

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

  const renderPassengerMarkers = () => {
    if (!map || !passengerLocations.pickup?.point || !passengerLocations.drop?.point) return;
    const pickup = passengerLocations.pickup;
    const drop = passengerLocations.drop;
    pickupMarker = setMarker(pickupMarker, pickup.point, "P", `Pickup: ${pickup.address}`, "#008b9a");
    dropMarker = setMarker(dropMarker, drop.point, "D", `Drop: ${drop.address}`, "#2563eb");
  };

  const fetchRoadRoute = async (pickup, drop) => {
    try {
      const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "routes.polyline.encodedPolyline"
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: pickup.lat, longitude: pickup.lng } } },
          destination: { location: { latLng: { latitude: drop.lat, longitude: drop.lng } } },
          travelMode: "DRIVE"
        })
      });
      if (response.ok) {
        const data = await response.json();
        const encoded = data.routes?.[0]?.polyline?.encodedPolyline;
        if (encoded) {
          const points = decodePolyline(encoded);
          if (points.length > 1) return points;
        }
      }
    } catch (error) {
      console.warn("Routes API fetch error:", error);
    }
    return null;
  };

  const renderRoadFollowingRoute = async () => {
    if (!map || !passengerLocations.pickup?.point || !passengerLocations.drop?.point) return;
    renderPassengerMarkers();
    const requestVersion = ++routeRequestVersion;
    const pickup = passengerLocations.pickup.point;
    const drop = passengerLocations.drop.point;

    let points = await fetchRoadRoute(pickup, drop);
    if (requestVersion !== routeRequestVersion) return;

    // If dynamic fetch failed, check if default coordinates match Nava India -> Peelamedu
    if (!points || points.length < 2) {
      const isDefaultRoute =
        Math.abs(pickup.lat - 11.022917) < 0.005 &&
        Math.abs(pickup.lng - 76.982641) < 0.005 &&
        Math.abs(drop.lat - 11.030327) < 0.005 &&
        Math.abs(drop.lng - 77.020746) < 0.005;

      if (isDefaultRoute) {
        points = decodePolyline(DEFAULT_PASSENGER_ROAD_POLYLINE);
      }
    }

    if (!points || points.length < 2) {
      console.warn("Could not determine road polyline for selected points");
      return;
    }

    if (passengerPolyline) passengerPolyline.setMap(null);
    passengerPolyline = new google.maps.Polyline({
      map,
      path: points,
      strokeColor: "#2563eb",
      strokeOpacity: 0.95,
      strokeWeight: 6
    });

    const bounds = new google.maps.LatLngBounds();
    points.forEach((point) => bounds.extend(point));
    map.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });
  };

  window.addEventListener("lift:location-selected", (event) => {
    const { mode, point, address } = event.detail || {};
    if (!passengerLocations[mode] || !point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return;
    passengerLocations[mode] = { point, address: address || `${mode === "pickup" ? "Pickup" : "Drop"} location` };
    renderRoadFollowingRoute();
  });

  window.initLiftGoogleMap = () => {
    const canvas = document.getElementById("googleMap");
    if (!canvas || !window.google?.maps) return;

    const corridorPath = decodePolyline(CORRIDOR_ROAD_POLYLINE);
    const centerPoint = corridorPath[Math.floor(corridorPath.length / 3)] || { lat: 11.025, lng: 76.995 };

    map = new google.maps.Map(canvas, {
      center: centerPoint,
      zoom: 13,
      disableDefaultUI: true,
      gestureHandling: "cooperative"
    });

    // Render driver route corridor along the exact road network (green)
    corridorPolyline = new google.maps.Polyline({
      map,
      path: corridorPath,
      strokeColor: "#10b981",
      strokeOpacity: 0.85,
      strokeWeight: 6
    });

    new google.maps.Marker({
      map,
      position: { lat: 11.022917, lng: 76.982641 },
      title: "Approved pickup corridor - Nava India"
    });

    // Immediately render the passenger street-level road route (Nava India -> Peelamedu)
    renderRoadFollowingRoute();

    canvas.parentElement.classList.add("maps-loaded");
    window.dispatchEvent(new Event("lift:maps-ready"));
  };

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&callback=initLiftGoogleMap`;
  document.head.append(script);
})();
