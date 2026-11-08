(() => {
  "use strict";
  const key = window.LIFT_CONFIG?.mapsApiKey; if (!key) return;

  const CORRIDOR_ROAD_POLYLINE = "a`gbA{rwtMBb@{AJJ|BsEZA\\nAfLj@dGO@_B_Pg@yDGKy@eI_BeNc@iDAm@]aDCmBQqXGsJi@FmB`@eATi@Fa@qBsBkIUq@Ye@Qe@MaAQwBAmA|Dq@}Dp@Eu@Mu@M]MSOg@S_Aw@uFmA}DIe@Ue@w@}@Uw@MqAfBQNMjA{ANUNIb@BdD^jBRp@@jCGxBEPyBPw@Nc@Ty@Lq@E_AO_A?i@^{B^mBN]R[HSn@}@@Em@w@k@{@}@aB{@gCi@qBsA}F_@qBa@_EUgFG_BKqBUwAS}@{@eCqAcDy@gCSgAe@kEKuAg@mDi@cDUuBW}Dk@wGGsAs@cGSsBk@uLa@}M]{ES_DcBaOY}BEi@Mi@qB_FWs@[Rv@`Cd@lAFf@AXUb@k@v@g@j@uD~EmFxHQJ]d@ODa@TY@c@KUYQYK]IaBMkDEs@W}Aq@kCU_ASmAOIESFOPGN@JN?NGL\\bB\\lAb@~APlA`@rILf@TZRDT@XIr@a@JDDECMBQpAgBdBiClCuDvAiBpA_BTa@@ME_@Wm@qC}IRIPMuAwDsAcCmFsI`@UvEnH|AnCf@hArA~DlBhFd@dA~@`DLJTDJ?nGyAdAY`Dq@|BYlEi@dI}@vASbCg@|HuAlBg@lCWnCG`AQJ?rAJlBClAOnA_@dCw@vGaArAObCk@~L}CfAc@tA_@l@KHIbBe@dCy@|@a@hJ}ErBoAzBaAxJiFqAmO}@oHmEKeDUg@]oD}A}@{@cBk@GKEoDEKQKcDm@}AUyACqAK}@Q{@e@c@KeAMkCc@yBQiDDqCGuAIgDY[@MHaC\\_@@UKc@Es@BcAbAKD{@CuB?UoAsCiPsDhAq@R}E`BaAV{A^cAJyCJi@wIi@aIGk@kBJ}Ex@Ms@K_B{@RA@TGf@MJ~ALr@|Ey@jBKFj@hAhQHnAxCKbAK|Cw@pFkBx@SlDgApAg@vAa@nAg@HAnC{@|I}B~E_AfB_@tEgAjHeBpAc@xBk@h@EjAU~LsC|Ck@NCZ`DtA|JHv@tAbJ`AlHtCjSpAdKp@fHr@rIJ|Aj@lHO@MeASoCKoBcBr@uC~AuB~@cCjAqBhAyDlBwDlBmBz@}Af@sA\\O@y@NiAZgAb@qJbCkDx@cBVaALkFv@mDhAgATm@FmBBsAKK?gAPoCFgCVmBf@_KfBaATyBXcHv@eFj@eBV{EdAuD~@eB^[JMLj@jEc@Fk@uEEi@Mi@qB_FaEcLsAcC_GkJgCaEqFeHwCqEoDcGmCwDgDgE_HyHq@s@aBwBiBmC_BuBy@C_BIwEUc@?aDGmJGm@GgBEgA@mBAM~CmCQGJMxAApDB|DGxJCdBCpIEhBmBIaIOMfEWnDy@rSELUFkDb@{CX_Fn@aGlAiDl@QH_BRYF}APf@pIFjBAjG\\?]?DdD?xC_FBB~GCXs@lAy@x@CZFxDwBKgEYwCGsAAeF?e@CuC[oCG_BAwIUqEKQAqBYgAI}B]a@QeAaAu@Wq@UiBy@i@Yc@Mk@CwBVgA@sEEqAFa@AGES[OCmCLkDDkANuBJKt@AxCRpQA|@Q~AqAlIk@zF]fDu@fEUpCOhBOr@UpBC`ADh@\\hBRrBF|A@PIzDq@E_AIuB[AL{@~C?bA@^{CeBQL_HKAx@G?";
  const DEFAULT_PASSENGER_ROAD_POLYLINE = "g|gbAqtztM}Dp@Eu@Mu@M]MSOg@S_Aw@uFmA}DIe@Ue@w@}@Uw@MqAfBQNMjA{ANUNIb@BdD^jBRp@@jCGxBEPyBPw@Nc@Ty@Lq@E_AO_A?i@^{B^mBN]R[HSn@}@@Em@w@k@{@}@aB{@gCi@qBsA}F_@qBa@_EUgFG_BKqBUwAS}@{@eCqAcDy@gCSgAe@kEKuAg@mDi@cDUuBW}Dk@wGGsAs@cGSsBk@uLa@}M]{ES_DcBaOY}BEi@Mi@qB_FWs@[Rv@`Cd@lAFf@AXUb@k@v@g@j@uD~EmFxHQJ]d@ODa@TY@c@KUYQYK]IaBMkDEs@W}Aq@kCU_ASmAOIESFOPGN@JN?NGL\\bB\\lA";

  const passengerLocations = {
    pickup: { point: { lat: 11.022917, lng: 76.982641 }, address: "Nava India" },
    drop: null
  };

  let map;
  let pickupMarker;
  let dropMarker;
  let corridorPolyline;
  let passengerPolyline;
  let driverVehicleMarker;
  let corridorCoords = [];
  let driverCoordIndex = 50;
  let driverAnimationTimer = null;
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

  const renderMarkers = () => {
    if (!map) return;
    if (passengerLocations.pickup?.point) {
      const pickup = passengerLocations.pickup;
      pickupMarker = setMarker(pickupMarker, pickup.point, "P", `Pickup: ${pickup.address}`, "#008b9a");
    }
    if (passengerLocations.drop?.point) {
      const drop = passengerLocations.drop;
      dropMarker = setMarker(dropMarker, drop.point, "D", `Drop: ${drop.address}`, "#2563eb");
    } else if (dropMarker) {
      dropMarker.setMap(null);
      dropMarker = null;
    }
  };

  // Computes the shortest driving road route using Google Routes API v2
  const fetchRoadRoute = async (pickup, drop) => {
    try {
      const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration"
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: pickup.lat, longitude: pickup.lng } } },
          destination: { location: { latLng: { latitude: drop.lat, longitude: drop.lng } } },
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_UNAWARE",
          computeAlternativeRoutes: true
        })
      });
      if (response.ok) {
        const data = await response.json();
        if (data.routes && data.routes.length > 0) {
          // Select shortest driving distance route
          let shortest = data.routes[0];
          for (const r of data.routes) {
            if ((r.distanceMeters || Infinity) < (shortest.distanceMeters || Infinity)) {
              shortest = r;
            }
          }
          const encoded = shortest.polyline?.encodedPolyline;
          if (encoded) {
            const points = decodePolyline(encoded);
            if (points.length > 1) {
              return {
                points,
                distanceMeters: shortest.distanceMeters,
                duration: shortest.duration
              };
            }
          }
        }
      }
    } catch (error) {
      console.warn("Routes API fetch error:", error);
    }
    return null;
  };

  const renderRoadFollowingRoute = async () => {
    if (!map || !passengerLocations.pickup?.point) return;
    renderMarkers();

    // If drop is not yet chosen, clear previous route and focus on pickup & approaching driver
    if (!passengerLocations.drop?.point) {
      if (passengerPolyline) {
        passengerPolyline.setMap(null);
        passengerPolyline = null;
      }
      return;
    }

    const requestVersion = ++routeRequestVersion;
    const pickup = passengerLocations.pickup.point;
    const drop = passengerLocations.drop.point;

    const routeData = await fetchRoadRoute(pickup, drop);
    if (requestVersion !== routeRequestVersion) return;

    let points = routeData?.points;

    // Fallback if dynamic fetch is blocked or offline
    if (!points || points.length < 2) {
      const isDefaultRoute =
        Math.abs(pickup.lat - 11.022917) < 0.008 &&
        Math.abs(pickup.lng - 76.982641) < 0.008 &&
        Math.abs(drop.lat - 11.030327) < 0.008 &&
        Math.abs(drop.lng - 77.020746) < 0.008;

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

    const badge = document.getElementById("mapBadge") || document.querySelector(".map-badge");
    if (badge) {
      if (routeData?.distanceMeters) {
        badge.textContent = `${(routeData.distanceMeters / 1000).toFixed(1)} km · Shortest Route`;
      } else {
        badge.textContent = "Direct Road Route";
      }
    }

    const bounds = new google.maps.LatLngBounds();
    points.forEach((point) => bounds.extend(point));
    if (driverVehicleMarker?.getPosition()) {
      bounds.extend(driverVehicleMarker.getPosition());
    }
    map.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });
  };

  // Updates driver vehicle position along the corridor and live ETA badge
  function updateDriverLocation() {
    if (!corridorCoords.length || !map) return;
    const pos = corridorCoords[driverCoordIndex % corridorCoords.length];
    if (!pos) return;

    if (!driverVehicleMarker) {
      driverVehicleMarker = new google.maps.Marker({
        map,
        position: pos,
        title: "Driver Asha - Approaching",
        icon: {
          path: "M 12 2 C 8 2 5 5 5 9 L 5 20 C 5 21 6 22 7 22 L 8 22 C 9 22 10 21 10 20 L 10 19 L 14 19 L 14 20 C 14 21 15 22 16 22 L 17 22 C 18 22 19 21 19 20 L 19 9 C 19 5 16 2 12 2 Z M 7.5 13 C 6.7 13 6 12.3 6 11.5 C 6 10.7 6.7 10 7.5 10 C 8.3 10 9 10.7 9 11.5 C 9 12.3 8.3 13 7.5 13 Z M 16.5 13 C 15.7 13 15 12.3 15 11.5 C 15 10.7 15.7 10 16.5 10 C 17.3 10 18 10.7 18 11.5 C 18 12.3 17.3 13 16.5 13 Z",
          fillColor: "#f59e0b",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
          scale: 1.35,
          anchor: new google.maps.Point(12, 12)
        },
        zIndex: 999
      });
    } else {
      driverVehicleMarker.setPosition(pos);
    }

    // Update floating driver tracking badge
    const badgeText = document.getElementById("driverMapBadgeText");
    if (badgeText) {
      if (driverCoordIndex < 110) {
        badgeText.textContent = "🚗 Driver Asha · On Avinashi Rd · Approaching pickup (~3 mins)";
      } else if (driverCoordIndex < 140) {
        badgeText.textContent = "🚗 Driver Asha · 300m away · Arriving shortly";
      } else {
        badgeText.textContent = "🚗 Driver Asha · On corridor · Moving onward";
      }
    }
  }

  function startDriverTracking() {
    if (driverAnimationTimer) clearInterval(driverAnimationTimer);
    updateDriverLocation();
    driverAnimationTimer = setInterval(() => {
      // Driver moves forward along the actual road points towards and past pickup
      driverCoordIndex = (driverCoordIndex + 1);
      if (driverCoordIndex >= corridorCoords.length) driverCoordIndex = 20;
      updateDriverLocation();
    }, 2400);
  }

  function resetDriverReplay() {
    driverCoordIndex = 10;
    updateDriverLocation();
  }

  window.addEventListener("lift:location-selected", (event) => {
    const { mode, point, address } = event.detail || {};
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return;
    passengerLocations[mode] = { point, address: address || `${mode === "pickup" ? "Pickup" : "Drop"} location` };
    renderRoadFollowingRoute();
  });

  window.addEventListener("lift:replay-driver", resetDriverReplay);

  window.initLiftGoogleMap = () => {
    const canvas = document.getElementById("googleMap");
    if (!canvas || !window.google?.maps) return;

    corridorCoords = decodePolyline(CORRIDOR_ROAD_POLYLINE);
    const centerPoint = corridorCoords[Math.floor(corridorCoords.length / 4)] || { lat: 11.025, lng: 76.995 };

    map = new google.maps.Map(canvas, {
      center: centerPoint,
      zoom: 13,
      disableDefaultUI: true,
      gestureHandling: "cooperative"
    });

    renderMarkers();
    startDriverTracking();

    canvas.parentElement.classList.add("maps-loaded");
    window.dispatchEvent(new Event("lift:maps-ready"));
  };

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&callback=initLiftGoogleMap`;
  document.head.append(script);
})();
