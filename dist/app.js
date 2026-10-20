(() => {
  "use strict";

  const stops = [
    { id: "gandhipuram", name: "Gandhipuram Bus Stand", short: "Gandhipuram", walk: 3 },
    { id: "nava-india", name: "Nava India", short: "Nava India", walk: 2 },
    { id: "peelamedu", name: "Peelamedu", short: "Peelamedu", walk: 3 },
    { id: "hope-college", name: "Hope College", short: "Hope College", walk: 4 },
    { id: "vilankurichi", name: "Vilankurichi", short: "Vilankurichi", walk: 3 },
    { id: "saravanampatti", name: "Saravanampatti", short: "Saravanampatti", walk: 5 }
  ];

  const markerPoints = [
    { left: 8, top: 75 }, { left: 28, top: 61 }, { left: 48, top: 48 },
    { left: 63, top: 42 }, { left: 79, top: 36 }, { left: 91, top: 20 }
  ];

  const initialDrivers = [
    {
      id: "asha", name: "Asha K.", initial: "A", color: "linear-gradient(135deg, #e5a174, #8b4c8a)",
      route: stops.map((stop) => stop.id), current: 0.15, capacity: 1, reserved: 0,
      departure: "8:30 AM", wait: 12, pickupKm: 0.6, reliability: 4.9, scoreBase: 94,
      description: "Already travelling via Nava India and Peelamedu", state: "PUBLISHED"
    },
    {
      id: "ram", name: "Ram V.", initial: "R", color: "linear-gradient(135deg, #4d8fe8, #3a497f)",
      route: stops.map((stop) => stop.id), current: 0.08, capacity: 2, reserved: 0,
      departure: "8:38 AM", wait: 18, pickupKm: 0.3, reliability: 4.7, scoreBase: 81,
      description: "Planned corridor with a later departure", state: "PUBLISHED"
    },
    {
      id: "reverse", name: "Kiran S.", initial: "K", color: "linear-gradient(135deg, #b177e4, #5b3d8d)",
      route: [...stops].reverse().map((stop) => stop.id), current: 0.25, capacity: 1, reserved: 0,
      departure: "8:25 AM", wait: 8, pickupKm: 0.4, reliability: 4.8, scoreBase: 0,
      description: "Reverse direction test route", state: "PUBLISHED"
    },
    {
      id: "full", name: "Meera N.", initial: "M", color: "linear-gradient(135deg, #6bd3c1, #317b93)",
      route: stops.map((stop) => stop.id), current: 0.05, capacity: 1, reserved: 1,
      departure: "8:35 AM", wait: 15, pickupKm: 0.5, reliability: 4.8, scoreBase: 0,
      description: "Correct direction but no remaining seats", state: "PUBLISHED"
    }
  ];

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const defaultRequest = { pickup: "nava-india", drop: "peelamedu", seats: 1, departure: "8:30 AM · Today" };
  let state;

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
      markerIndex: 1,
      lastUpdateSeconds: 8,
      declined: false
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

  function evaluateDriver(driver) {
    const { pickup, drop, seats } = state.request;
    const pickupIndex = requestedStopIndex(driver, pickup);
    const dropIndex = requestedStopIndex(driver, drop);
    const reasons = [];
    let decision = "eligible";

    if (driver.state !== "PUBLISHED") {
      decision = "unavailable";
      reasons.push("Route is not published");
    }
    if (pickupIndex < 0 || dropIndex < 0) {
      decision = "outside-route";
      reasons.push("Requested stops are not on this route");
    } else if (dropIndex <= pickupIndex) {
      decision = "wrong-direction";
      reasons.push("Drop would happen before pickup on this route");
    } else if (pickupIndex / (driver.route.length - 1) <= driver.current) {
      decision = "behind-driver";
      reasons.push("Pickup is already behind the driver");
    }
    if (driver.capacity - driver.reserved < seats) {
      if (decision === "eligible") decision = "capacity";
      reasons.push("Not enough remaining seat capacity");
    }
    if (decision === "eligible") {
      reasons.push("Pickup and drop are forward on the route");
      reasons.push("Approved roadside stop is available");
      reasons.push(`${driver.capacity - driver.reserved} seat ${driver.capacity - driver.reserved === 1 ? "is" : "are"} available`);
      reasons.push(`${driver.wait} min pickup ETA fits your time window`);
    }
    const score = decision === "eligible" ? Math.max(63, driver.scoreBase - Math.max(0, state.request.seats - 1) * 13) : 0;
    return { driver, pickupIndex, dropIndex, score, reasons, decision };
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

  function setOptions() {
    const pickup = el("pickupSelect");
    const drop = el("dropSelect");
    const options = stops.map((stop) => `<option value="${stop.id}">${stop.name}</option>`).join("");
    pickup.innerHTML = options;
    drop.innerHTML = options;
    pickup.value = state.request.pickup;
    drop.value = state.request.drop;
    el("seatSelect").value = String(state.request.seats);
    el("departureSelect").value = state.request.departure;
  }

  function renderMatches() {
    const matches = eligibleMatches();
    const list = el("matchList");
    el("matchCount").textContent = matches.length;

    if (state.selectedDriverId && !matches.some((match) => match.driver.id === state.selectedDriverId)) {
      state.selectedDriverId = matches[0]?.driver.id || null;
    }

    list.innerHTML = matches.length
      ? matches.map(({ driver, score, pickupIndex, dropIndex }) => {
          const selected = state.selectedDriverId === driver.id;
          const seatsRemaining = driver.capacity - driver.reserved;
          const pickupName = stopById(driver.route[pickupIndex]).short;
          const dropName = stopById(driver.route[dropIndex]).short;
          return `<article class="match-card card ${selected ? "selected" : ""}" data-driver="${driver.id}">
            <span class="driver-avatar" style="background:${driver.color}">${driver.initial}</span>
            <div class="match-driver">
              <div class="match-driver-title"><h3>${driver.name}</h3><span class="verified">● Verified route</span><span class="fit-badge">${score}% fit</span></div>
              <p>${driver.description}</p>
              <div class="match-facts"><span>Leaves <strong>${driver.departure}</strong></span><span>Pickup <strong>${driver.wait} min</strong></span><span><strong>${seatsRemaining}</strong> open seat${seatsRemaining === 1 ? "" : "s"}</span><span>${pickupName} → ${dropName}</span></div>
            </div>
            <button class="choose-match ${selected ? "reserve-match" : ""}" ${selected ? `data-reserve-driver="${driver.id}"` : `data-select-driver="${driver.id}"`}>${selected ? "Reserve lift →" : "Choose lift"}</button>
          </article>`;
        }).join("")
      : `<div class="no-match card"><strong>No compatible planned route</strong><span>Try a later time, another approved stop, or one passenger.</span></div>`;
    renderMatchExplainer();
  }

  function renderMatchExplainer() {
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
      "outside-route": ["Off route", "decision-no"],
      unavailable: ["Unavailable", "decision-no"]
    };
    el("candidateTable").innerHTML = evaluations().map((result) => {
      const { driver, pickupIndex, dropIndex, decision } = result;
      const forward = pickupIndex >= 0 && dropIndex > pickupIndex && decision !== "behind-driver";
      const safe = pickupIndex >= 0 && dropIndex >= 0;
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

  function tripMeta(status) {
    const meta = {
      OFFERED: ["Driver offer pending", "OFFERED", "waiting"],
      DRIVER_EN_ROUTE: ["Asha is heading to pickup", "DRIVER EN ROUTE", "active"],
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
    el("tripEta").textContent = booking.state === "COMPLETED" ? "—" : booking.state === "DRIVER_ARRIVED" ? "Arrived" : `${driver.wait} min`;

    const steps = ["Matched", "En route", "At pickup", "In trip", "Complete"];
    const currentIndex = bookingStepIndex(booking.state);
    el("tripSteps").innerHTML = steps.map((step, index) => `<div class="trip-step ${index < currentIndex ? "done" : ""} ${index === currentIndex ? "current" : ""}"><i>${index < currentIndex ? "✓" : ""}</i><span>${step}</span></div>`).join("");

    const otpBlock = el("otpBlock");
    if (booking.state === "DRIVER_ARRIVED") {
      otpBlock.innerHTML = `<span>Pickup code</span><strong class="otp-code">${booking.otp}</strong>`;
    } else if (["OTP_VERIFIED", "DROP_PROPOSED", "COMPLETED"].includes(booking.state)) {
      otpBlock.innerHTML = `<span>Pickup code</span><strong>Verified ✓</strong>`;
    } else {
      otpBlock.innerHTML = `<span>Pickup code</span><strong>Available when driver arrives</strong>`;
    }

    const actions = el("tripActions");
    if (booking.state === "OFFERED") actions.innerHTML = `<span class="waiting-copy">Waiting for driver acceptance</span>`;
    else if (booking.state === "DRIVER_EN_ROUTE") actions.innerHTML = `<button class="secondary-button" data-workspace-go="driver">View driver console</button>`;
    else if (booking.state === "DRIVER_ARRIVED") actions.innerHTML = `<span class="waiting-copy">Share the code only after meeting the driver.</span>`;
    else if (booking.state === "OTP_VERIFIED") actions.innerHTML = `<span class="waiting-copy">Trip status is simulated in this POC.</span>`;
    else if (booking.state === "DROP_PROPOSED") actions.innerHTML = `<button class="primary-button" data-confirm-drop>Confirm demo drop <span>→</span></button>`;
    else actions.innerHTML = `<span class="waiting-copy">No payment is collected in this pilot.</span>`;
  }

  function renderDriverWorkspace() {
    const driver = state.booking ? getBookingDriver() : driverById(state.selectedDriverId || "asha");
    const relevant = state.booking ? evaluateDriver(driver) : selectedEvaluation();
    const pickup = stopById(state.request.pickup);
    const drop = stopById(state.request.drop);
    const available = driver.capacity - driver.reserved;
    el("availableSeats").textContent = `${available} of ${driver.capacity}`;
    el("routeProgressBar").style.width = `${Math.round(driver.current * 100)}%`;
    const incoming = bySelector(".incoming-offer");

    if (!state.booking && !state.declined) {
      incoming.innerHTML = `<div class="card-title-row"><div><p class="eyebrow">Incoming request</p><h2 id="offerTitle">${pickup.short} → ${drop.short}</h2></div><span class="offer-timer" id="offerTimer">${timerText(state.offerSeconds)}</span></div><div class="offer-person"><span class="passenger-avatar">M</span><span><strong>Maya</strong><small>${state.request.seats} passenger${state.request.seats === 1 ? "" : "s"} · 4.9 rider score</small></span></div><div class="offer-facts"><span>Pickup ahead <strong id="driverPickupDistance">${driver.pickupKm.toFixed(1)} km</strong></span><span>Detour <strong>0 min</strong></span><span>Safe stop <strong class="good-text">Confirmed</strong></span></div><div class="offer-actions"><button class="secondary-button" id="declineOffer">Decline</button><button class="primary-button" id="acceptOffer">Accept request <span>→</span></button></div><p class="offer-note">A successful accept atomically holds the seat and invalidates conflicting offers.</p>`;
    } else if (state.declined) {
      incoming.innerHTML = `<p class="eyebrow">Incoming request</p><h2>Offer released</h2><p class="empty-card-copy">The request returned to matching. No seat was reserved.</p><button class="secondary-button" data-reset-offer>Restore demo offer</button>`;
    } else {
      incoming.innerHTML = `<p class="eyebrow">Committed booking</p><h2>${pickup.short} → ${drop.short}</h2><div class="offer-person"><span class="passenger-avatar">M</span><span><strong>Maya</strong><small>${state.request.seats} seat locked · request RQ-2048</small></span></div><div class="safe-stop-note"><span>✓</span><p><strong>Route commitment preserved</strong><br />Future matches cannot use this reserved seat.</p></div><p class="offer-note">Forward-order, safe-stop, and capacity rules were validated before this seat was committed.</p>`;
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
      controlBox.innerHTML = `<p>Passenger has chosen this lift.</p><span>Accept to atomically reserve ${state.request.seats} seat${state.request.seats === 1 ? "" : "s"}.</span><button class="primary-button" id="acceptOffer">Accept booking <span>→</span></button>`;
    } else if (booking.state === "DRIVER_EN_ROUTE") {
      controlBox.innerHTML = `<p>Navigate to ${pickup.short}.</p><span>Only mark arrival at the approved pickup point.</span><button class="primary-button" data-mark-arrived>I’m at pickup <span>→</span></button>`;
    } else if (booking.state === "DRIVER_ARRIVED") {
      controlBox.innerHTML = `<p>Verify passenger pickup code.</p><span>OTP is valid for this single simulated booking.</span><div class="otp-verify"><input id="otpInput" inputmode="numeric" maxlength="4" placeholder="4-digit code" aria-label="Pickup code"/><button class="primary-button" data-verify-otp>Verify</button></div>`;
    } else if (booking.state === "OTP_VERIFIED") {
      controlBox.innerHTML = `<p>Passenger pickup verified.</p><span>Trip is in progress. Complete only at the approved drop point.</span><button class="primary-button" data-propose-drop>Finish at drop <span>→</span></button>`;
    } else if (booking.state === "DROP_PROPOSED") {
      controlBox.innerHTML = `<p>Drop-off proposed to passenger.</p><span>Wait for passenger confirmation. Payment remains disabled.</span>`;
    } else {
      controlBox.innerHTML = `<p>Demo lifecycle complete.</p><span>Event log retains the state transition record.</span>`;
    }
  }

  function timerText(total) {
    const minutes = String(Math.max(0, Math.floor(total / 60))).padStart(2, "0");
    const seconds = String(Math.max(0, total % 60)).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function syncMap() {
    const driver = state.booking ? getBookingDriver() : driverById(state.selectedDriverId || "asha");
    const progress = Math.max(0, Math.min(1, driver.current));
    const index = Math.min(markerPoints.length - 1, Math.max(0, Math.round(progress * (markerPoints.length - 1))));
    const marker = el("driverMarker");
    marker.style.left = `${markerPoints[index].left}%`;
    marker.style.top = `${markerPoints[index].top}%`;
    marker.querySelector("small").textContent = driver.name.split(" ")[0];
    document.querySelectorAll(".route-node").forEach((node) => {
      node.dataset.selected = [stopById(state.request.pickup).short, stopById(state.request.drop).short].includes(node.dataset.stop) ? "true" : "false";
    });
    el("walkTime").textContent = `${stopById(state.request.pickup).walk} min`;
    el("lastUpdate").textContent = `${state.lastUpdateSeconds} sec ago`;
  }

  function renderAll() {
    setOptions();
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
    state.booking = { driverId, state: "OFFERED", otp: null, attempts: 0 };
    addAudit("OFFER_CREATED", `${evaluation.driver.name} received a seat-hold offer for RQ-2048`, "matcher");
    renderAll();
    showToast("Lift selected", "Driver acceptance is required before the seat is reserved.");
  }

  function acceptOffer() {
    if (!state.booking) beginOffer();
    if (!state.booking) return;
    const driver = getBookingDriver();
    if (driver.capacity - driver.reserved < state.request.seats) {
      showToast("Seat lock failed", "Another booking used the remaining capacity.", "error");
      return;
    }
    driver.reserved += state.request.seats;
    state.booking.state = "DRIVER_EN_ROUTE";
    addAudit("BOOKING_ACCEPTED", `${driver.name} accepted; ${state.request.seats} seat lock committed`, "driver");
    renderAll();
    showToast("Seat reserved", "Conflicting offers were invalidated in this demo.");
  }

  function markArrived() {
    if (!state.booking || state.booking.state !== "DRIVER_EN_ROUTE") return;
    state.booking.state = "DRIVER_ARRIVED";
    state.booking.otp = String(Math.floor(1000 + Math.random() * 9000));
    state.markerIndex = stops.findIndex((stop) => stop.id === state.request.pickup);
    const driver = getBookingDriver();
    driver.current = Math.max(driver.current, state.markerIndex / (stops.length - 1));
    addAudit("DRIVER_ARRIVED", `${driver.name} reached the approved pickup stop`, "driver");
    renderAll();
    showToast("Arrival recorded", "Pickup code is now visible to the passenger.");
  }

  function verifyOtp() {
    const input = el("otpInput");
    if (!state.booking || state.booking.state !== "DRIVER_ARRIVED") return;
    if (input.value.trim() !== state.booking.otp) {
      state.booking.attempts += 1;
      addAudit("OTP_REJECTED", `Incorrect pickup code; attempt ${state.booking.attempts}`, "driver");
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
    driver.current = 1;
    addAudit("DROP_PROPOSED", "Driver proposed the approved drop-off; payment remains disabled", "driver");
    renderAll();
    showToast("Drop-off proposed", "Passenger confirmation is needed to close this demo.");
  }

  function confirmDrop() {
    if (!state.booking || state.booking.state !== "DROP_PROPOSED") return;
    state.booking.state = "COMPLETED";
    addAudit("TRIP_COMPLETED", "Passenger confirmed demo drop; no payment intent created", "passenger");
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

  function searchRoutes(event) {
    event.preventDefault();
    if (state.booking) {
      showToast("An active demo ride is in progress", "Use Reset demo to create a different request.", "error");
      return;
    }
    state.request = {
      pickup: el("pickupSelect").value,
      drop: el("dropSelect").value,
      seats: Number(el("seatSelect").value),
      departure: el("departureSelect").value
    };
    state.declined = false;
    const matchCount = eligibleMatches().length;
    addAudit("MATCHER_EVALUATED", `Request checked; ${matchCount} eligible planned route${matchCount === 1 ? "" : "s"}`, "matcher");
    renderAll();
    showToast(matchCount ? `${matchCount} route match${matchCount === 1 ? "" : "es"} found` : "No compatible route", matchCount ? "Each result passed the forward-order and capacity checks." : "Try a later time or a different stop.", matchCount ? "success" : "error");
  }

  function replayRoute() {
    const marker = el("driverMarker");
    marker.style.transition = "left .5s ease, top .5s ease";
    let index = 0;
    const interval = setInterval(() => {
      marker.style.left = `${markerPoints[index].left}%`;
      marker.style.top = `${markerPoints[index].top}%`;
      index += 1;
      if (index === markerPoints.length) {
        clearInterval(interval);
        setTimeout(() => { marker.style.transition = "left 1.1s cubic-bezier(.22,.9,.35,1), top 1.1s cubic-bezier(.22,.9,.35,1)"; syncMap(); }, 600);
      }
    }, 430);
    showToast("Route replayed", "Simulated driver location is replaying along the planned corridor.");
  }

  function bindEvents() {
    el("rideSearchForm").addEventListener("submit", searchRoutes);
    document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => switchWorkspace(button.dataset.workspace)));
    document.addEventListener("click", (event) => {
      const selected = event.target.closest("[data-select-driver]");
      if (selected) { state.selectedDriverId = selected.dataset.selectDriver; renderAll(); return; }
      const reserve = event.target.closest("[data-reserve-driver]");
      if (reserve) { beginOffer(reserve.dataset.reserveDriver); return; }
      const workspace = event.target.closest("[data-workspace-go]");
      if (workspace) { switchWorkspace(workspace.dataset.workspaceGo); return; }
      if (event.target.closest("#acceptOffer")) { acceptOffer(); return; }
      if (event.target.closest("#declineOffer")) { declineOffer(); return; }
      if (event.target.closest("[data-reset-offer]")) { state.declined = false; renderAll(); return; }
      if (event.target.closest("[data-mark-arrived]")) { markArrived(); return; }
      if (event.target.closest("[data-verify-otp]")) { verifyOtp(); return; }
      if (event.target.closest("[data-propose-drop]")) { proposeDrop(); return; }
      if (event.target.closest("[data-confirm-drop]")) { confirmDrop(); return; }
      if (event.target.closest("#resetDemo")) { resetDemo(); }
    });
    el("replayRoute").addEventListener("click", replayRoute);
    el("helpButton").addEventListener("click", () => el("helpDialog").showModal());
    el("dialogClose").addEventListener("click", () => el("helpDialog").close());
    el("dialogDone").addEventListener("click", () => el("helpDialog").close());
    el("themeToggle").addEventListener("click", () => document.body.classList.toggle("high-contrast"));
    el("bannerClose").addEventListener("click", () => el("safetyBanner").remove());
    el("pickupSelect").addEventListener("change", () => { el("walkTime").textContent = `${stopById(el("pickupSelect").value).walk} min`; });
  }

  function runClock() {
    setInterval(() => {
      state.lastUpdateSeconds = state.lastUpdateSeconds >= 19 ? 4 : state.lastUpdateSeconds + 1;
      const last = el("lastUpdate");
      if (last) last.textContent = `${state.lastUpdateSeconds} sec ago`;
      if (!state.booking && !state.declined && state.offerSeconds > 0) {
        state.offerSeconds -= 1;
        const timer = el("offerTimer");
        if (timer) timer.textContent = timerText(state.offerSeconds);
      }
    }, 1000);
  }

  initialiseState();
  setOptions();
  bindEvents();
  renderAll();
  runClock();
})();
