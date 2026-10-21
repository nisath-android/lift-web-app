(() => {
  "use strict";
  const config = window.LIFT_CONFIG;
  const client = config?.supabaseUrl && config?.supabasePublishableKey && window.supabase
    ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey) : null;
  let session = null;
  const listeners = new Set();
  const idempotencyKey = (action) => `${action}:${crypto.randomUUID()}`;
  const notify = () => listeners.forEach((listener) => listener(session));
  function setStatus() {
    const status = document.getElementById("backendStatus"); const button = document.getElementById("authButton");
    if (!status || !button) return;
    if (!client) { status.textContent = "Backend config unavailable"; button.textContent = "Backend unavailable"; button.disabled = true; return; }
    if (session?.user) { status.textContent = `Live backend · ${session.user.email || "pilot user"}`; button.textContent = "Sign out"; }
    else { status.textContent = "Live backend · sign in required"; button.textContent = "Sign in"; }
  }
  async function invoke(action, payload = {}, withIdempotency = true) {
    if (!client || !session?.access_token) throw new Error("SIGN_IN_REQUIRED");
    const body = { action, payload }; if (withIdempotency) body.idempotencyKey = idempotencyKey(action);
    const { data, error } = await client.functions.invoke("lift-api", { body });
    if (error) throw new Error(error.message || "API_REQUEST_FAILED");
    if (data?.error?.code) throw new Error(data.error.code);
    return data?.data;
  }
  async function publishPilotRoute() {
    const route = await invoke("create-route", { departureAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(), seatCapacity: 2 });
    for (const [index, placeId] of Object.values(config.pilotPlaces).entries()) {
      await invoke("add-route-stop", { routeId: route.routeId, placeId, plannedEta: new Date(Date.now() + (20 + index * 8) * 60 * 1000).toISOString(), cumulativeM: index * 1300 });
    }
    return invoke("publish-route", { routeId: route.routeId });
  }
  async function initialise() {
    if (!client) { setStatus(); return; }
    const { data } = await client.auth.getSession(); session = data.session; setStatus();
    client.auth.onAuthStateChange((_event, nextSession) => { session = nextSession; setStatus(); notify(); });
  }
  function openDialog() { const dialog = document.getElementById("authDialog"); if (session) { client.auth.signOut(); return; } dialog?.showModal(); }
  async function submitAuth(event) {
    event.preventDefault(); const form = event.currentTarget; const feedback = document.getElementById("authFeedback");
    const name = form.elements.fullName.value.trim(); const email = form.elements.email.value.trim(); const password = form.elements.password.value;
    const intent = event.submitter?.value || "sign-in"; feedback.textContent = "Working…";
    try {
      const response = intent === "sign-up" ? await client.auth.signUp({ email, password, options: { data: { full_name: name || undefined } } }) : await client.auth.signInWithPassword({ email, password });
      if (response.error) throw response.error;
      feedback.textContent = intent === "sign-up" ? "Account created. Check email if confirmation is enabled, then sign in." : "Signed in.";
      if (intent === "sign-in") document.getElementById("authDialog").close();
    } catch (error) { feedback.textContent = error.message || "Authentication failed."; }
  }
  window.LiftLive = Object.freeze({ get ready() { return Boolean(client); }, get session() { return session; }, invoke, publishPilotRoute, onAuthChange(listener) { listeners.add(listener); return () => listeners.delete(listener); } });
  document.addEventListener("DOMContentLoaded", () => { document.getElementById("authButton")?.addEventListener("click", openDialog); document.getElementById("authForm")?.addEventListener("submit", submitAuth); initialise(); });
})();
