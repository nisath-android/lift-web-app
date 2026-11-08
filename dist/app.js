(() => {
  "use strict";

  const stops = [
    { id: "gandhipuram", name: "Gandhipuram Bus Stand", short: "Gandhipuram", walk: 3, pickupApproved: true, dropApproved: true, roadSide: "east" },
    { id: "nava-india", name: "Nava India", short: "Nava India", walk: 2, pickupApproved: true, dropApproved: true, roadSide: "east" },
    { id: "peelamedu", name: "Peelamedu", short: "Peelamedu", walk: 3, pickupApproved: true, dropApproved: true, roadSide: "east" },
    { id: "hope-college", name: "Hope College", short: "Hope College", walk: 4, pickupApproved: true, dropApproved: true, roadSide: "west" },
    { id: "vilankurichi", name: "Vilankurichi", short: "Vilankurichi", walk: 3, pickupApproved: true, dropApproved: true, roadSide: "west" },
    { id: "saravanampatti", name: "Saravanampatti", short: "Saravanampatti", walk: 5, pickupApproved: true, dropApproved: true, roadSide: "west" }
  ];

  const markerPoints = [
    { left: 8, top: 75 }, { left: 28, top: 61 }, { left: 48, top: 48 },
    { left: 63, top: 42 }, { left: 79, top: 36 }, { left: 91, top: 20 }
  ];

  function routeMarkerPoints(driver) {
    return driver.route.map((stopId) => markerPoints[stops.findIndex((stop) => stop.id === stopId)]).filter(Boolean);
  }

  const initialDrivers = [
    {
      id: "asha", name: "Asha K.", initial: "A", color: "linear-gradient(135deg, #e5a174, #8b4c8a)",
      route: stops.map((stop) => stop.id), current: 0.15, currentLabel: "between Gandhipuram & Nava India", capacity: 1, reserved: 0,
      departure: "8:30 AM", pickupAtMinutes: 522, wait: 12, pickupKm: 0.6, reliability: 4.9, scoreBase: 94,
      description: "Already travelling via Nava India and Peelamedu", state: "PUBLISHED"
    },
    {
      id: "ram", name: "Ram V.", initial: "R", color: "linear-gradient(135deg, #4d8fe8, #3a497f)",
      route: stops.map((stop) => stop.id), current: 0.08, currentLabel: "leaving Gandhipuram", capacity: 2, reserved: 0,
      departure: "8:38 AM", pickupAtMinutes: 536, wait: 18, pickupKm: 0.3, reliability: 4.7, scoreBase: 81,
      description: "Planned corridor with a later departure", state: "PUBLISHED"
    },
    {
      id: "reverse", name: "Kiran S.", initial: "K", color: "linear-gradient(135deg, #b177e4, #5b3d8d)",
      route: [...stops].reverse().map((stop) => stop.id), current: 0.25, currentLabel: "between Vilankurichi & Hope College", capacity: 1, reserved: 0,
      departure: "8:25 AM", pickupAtMinutes: 533, wait: 8, pickupKm: 0.4, reliability: 4.8, scoreBase: 0,
      description: "Reverse direction test route", state: "PUBLISHED"
    },
    {
      id: "full", name: "Meera N.", initial: "M", color: "linear-gradient(135deg, #6bd3c1, #317b93)",
      route: stops.map((stop) => stop.id), current: 0.05, currentLabel: "leaving Gandhipuram", capacity: 1, reserved: 1,
      departure: "8:35 AM", pickupAtMinutes: 530, wait: 15, pickupKm: 0.5, reliability: 4.8, scoreBase: 0,
      description: "Correct direction but no remaining seats", state: "PUBLISHED"
    }
  ];

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const defaultRequest = { pickup: "nava-india", drop: "peelamedu", seats: 1, departure: "Now" };
  let state;
  const live = () => window.LiftLive;

  const el = (id) => document.getElementById(id);
  const bySelector = (selector) => document.querySelector(selector);
  const stopById = (id) => stops.find((stop) => stop.id === id);
  const driverById = (id) => state.drivers.find((driver) => driver.id === id);

  function initialiseState() {
    state = {
      request: { ...defaultRequest },
      drivers: clone(initialDrivers),
      selectedDriverId: "asha",
      booking: null,
      audit: [
        auditEntry("MATCHER_EVALUATED", "RQ-2048 evaluated against 4 planned routes", "system"),
        auditEntry("SAFETY_GATE_PASSED", "Nava India pickup approved on route side", "safety"),
        auditEntry("ROUTE_PUBLISHED", "Asha K. route is available with 1 open seat", "driver")
      ],
      offerSeconds: 80,
      offerExpired: false,
      lastUpdateSeconds: 8,
      declined: false,
      liveRequestId: null,
      liveOffers: null,
      liveSelectedOffer: null,
      locationLabels: {
        pickup: { address: "Nava India", stopName: "Nava India" },
        drop: { address: "Peelamedu", stopName: "Peelamedu" }
      }
    };
  }

  function auditEntry(type, detail, actor) {
    const time = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date());
    return { type, detail, actor, time };
  }

  function addAudit(type, detail, actor = "system") {
    state.audit.unshift(auditEntry(type, detail, actor));
    state.audit = state.audit.slice(0, 10);
  }

  function requestedStopIndex(driver, stopId) {
    return driver.route.indexOf(stopId);
  }

  function departureMinutes(value) {
    const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(value);
    if (!match) return 0;
    let hour = Number(match[1]) % 12;
    if (match[3].toUpperCase() === "PM") hour += 12;
    return hour * 60 + Number(match[2]);
  }

  function formatMinutes(value) {
    const hour24 = Math.floor(value / 60) % 24;
    const minutes = String(value % 60).padStart(2, "0");
    const suffix = hour24 >= 12 ? "PM" : "AM";
    const hour12 = hour24 % 12 || 12;
    return `${hour12}:${minutes} ${suffix}`;
  }

  function hasApprovedStops(pickup, drop) {
    return Boolean(pickup?.pickupApproved && drop?.dropApproved);
  }

  function pickupEtaMinutes(driver, pickupId) {
    const targetIndex = requestedStopIndex(driver, pickupId);
    const baselineIndex = requestedStopIndex(driver, "nava-india");
    if (targetIndex < 0 || baselineIndex < 0) return driver.pickupAtMinutes;
    return driver.pickupAtMinutes + (targetIndex - baselineIndex) * 5;
  }

  function evaluateDriver(driver) {
    const { pickup, drop, seats, departure } = state.request;
    const requestedAt = departureMinutes(departure);
    const latestPickupAt = requestedAt + 30;
    const pickupIndex = requestedStopIndex(driver, pickup);
    const dropIndex = requestedStopIndex(driver, drop);
    const pickupStop = stopById(pickup);
    const dropStop = stopById(drop);
    const pickupAtMinutes = pickupEtaMinutes(driver, pickup);
    const reasons = [];
    let decision = "eligible";

    if (!drop || dropIndex < 0) {
      return {
        driver,
        pickupIndex,
        dropIndex: -1,
        pickupAtMinutes,
        score: 0,
        reasons: ["Choose your destination above to evaluate route compatibility"],
        decision: "choose-drop",
        requestedAt,
        latestPickupAt
      };
    }

    if (driver.state !== "PUBLISHED") {
      decision = "unavailable";
      reasons.push("Route is not published");
    }
    if (pickupIndex < 0) {
      decision = "outside-route";
      reasons.push("Requested stops are not on this route");
    } else if (dropIndex <= pickupIndex) {
      decision = "wrong-direction";
      reasons.push("Drop would happen before pickup on this route");
    } else if (pickupIndex / (driver.route.length - 1) <= driver.current) {
      decision = "behind-driver";
      reasons.push("Pickup is already behind the driver");
    }
    if (!hasApprovedStops(pickupStop, dropStop)) {
      if (decision === "eligible") decision = "unsafe-stop";
      reasons.push("Pickup or drop is not an approved roadside stop");
    }
    if (pickupAtMinutes < requestedAt || pickupAtMinutes > latestPickupAt) {
      if (decision === "eligible") decision = "time-window";
      reasons.push(`Pickup at ${formatMinutes(pickupAtMinutes)} misses the requested 30-minute window`);
    }
    if (driver.capacity - driver.reserved < seats) {
      if (decision === "eligible") decision = "capacity";
      reasons.push("Not enough remaining seat capacity");
    }
    if (decision === "eligible") {
      reasons.push("Pickup and drop are forward on the route");
      reasons.push(`Approved roadside stops are available on the ${pickupStop.roadSide} side`);
      reasons.push(`${driver.capacity - driver.reserved} seat ${driver.capacity - driver.reserved === 1 ? "is" : "are"} available`);
      reasons.push(`${formatMinutes(pickupAtMinutes)} pickup ETA fits your time window`);
    }
    const score = decision === "eligible"
      ? Math.max(63, driver.scoreBase - Math.floor(Math.abs(pickupAtMinutes - requestedAt) / 6) - Math.max(0, seats - 1) * 13)
      : 0;
    return { driver, pickupIndex, dropIndex, pickupAtMinutes, score, reasons, decision, requestedAt, latestPickupAt };
  }

  function evaluations() {
    return state.drivers.map(evaluateDriver);
  }

  function eligibleMatches() {
    return evaluations().filter((result) => result.decision === "eligible").sort((a, b) => b.score - a.score);
  }

  function selectedEvaluation() {
    const selected = evaluations().find((evaluation) => evaluation.driver.id === state.selectedDriverId);
    return selected || eligibleMatches()[0] || null;
  }

  function updateLiveClock() {
    const node = el("pilotTime");
    if (!node) return;
    const now = new Date();
    const timeStr = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).format(now);
    const dateStr = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short" }).format(now);
    node.textContent = `${dateStr} · ${timeStr}`;
  }

  function generateDepartureOptions() {
    const now = new Date();
    const formatTime = (d) => new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).format(d);
    const options = [
      { value: `Now · ${formatTime(now)}`, label: `Now · ${formatTime(now)}` }
    ];
    [15, 30, 45, 60].forEach((mins) => {
      const future = new Date(now.getTime() + mins * 60 * 1000);
      options.push({
        value: `In ${mins} mins · ${formatTime(future)}`,
        label: `In ${mins} mins · ${formatTime(future)}`
      });
    });
    return options;
  }

  function setOptions() {
    const pickup = el("pickupSelect");
    const drop = el("dropSelect");
    const options = stops.map((stop) => `<option value="${stop.id}">${stop.name}</option>`).join("");
    pickup.innerHTML = options;
    drop.innerHTML = `<option value="">Select destination</option>` + options;
    pickup.value = state.request.pickup;
    drop.value = state.request.drop || "";
    el("seatSelect").value = String(state.request.seats);

    const depEl = el("departureSelect");
    if (depEl && (!depEl.dataset.dynamic || depEl.options.length <= 1)) {
      const depOptions = generateDepartureOptions();
      depEl.innerHTML = depOptions.map((opt) => `<option value="${opt.value}">${opt.label}</option>`).join("");
      depEl.dataset.dynamic = "true";
      state.request.departure = depOptions[0].value;
    }

    renderLocationSummary("pickup");
    renderLocationSummary("drop");
    updateLiveClock();
  }

  function renderLocationSummary(mode) {
    const selectedStop = stopById(state.request[mode]);
    const label = state.locationLabels?.[mode] || { address: selectedStop?.name || "", stopName: selectedStop?.name || "" };
    if (!selectedStop) {
      el(`${mode}LocationText`).value = label.address || "";
      el(`${mode}LocationHint`).textContent = mode === "drop" ? "Select destination" : "Choose pickup";
      return;
    }
    el(`${mode}LocationText`).value = label.address || selectedStop.name;
    el(`${mode}LocationHint`).textContent = label.address === selectedStop.name ? "Approved pilot stop" : `Approved stop · ${selectedStop.short}`;
  }

  function renderMatches() {
    if (state.liveOffers !== null) {
      renderLiveMatches();
      return;
    }
    if (state.booking) {
      const booking = state.booking;
      const driver = getBookingDriver();
      const pickupName = stopById(booking.pickupStopId).short;
      const dropName = stopById(booking.dropStopId).short;
      const tripComplete = booking.state === "COMPLETED";
      el("matchCount").textContent = "1";
      el("matchList").innerHTML = `<article class="match-card card selected">
        <span class="driver-avatar" style="background:${driver.color}">${driver.initial}</span>
        <div class="match-driver">
          <div class="match-driver-title"><h3>${driver.name}</h3><span class="verified">● Route snapshot</span><span class="fit-badge">${booking.score}% fit at reservation</span></div>
          <p>${tripComplete ? "This simulated trip is complete; the route snapshot is retained for review." : "Your selected planned route is frozen while this simulated trip is active."}</p>
          <div class="match-facts"><span>Leaves <strong>${driver.departure}</strong></span><span>Pickup <strong>${formatMinutes(booking.pickupAtMinutes)}</strong></span><span><strong>${booking.seats}</strong> seat simulated</span><span>${pickupName} → ${dropName}</span></div>
        </div>
        <span class="fit-badge">${tripComplete ? "Trip complete" : "Route reserved"}</span>
      </article>`;
      renderMatchExplainer();
      return;
    }

    if (!state.request.drop) {
      el("matchCount").textContent = "0";
      el("matchList").innerHTML = `<div class="no-match card"><strong>Where are you going?</strong><span>Enter or select your drop location above to view compatible drivers on this corridor.</span></div>`;
      renderMatchExplainer();
      return;
    }

    const matches = eligibleMatches();
    const list = el("matchList");
    el("matchCount").textContent = matches.length;

    if (state.selectedDriverId && !matches.some((match) => match.driver.id === state.selectedDriverId)) {
      state.selectedDriverId = matches[0]?.driver.id || null;
    }

    list.innerHTML = matches.length
      ? matches.map(({ driver, score, pickupIndex, dropIndex, pickupAtMinutes }) => {
          const selected = state.selectedDriverId === driver.id;
          const seatsRemaining = driver.capacity - driver.reserved;
          const pickupName = stopById(driver.route[pickupIndex]).short;
          const dropName = stopById(driver.route[dropIndex]).short;
          return `<article class="match-card card ${selected ? "selected" : ""}" data-driver="${driver.id}">
            <span class="driver-avatar" style="background:${driver.color}">${driver.initial}</span>
            <div class="match-driver">
              <div class="match-driver-title"><h3>${driver.name}</h3><span class="verified">● Verified route</span><span class="fit-badge">${score}% fit</span></div>
              <p>${driver.description}</p>
              <div class="match-facts"><span>Leaves <strong>${driver.departure}</strong></span><span>Pickup <strong>${formatMinutes(pickupAtMinutes)}</strong></span><span><strong>${seatsRemaining}</strong> open seat${seatsRemaining === 1 ? "" : "s"}</span><span>${pickupName} → ${dropName}</span></div>
            </div>
            <button class="choose-match ${selected ? "reserve-match" : ""}" ${selected ? `data-reserve-driver="${driver.id}"` : `data-select-driver="${driver.id}"`}>${selected ? "Reserve lift →" : "Choose lift"}</button>
          </article>`;
        }).join("")
      : `<div class="no-match card"><strong>No compatible planned route</strong><span>Try a later time, another approved stop, or one passenger.</span></div>`;
    renderMatchExplainer();
  }

  function renderLiveMatches() {
    const list = el("matchList");
    const selected = state.liveSelectedOffer;
    const offers = state.liveOffers || [];
    el("matchCount").textContent = selected ? "1" : String(offers.length);
    if (selected) {
      list.innerHTML = `<article class="match-card card selected"><span class="driver-avatar">${escapeHtml(selected.driverName.slice(0, 1).toUpperCase())}</span><div class="match-driver"><div class="match-driver-title"><h3>${escapeHtml(selected.driverName)}</h3><span class="verified">● Live route offer</span><span class="fit-badge">${selected.score}% fit</span></div><p>Your selected offer is now waiting for the assigned driver to accept it server-side.</p><div class="match-facts"><span>Pickup <strong>${formatLiveTime(selected.pickupEta)}</strong></span><span>Drop <strong>${formatLiveTime(selected.dropEta)}</strong></span><span><strong>${selected.seatQty}</strong> requested seat</span></div></div><span class="fit-badge">SELECTED</span></article>`;
      renderLiveExplainer("Offer selected", ["Server-side route snapshot retained", "Driver must atomically accept capacity", "No browser seat reservation is created"]);
      return;
    }
    list.innerHTML = offers.length ? offers.map((offer) => `<article class="match-card card"><span class="driver-avatar">${escapeHtml(offer.driverName.slice(0, 1).toUpperCase())}</span><div class="match-driver"><div class="match-driver-title"><h3>${escapeHtml(offer.driverName)}</h3><span class="verified">● Live approved route</span><span class="fit-badge">${offer.score}% fit</span></div><p>Real backend match. The driver can only accept after you select this offer.</p><div class="match-facts"><span>Pickup <strong>${formatLiveTime(offer.pickupEta)}</strong></span><span>Drop <strong>${formatLiveTime(offer.dropEta)}</strong></span><span><strong>${offer.seatQty}</strong> requested seat</span></div></div><button class="choose-match reserve-match" data-select-live-offer="${offer.offerId}">Select live offer →</button></article>`).join("") : `<div class="no-match card"><strong>No live compatible route</strong><span>An approved driver must publish a planned route that covers both stops and your time window.</span></div>`;
    renderLiveExplainer("Server-side planned-route matching", ["Approved stops and forward order checked", "Capacity remains server-enforced", "Select an offer for driver acceptance"]);
  }

  function renderLiveExplainer(title, reasons) {
    el("matcher-title").textContent = title;
    el("scoreValue").textContent = state.liveSelectedOffer ? `${state.liveSelectedOffer.score}%` : "Live";
    el("scoreBar").style.width = state.liveSelectedOffer ? `${state.liveSelectedOffer.score}%` : "100%";
    el("validationList").innerHTML = reasons.map((reason) => `<div><i>✓</i><span>${escapeHtml(reason)}</span></div>`).join("");
  }

  function formatLiveTime(value) {
    return new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date(value));
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  }

  function renderMatchExplainer() {
    if (!state.request.drop) {
      el("matcher-title").textContent = "Destination required";
      el("scoreValue").textContent = "0%";
      el("scoreBar").style.width = "0%";
      el("validationList").innerHTML = `<div><i>⌖</i><span>Enter a destination in the drop point field above</span></div><div><i>🕒</i><span>Or select from previous searches</span></div>`;
      return;
    }
    if (state.booking) {
      const booking = state.booking;
      el("matcher-title").textContent = "Booking constraints captured";
      el("scoreValue").textContent = `${booking.score}%`;
      el("scoreBar").style.width = `${booking.score}%`;
      el("validationList").innerHTML = booking.reasons.map((reason) => `<div><i>✓</i><span>${reason}</span></div>`).join("");
      return;
    }
    const match = selectedEvaluation();
    const validationList = el("validationList");
    if (!match || match.decision !== "eligible") {
      el("matcher-title").textContent = "No safe route match";
      el("scoreValue").textContent = "0%";
      el("scoreBar").style.width = "0%";
      validationList.innerHTML = `<div><i>!</i><span>Adjust the request to see a safe planned-route match.</span></div>`;
      return;
    }
    el("matcher-title").textContent = "Forward-only validation";
    el("scoreValue").textContent = `${match.score}%`;
    el("scoreBar").style.width = `${match.score}%`;
    validationList.innerHTML = match.reasons.map((reason) => `<div><i>✓</i><span>${reason}</span></div>`).join("");
  }

  function renderCandidateTable() {
    const labels = {
      eligible: ["Eligible", "decision-ok"],
      "wrong-direction": ["Rejected", "decision-no"],
      "behind-driver": ["Rejected", "decision-no"],
      capacity: ["Capacity full", "decision-no"],
      "time-window": ["Time miss", "decision-no"],
      "unsafe-stop": ["Unsafe stop", "decision-no"],
      "outside-route": ["Off route", "decision-no"],
      unavailable: ["Unavailable", "decision-no"]
    };
    el("candidateTable").innerHTML = evaluations().map((result) => {
      const { driver, pickupIndex, dropIndex, decision } = result;
      const forward = pickupIndex >= 0 && dropIndex > pickupIndex && pickupIndex / (driver.route.length - 1) > driver.current;
      const safe = pickupIndex >= 0 && dropIndex >= 0 && hasApprovedStops(stopById(state.request.pickup), stopById(state.request.drop));
      const capacity = driver.capacity - driver.reserved >= state.request.seats;
      const [text, style] = labels[decision];
      return `<tr><td><strong>${driver.name}</strong><br><small>${driver.description}</small></td><td class="${forward ? "pass" : "fail"}">${forward ? "✓ yes" : "× no"}</td><td class="${safe ? "pass" : "fail"}">${safe ? "✓ approved" : "× unavailable"}</td><td class="${capacity ? "pass" : "fail"}">${capacity ? "✓ available" : "× full"}</td><td><span class="${style}">${text}</span></td></tr>`;
    }).join("");
  }

  function renderAudit() {
    el("auditLog").innerHTML = state.audit.map((entry) => `<li><time>${entry.time}</time><span><strong>${entry.detail}</strong><br>${entry.actor}</span><span class="event-tag">${entry.type}</span></li>`).join("");
    el("opsOpenRequests").textContent = state.booking?.state === "COMPLETED" ? "0" : "1";
  }

  function getBookingDriver() {
    return state.booking ? driverById(state.booking.driverId) : null;
  }

  function activeTripStops() {
    const pickupId = state.booking?.pickupStopId || state.request.pickup;
    const dropId = state.booking?.dropStopId || state.request.drop;
    return { pickup: stopById(pickupId) || stops[1], drop: stopById(dropId) || null };
  }

  function tripMeta(status) {
    const meta = {
      OFFERED: ["Driver offer pending", "OFFERED", "waiting"],
      DRIVER_EN_ROUTE: ["Driver is heading to pickup", "DRIVER EN ROUTE", "active"],
      DRIVER_ARRIVED: ["Driver is at the approved pickup point", "AT PICKUP", "active"],
      OTP_VERIFIED: ["Pickup confirmed — trip in progress", "IN PROGRESS", "active"],
      DROP_PROPOSED: ["Driver proposed your drop-off", "DROP PROPOSED", "waiting"],
      COMPLETED: ["Demo trip completed", "COMPLETED", "complete"]
    };
    return meta[status] || meta.OFFERED;
  }

  function bookingStepIndex(status) {
    const indices = { OFFERED: 0, DRIVER_EN_ROUTE: 1, DRIVER_ARRIVED: 2, OTP_VERIFIED: 3, DROP_PROPOSED: 3, COMPLETED: 4 };
    return indices[status] ?? 0;
  }

  function renderTripPanel() {
    const panel = el("tripPanel");
    if (!state.booking) { panel.hidden = true; return; }
    panel.hidden = false;
    const booking = state.booking;
    const driver = getBookingDriver();
    const [title, label, style] = tripMeta(booking.state);
    el("tripStatusTitle").textContent = title;
    const chip = el("tripStatusChip");
    chip.textContent = label;
    chip.className = `status-chip ${style}`;
    el("tripDriverName").textContent = driver.name;
    el("tripEta").textContent = booking.state === "COMPLETED" ? "—" : booking.state === "DRIVER_ARRIVED" ? "Arrived" : ["OTP_VERIFIED", "DROP_PROPOSED"].includes(booking.state) ? "Verified" : formatMinutes(booking.pickupAtMinutes);

    const steps = ["Matched", "En route", "At pickup", "In trip", "Complete"];
    const currentIndex = bookingStepIndex(booking.state);
    el("tripSteps").innerHTML = steps.map((step, index) => `<div class="trip-step ${index < currentIndex ? "done" : ""} ${index === currentIndex ? "current" : ""}"><i>${index < currentIndex ? "✓" : ""}</i><span>${step}</span></div>`).join("");

    const otpBlock = el("otpBlock");
    if (booking.state === "DRIVER_ARRIVED" && booking.otpLocked) {
      otpBlock.innerHTML = `<span>Pickup code</span><strong>Verification unavailable</strong>`;
    } else if (booking.state === "DRIVER_ARRIVED") {
      otpBlock.innerHTML = `<span>Pickup code</span><strong class="otp-code">${booking.otp}</strong>`;
    } else if (["OTP_VERIFIED", "DROP_PROPOSED", "COMPLETED"].includes(booking.state)) {
      otpBlock.innerHTML = `<span>Pickup code</span><strong>Verified ✓</strong>`;
    } else {
      otpBlock.innerHTML = `<span>Pickup code</span><strong>Available when driver arrives</strong>`;
    }

    const actions = el("tripActions");
    if (booking.state === "OFFERED") actions.innerHTML = `<span class="waiting-copy">Waiting for driver acceptance</span>`;
    else if (booking.state === "DRIVER_EN_ROUTE") actions.innerHTML = `<button class="secondary-button" data-workspace-go="driver">View driver console</button>`;
    else if (booking.state === "DRIVER_ARRIVED") actions.innerHTML = `<span class="waiting-copy">${booking.otpLocked ? "Verification is locked; reset the demo to start again." : "Share the code only after meeting the driver."}</span>`;
    else if (booking.state === "OTP_VERIFIED") actions.innerHTML = `<span class="waiting-copy">Trip status is simulated in this POC.</span>`;
    else if (booking.state === "DROP_PROPOSED") actions.innerHTML = `<button class="primary-button" data-confirm-drop>Confirm demo drop <span>→</span></button>`;
    else actions.innerHTML = `<span class="waiting-copy">No payment is collected in this pilot.</span>`;
  }

  function renderDriverWorkspace() {
    const driver = state.booking ? getBookingDriver() : driverById(state.selectedDriverId || "asha");
    const { pickup, drop } = activeTripStops();
    const requestedSeats = state.booking?.seats || state.request.seats;
    const compatibleRequest = selectedEvaluation()?.decision === "eligible";
    const available = driver.capacity - driver.reserved;
    el("availableSeats").textContent = `${available} of ${driver.capacity}`;
    el("routeProgressBar").style.width = `${Math.round(driver.current * 100)}%`;
    el("driverDeparture").textContent = driver.departure;
    el("driverPosition").textContent = `Now · ${driver.currentLabel}`;
    el("driverRouteName").textContent = `${stopById(driver.route[0]).short} → ${stopById(driver.route.at(-1)).short}`;
    el("driverRouteEnd").textContent = stopById(driver.route.at(-1)).short;
    const incoming = bySelector(".incoming-offer");

    if (!state.booking && state.offerExpired) {
      incoming.innerHTML = `<p class="eyebrow">Incoming request</p><h2>Offer expired</h2><p class="empty-card-copy">The provisional offer has been released. No seat was reserved.</p><button class="secondary-button" data-reset-offer>Restore demo offer</button>`;
    } else if (!state.booking && !state.declined && compatibleRequest) {
      incoming.innerHTML = `<div class="card-title-row"><div><p class="eyebrow">Incoming request</p><h2 id="offerTitle">${pickup.short} → ${drop.short}</h2></div><span class="offer-timer" id="offerTimer">${timerText(state.offerSeconds)}</span></div><div class="offer-person"><span class="passenger-avatar">M</span><span><strong>Maya</strong><small>${requestedSeats} passenger${requestedSeats === 1 ? "" : "s"} · 4.9 rider score</small></span></div><div class="offer-facts"><span>Pickup ahead <strong id="driverPickupDistance">${driver.pickupKm.toFixed(1)} km</strong></span><span>Detour <strong>0 min</strong></span><span>Safe stop <strong class="good-text">Confirmed</strong></span></div><div class="offer-actions"><button class="secondary-button" id="declineOffer">Decline</button><button class="primary-button" id="acceptOffer">Accept request <span>→</span></button></div><p class="offer-note">This browser simulates a reservation. Production must atomically lock capacity in the API.</p>`;
    } else if (state.declined) {
      incoming.innerHTML = `<p class="eyebrow">Incoming request</p><h2>Offer released</h2><p class="empty-card-copy">The request returned to matching. No seat was reserved.</p><button class="secondary-button" data-reset-offer>Restore demo offer</button>`;
    } else if (!state.booking) {
      incoming.innerHTML = `<p class="eyebrow">Incoming request</p><h2>No compatible request</h2><p class="empty-card-copy">This request does not currently pass all planned-route checks.</p><button class="secondary-button" data-workspace-go="passenger">Adjust request</button>`;
    } else {
      const capacityNote = state.booking.state === "COMPLETED" ? "The simulated capacity lock was released after trip completion." : "Future matches cannot use this simulated reservation.";
      incoming.innerHTML = `<p class="eyebrow">Committed booking</p><h2>${pickup.short} → ${drop.short}</h2><div class="offer-person"><span class="passenger-avatar">M</span><span><strong>Maya</strong><small>${requestedSeats} seat simulated · request RQ-2048</small></span></div><div class="safe-stop-note"><span>✓</span><p><strong>Route commitment preserved</strong><br />${capacityNote}</p></div><p class="offer-note">Forward-order, safe-stop, time-window, and capacity rules were validated before this seat was committed.</p>`;
    }

    const timeline = el("driverTimeline");
    const controlBox = el("driverControlBox");
    if (!state.booking) {
      el("driverTripState").textContent = "NO ACTIVE TRIP";
      el("driverTripState").className = "status-chip neutral";
      timeline.innerHTML = ["Offer", "Arrive", "Verify OTP", "Finish"].map((text, index) => `<div class="${index === 0 ? "current" : ""}">${text}</div>`).join("");
      controlBox.innerHTML = `<p>No passenger commitment yet.</p><span>Accept a compatible request to begin the POC trip lifecycle.</span>`;
      return;
    }
    const booking = state.booking;
    const currentIndex = bookingStepIndex(booking.state);
    const labels = ["Accepted", "Arrive", "Verify OTP", "Finish"];
    timeline.innerHTML = labels.map((text, index) => `<div class="${index < currentIndex ? "done" : ""} ${index === Math.min(currentIndex, 3) ? "current" : ""}">${text}</div>`).join("");
    el("driverTripState").textContent = tripMeta(booking.state)[1];
    el("driverTripState").className = `status-chip ${tripMeta(booking.state)[2]}`;

    if (booking.state === "OFFERED") {
      controlBox.innerHTML = `<p>Passenger has chosen this lift.</p><span>Accept to simulate a ${booking.seats}-seat reservation. Production uses an API transaction.</span><button class="primary-button" id="acceptOffer">Accept booking <span>→</span></button>`;
    } else if (booking.state === "DRIVER_EN_ROUTE") {
      controlBox.innerHTML = `<p>Navigate to ${pickup.short}.</p><span>Only mark arrival at the approved pickup point.</span><button class="primary-button" data-mark-arrived>I’m at pickup <span>→</span></button>`;
    } else if (booking.state === "DRIVER_ARRIVED" && booking.otpLocked) {
      controlBox.innerHTML = `<p>Pickup verification locked.</p><span>The browser-demo OTP expired or reached its three-attempt limit. Reset the demo to retry.</span>`;
    } else if (booking.state === "DRIVER_ARRIVED") {
      controlBox.innerHTML = `<p>Verify passenger pickup code.</p><span>Browser demo only: one code, two-minute expiry, and three attempts.</span><div class="otp-verify"><input id="otpInput" inputmode="numeric" maxlength="4" placeholder="4-digit code" aria-label="Pickup code"/><button class="primary-button" data-verify-otp>Verify</button></div>`;
    } else if (booking.state === "OTP_VERIFIED") {
      controlBox.innerHTML = `<p>Passenger pickup verified.</p><span>Trip is in progress. Complete only at the approved drop point.</span><button class="primary-button" data-propose-drop>Finish at drop <span>→</span></button>`;
    } else if (booking.state === "DROP_PROPOSED") {
      controlBox.innerHTML = `<p>Drop-off proposed to passenger.</p><span>Wait for passenger confirmation. Payment remains disabled.</span>`;
    } else {
      controlBox.innerHTML = `<p>Demo lifecycle complete.</p><span>The browser-local trace retains the state transition record.</span>`;
    }
  }

  function timerText(total) {
    const minutes = String(Math.max(0, Math.floor(total / 60))).padStart(2, "0");
    const seconds = String(Math.max(0, total % 60)).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function renderSafeStopNote(pickupId = state.request.pickup, dropId = state.request.drop) {
    const pickup = stopById(pickupId);
    const drop = stopById(dropId);
    const note = el("safeStopNote");
    if (!dropId || !drop) {
      note.classList.remove("unsafe");
      note.innerHTML = `<span>⌖</span><p><strong>Choose your destination</strong><br />Select an approved drop stop to check onward route safety.</p>`;
      return;
    }
    const safe = hasApprovedStops(pickup, drop);
    note.classList.toggle("unsafe", !safe);
    note.innerHTML = safe
      ? `<span>✓</span><p><strong>Safe-stop check</strong><br />Pickup is on the ${pickup?.roadSide || "east"} side of the road. Estimated walk: <span id="walkTime">${pickup?.walk || 2} min</span>.</p>`
      : `<span>!</span><p><strong>Pickup cannot be used</strong><br />Choose an approved roadside pickup and drop point.</p>`;
  }

  function syncMap() {
    const driver = state.booking ? getBookingDriver() : driverById(state.selectedDriverId || "asha");
    const routePoints = routeMarkerPoints(driver);
    const progress = Math.max(0, Math.min(1, driver.current));
    const progressPoint = progress * (routePoints.length - 1);
    const lower = Math.floor(progressPoint);
    const upper = Math.min(routePoints.length - 1, lower + 1);
    const between = progressPoint - lower;
    const point = {
      left: routePoints[lower].left + (routePoints[upper].left - routePoints[lower].left) * between,
      top: routePoints[lower].top + (routePoints[upper].top - routePoints[lower].top) * between
    };
    const marker = el("driverMarker");
    marker.style.left = `${point.left}%`;
    marker.style.top = `${point.top}%`;
    marker.querySelector("small").textContent = driver.name.split(" ")[0];
    marker.setAttribute("aria-label", `Driver ${driver.name} current location`);
    const { pickup, drop } = activeTripStops();
    document.querySelectorAll(".route-node").forEach((node) => {
      node.dataset.selected = [pickup?.short, drop?.short].filter(Boolean).includes(node.dataset.stop) ? "true" : "false";
    });
    const walkTime = el("walkTime");
    if (walkTime) walkTime.textContent = `${stopById(state.request.pickup)?.walk || 2} min`;
    el("lastUpdate").textContent = `${state.lastUpdateSeconds} sec ago`;
    el("map-title").textContent = drop ? `${pickup?.short || "Pickup"} → ${drop?.short}` : `${pickup?.short || "Pickup"} → Where to?`;
    const mapBadge = el("mapBadge") || document.querySelector(".map-badge");
    if (mapBadge) {
      mapBadge.textContent = drop ? "Direct Road Route" : "Select Destination";
    }
  }

  function renderAll() {
    setOptions();
    renderSafeStopNote();
    renderMatches();
    renderTripPanel();
    renderDriverWorkspace();
    renderCandidateTable();
    renderAudit();
    syncMap();
  }

  function showToast(title, detail = "", kind = "success") {
    const toast = document.createElement("div");
    toast.className = `toast ${kind === "error" ? "error" : ""}`;
    toast.innerHTML = `<strong>${title}</strong>${detail ? `<small>${detail}</small>` : ""}`;
    el("toastRegion").append(toast);
    setTimeout(() => toast.remove(), 4200);
  }

  function beginOffer(driverId = state.selectedDriverId) {
    if (state.offerExpired) {
      showToast("Offer expired", "Restore the demo offer before reserving a route.", "error");
      return;
    }
    const evaluation = evaluations().find((result) => result.driver.id === driverId);
    if (!evaluation || evaluation.decision !== "eligible") {
      showToast("Cannot reserve this route", "The route no longer passes all planned-match checks.", "error");
      return;
    }
    if (state.booking) {
      showToast("A demo booking is already active", "Reset the demo to start a new request.", "error");
      return;
    }
    state.selectedDriverId = driverId;
    state.booking = {
      driverId,
      state: "OFFERED",
      otp: null,
      attempts: 0,
      score: evaluation.score,
      reasons: [...evaluation.reasons],
      pickupStopId: state.request.pickup,
      dropStopId: state.request.drop,
      pickupIndex: evaluation.pickupIndex,
      dropIndex: evaluation.dropIndex,
      seats: state.request.seats,
      pickupAtMinutes: evaluation.pickupAtMinutes,
      requestedAt: evaluation.requestedAt,
      latestPickupAt: evaluation.latestPickupAt
    };
    addAudit("OFFER_CREATED", `${evaluation.driver.name} received a seat-hold offer for RQ-2048`, "matcher");
    renderAll();
    showToast("Lift selected", "Driver acceptance is required before the seat is reserved.");
  }

  function acceptOffer() {
    if (!state.booking) beginOffer();
    if (!state.booking) return;
    const driver = getBookingDriver();
    if (driver.capacity - driver.reserved < state.booking.seats) {
      showToast("Seat lock failed", "Another booking used the remaining capacity.", "error");
      return;
    }
    driver.reserved += state.booking.seats;
    state.booking.state = "DRIVER_EN_ROUTE";
    addAudit("BOOKING_ACCEPTED", `${driver.name} accepted; ${state.booking.seats} seat simulation committed`, "driver");
    renderAll();
    showToast("Seat reservation simulated", "One seat is locked in this browser demo only.");
  }

  function markArrived() {
    if (!state.booking || state.booking.state !== "DRIVER_EN_ROUTE") return;
    state.booking.state = "DRIVER_ARRIVED";
    state.booking.otp = String(Math.floor(1000 + Math.random() * 9000));
    state.booking.otpLocked = false;
    state.booking.otpExpiresAt = Date.now() + 120000;
    const driver = getBookingDriver();
    driver.current = Math.max(driver.current, state.booking.pickupIndex / (driver.route.length - 1));
    driver.currentLabel = stopById(state.booking.pickupStopId).short;
    addAudit("DRIVER_ARRIVED", `${driver.name} reached the approved pickup stop`, "driver");
    renderAll();
    showToast("Arrival recorded", "Pickup code is now visible to the passenger.");
    const bookingReference = state.booking;
    setTimeout(() => {
      if (state.booking !== bookingReference || state.booking.state !== "DRIVER_ARRIVED" || state.booking.otpLocked) return;
      state.booking.otpLocked = true;
      state.booking.otpExpired = true;
      addAudit("OTP_EXPIRED", "Pickup OTP expired after two minutes without verification", "system");
      renderAll();
      showToast("Pickup code expired", "Reset the demo to issue a new code.", "error");
    }, 120000);
  }

  function verifyOtp() {
    if (!state.booking || state.booking.state !== "DRIVER_ARRIVED") return;
    if (state.booking.otpLocked || Date.now() > state.booking.otpExpiresAt) {
      state.booking.otpLocked = true;
      state.booking.otpExpired = true;
      addAudit("OTP_EXPIRED", "Pickup OTP could not be verified after its validity window", "system");
      renderAll();
      showToast("Pickup code expired", "Reset the demo to issue a new code.", "error");
      return;
    }
    const input = el("otpInput");
    if (input.value.trim() !== state.booking.otp) {
      state.booking.attempts += 1;
      addAudit("OTP_REJECTED", `Incorrect pickup code; attempt ${state.booking.attempts}`, "driver");
      if (state.booking.attempts >= 3) {
        state.booking.otpLocked = true;
        addAudit("OTP_LOCKED", "Pickup OTP locked after three incorrect attempts", "system");
        renderAll();
        showToast("Verification locked", "Reset the demo to issue a new code.", "error");
        return;
      }
      showToast("Code did not match", `Attempt ${state.booking.attempts} recorded.`, "error");
      input.value = "";
      return;
    }
    state.booking.state = "OTP_VERIFIED";
    addAudit("OTP_VERIFIED", "Pickup challenge verified; trip entered IN_PROGRESS", "system");
    renderAll();
    showToast("Pickup verified", "Trip is now in progress.");
  }

  function proposeDrop() {
    if (!state.booking || state.booking.state !== "OTP_VERIFIED") return;
    state.booking.state = "DROP_PROPOSED";
    const driver = getBookingDriver();
    driver.current = Math.max(driver.current, state.booking.dropIndex / (driver.route.length - 1));
    driver.currentLabel = stopById(state.booking.dropStopId).short;
    addAudit("DROP_PROPOSED", "Driver proposed the approved drop-off; payment remains disabled", "driver");
    renderAll();
    showToast("Drop-off proposed", "Passenger confirmation is needed to close this demo.");
  }

  function confirmDrop() {
    if (!state.booking || state.booking.state !== "DROP_PROPOSED") return;
    const driver = getBookingDriver();
    state.booking.state = "COMPLETED";
    if (!state.booking.capacityReleased) {
      driver.reserved = Math.max(0, driver.reserved - state.booking.seats);
      state.booking.capacityReleased = true;
    }
    addAudit("TRIP_COMPLETED", "Passenger confirmed demo drop; simulated capacity released and no payment intent created", "passenger");
    renderAll();
    showToast("Demo trip completed", "No payment was created or collected.");
  }

  function declineOffer() {
    if (state.booking) return;
    state.declined = true;
    state.selectedDriverId = null;
    addAudit("OFFER_DECLINED", "Driver declined the provisional route offer", "driver");
    renderAll();
    showToast("Offer released", "No capacity change was made.");
  }

  function restoreOffer() {
    state.declined = false;
    state.offerExpired = false;
    state.offerSeconds = 80;
    state.selectedDriverId = eligibleMatches()[0]?.driver.id || null;
    addAudit("OFFER_RESTORED", "Demo offer restored; no capacity was changed", "system");
    renderAll();
    showToast("Demo offer restored", "The 80-second simulated offer window restarted.");
  }

  function resetDemo() {
    initialiseState();
    renderAll();
    showToast("Pilot reset", "All simulated state is back to its seeded values.");
  }

  function switchWorkspace(name) {
    const spaces = { passenger: ["passengerWorkspace", "Passenger booking"], driver: ["driverWorkspace", "Driver console"], ops: ["opsWorkspace", "Operations"] };
    Object.entries(spaces).forEach(([key, [id]]) => { el(id).hidden = key !== name; });
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.workspace === name));
    el("workspaceLabel").textContent = spaces[name][1];
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function searchRoutes(event) {
    event.preventDefault();
    if (state.booking) {
      showToast("An active demo ride is in progress", "Use Reset demo to create a different request.", "error");
      return;
    }
    const dropVal = el("dropSelect").value || state.request.drop;
    if (!dropVal) {
      showToast("Drop point required", "Please choose your drop location from the search or history dropdown.", "error");
      el("dropLocationText")?.focus();
      window.LiftLocationPicker?.showDropHistorySuggestions();
      return;
    }
    state.request = {
      pickup: el("pickupSelect").value,
      drop: dropVal,
      seats: Number(el("seatSelect").value),
      departure: el("departureSelect").value
    };
    state.declined = false;
    state.offerExpired = false;
    state.offerSeconds = 80;
    state.liveOffers = null;
    state.liveSelectedOffer = null;
    if (live()?.session) {
      const places = window.LIFT_CONFIG.pilotPlaces;
      const earliest = new Date(Date.now() + 15 * 60 * 1000);
      const latest = new Date(earliest.getTime() + 30 * 60 * 1000);
      try {
        const request = await live().invoke("create-ride-request", {
          pickupPlaceId: places[state.request.pickup], dropPlaceId: places[state.request.drop],
          earliestDepartureAt: earliest.toISOString(), latestDepartureAt: latest.toISOString(), seatQty: state.request.seats
        });
        const match = await live().invoke("match-ride-request", { requestId: request.requestId });
        state.liveRequestId = request.requestId;
        state.liveOffers = match.offers || [];
        renderAll();
        showToast(state.liveOffers.length ? "Live offers found" : "No live route", state.liveOffers.length ? "These results are from the Supabase matching API." : "Ask an approved driver to publish a matching planned route.", state.liveOffers.length ? "success" : "error");
      } catch (error) {
        showToast("Live request failed", error.message || "The backend rejected this request.", "error");
      }
      return;
    }
    state.selectedDriverId = eligibleMatches()[0]?.driver.id || null;
    const matchCount = eligibleMatches().length;
    addAudit("MATCHER_EVALUATED", `Request checked; ${matchCount} eligible planned route${matchCount === 1 ? "" : "s"}`, "matcher");
    renderAll();
    showToast(matchCount ? `${matchCount} route match${matchCount === 1 ? "" : "es"} found` : "No compatible route", matchCount ? "Each result passed the forward-order and capacity checks." : "Try a later time or a different stop.", matchCount ? "success" : "error");
  }

  async function selectLiveOffer(offerId) {
    const offer = state.liveOffers?.find((item) => item.offerId === offerId);
    if (!offer) return;
    try {
      await live().invoke("select-offer", { offerId });
      state.liveSelectedOffer = offer;
      renderAll();
      showToast("Live offer selected", "The assigned driver can now atomically accept this seat.");
    } catch (error) {
      showToast("Could not select offer", error.message || "The offer may have expired.", "error");
    }
  }

  async function publishPilotRoute() {
    try {
      const route = await live().publishPilotRoute();
      showToast("Live route published", `Route ${route.routeId || ""} is now matchable.`);
    } catch (error) {
      showToast("Route not published", error.message || "Only an approved driver can publish a route.", "error");
    }
  }

  async function refreshDriverOffers() {
    const target = el("liveDriverOffers");
    try {
      const offers = await live().invoke("list-driver-offers", {}, false);
      target.innerHTML = offers.length ? offers.map((offer) => `<div class="safe-stop-note"><span>✓</span><p><strong>${escapeHtml(offer.passengerName)}</strong><br>${escapeHtml(offer.pickupName)} → ${escapeHtml(offer.dropName)} · ${offer.seatQty} seat<button class="secondary-button" data-accept-live-offer="${offer.offerId}">Accept live offer</button></p></div>`).join("") : "No selected live offers.";
    } catch (error) {
      target.textContent = error.message || "Only approved drivers can view selected offers.";
    }
  }

  async function acceptLiveOffer(offerId) {
    try {
      const result = await live().invoke("accept-offer", { offerId });
      showToast("Live seat reserved", `Booking ${result.bookingId} was created server-side.`);
      refreshDriverOffers();
    } catch (error) {
      showToast("Acceptance conflict", error.message || "The offer could not be accepted.", "error");
    }
  }

  function replayRoute() {
    window.dispatchEvent(new Event("lift:replay-driver"));
    const marker = el("driverMarker");
    const driver = state.booking ? getBookingDriver() : driverById(state.selectedDriverId || "asha");
    const routePoints = routeMarkerPoints(driver);
    marker.style.transition = "left .5s ease, top .5s ease";
    let index = 0;
    const interval = setInterval(() => {
      marker.style.left = `${routePoints[index].left}%`;
      marker.style.top = `${routePoints[index].top}%`;
      index += 1;
      if (index === routePoints.length) {
        clearInterval(interval);
        setTimeout(() => { marker.style.transition = "left 1.1s cubic-bezier(.22,.9,.35,1), top 1.1s cubic-bezier(.22,.9,.35,1)"; syncMap(); }, 600);
      }
    }, 430);
    showToast("Route replayed", "Driver Asha is approaching from Gandhipuram along the planned corridor.");
  }

  function bindEvents() {
    el("rideSearchForm").addEventListener("submit", searchRoutes);
    document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => switchWorkspace(button.dataset.workspace)));
    document.addEventListener("click", (event) => {
      const liveSelection = event.target.closest("[data-select-live-offer]");
      if (liveSelection) { selectLiveOffer(liveSelection.dataset.selectLiveOffer); return; }
      const liveAcceptance = event.target.closest("[data-accept-live-offer]");
      if (liveAcceptance) { acceptLiveOffer(liveAcceptance.dataset.acceptLiveOffer); return; }
      const selected = event.target.closest("[data-select-driver]");
      if (selected) { state.selectedDriverId = selected.dataset.selectDriver; renderAll(); return; }
      const reserve = event.target.closest("[data-reserve-driver]");
      if (reserve) { beginOffer(reserve.dataset.reserveDriver); return; }
      const workspace = event.target.closest("[data-workspace-go]");
      if (workspace) { switchWorkspace(workspace.dataset.workspaceGo); return; }
      if (event.target.closest("#acceptOffer")) { acceptOffer(); return; }
      if (event.target.closest("#declineOffer")) { declineOffer(); return; }
      if (event.target.closest("[data-reset-offer]")) { restoreOffer(); return; }
      if (event.target.closest("[data-mark-arrived]")) { markArrived(); return; }
      if (event.target.closest("[data-verify-otp]")) { verifyOtp(); return; }
      if (event.target.closest("[data-propose-drop]")) { proposeDrop(); return; }
      if (event.target.closest("[data-confirm-drop]")) { confirmDrop(); return; }
      if (event.target.closest("#resetDemo")) { resetDemo(); }
    });
    el("replayRoute").addEventListener("click", replayRoute);
    el("openGoogleMapsHeaderBtn")?.addEventListener("click", () => window.openInGoogleMapsApp?.());
    el("openGoogleMapsFloatingBtn")?.addEventListener("click", () => window.openInGoogleMapsApp?.());
    el("openGoogleMapsFooterBtn")?.addEventListener("click", () => window.openInGoogleMapsApp?.());
    el("publishPilotRoute").addEventListener("click", publishPilotRoute);
    el("refreshDriverOffers").addEventListener("click", refreshDriverOffers);
    el("helpButton").addEventListener("click", () => el("helpDialog").showModal());
    el("dialogClose").addEventListener("click", () => el("helpDialog").close());
    el("dialogDone").addEventListener("click", () => el("helpDialog").close());
    el("themeToggle").addEventListener("click", () => document.body.classList.toggle("high-contrast"));
    el("bannerClose").addEventListener("click", () => el("safetyBanner").remove());
    el("pickupLocationButton").addEventListener("click", () => window.LiftLocationPicker?.open("pickup"));
    el("dropLocationButton").addEventListener("click", () => window.LiftLocationPicker?.open("drop"));
    window.addEventListener("lift:location-selected", (event) => {
      const { mode, stopId, address, stopName } = event.detail || {};
      if (!mode) return;
      if (stopId && stopById(stopId)) {
        state.request[mode] = stopId;
      }
      state.locationLabels[mode] = { address: address || stopName || "", stopName: stopName || address || "" };
      setOptions();
      renderSafeStopNote();
      renderAll();
      showToast(`${mode === "pickup" ? "Pickup" : "Drop"} updated`, stopName ? `Nearest approved pilot stop: ${stopName}.` : "Location updated.");
    });
    const previewSafeStop = () => renderSafeStopNote(el("pickupSelect").value, el("dropSelect").value);
    el("pickupSelect").addEventListener("change", previewSafeStop);
    el("dropSelect").addEventListener("change", previewSafeStop);
  }

  function runClock() {
    updateLiveClock();
    setInterval(() => {
      updateLiveClock();
      state.lastUpdateSeconds = state.lastUpdateSeconds >= 19 ? 4 : state.lastUpdateSeconds + 1;
      const last = el("lastUpdate");
      if (last) last.textContent = `${state.lastUpdateSeconds} sec ago`;
      if (!state.booking && !state.declined && !state.offerExpired && state.offerSeconds > 0) {
        state.offerSeconds -= 1;
        const timer = el("offerTimer");
        if (timer) timer.textContent = timerText(state.offerSeconds);
        if (state.offerSeconds === 0) {
          state.offerExpired = true;
          addAudit("OFFER_EXPIRED", "Provisional offer expired; no capacity reservation was made", "system");
          renderAll();
          showToast("Offer expired", "No seat was reserved.", "error");
        }
      }
    }, 1000);
  }

  initialiseState();
  setOptions();
  bindEvents();
  renderAll();
  runClock();
})();
