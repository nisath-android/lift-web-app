(() => {
  "use strict";

  const config = window.LIFT_CONFIG;
  const client = config?.supabaseUrl && config?.supabasePublishableKey && window.supabase
    ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey)
    : null;
  const listeners = new Set();
  let session = null;
  let authFlow = "sign-in";
  let pendingEmail = "";

  const idempotencyKey = (action) => `${action}:${crypto.randomUUID()}`;
  const el = (id) => document.getElementById(id);
  const notify = () => listeners.forEach((listener) => listener(session));

  function normalisePhone(value) {
    const compact = value.trim().replace(/[\s()-]/g, "");
    if (/^\d{10}$/.test(compact)) return `+91${compact}`;
    return compact;
  }

  function authError(error) {
    const code = error?.message || error?.code || "";
    const messages = {
      INVALID_LOGIN: "Phone number or password is not correct.",
      PHONE_ALREADY_IN_USE: "This phone number is already used by another account.",
      EMAIL_VERIFICATION_REQUIRED: "Verify your email code before creating the account.",
      INVALID_LOGIN_INPUT: "Enter a valid phone number and a 10-character password.",
      INVALID_REGISTRATION_INPUT: "Enter your name, phone number, and a 10-character password.",
    };
    return messages[code] || error?.message || "Authentication could not be completed.";
  }

  function setFeedback(message = "", isError = false) {
    const feedback = el("authFeedback");
    if (!feedback) return;
    feedback.textContent = message;
    feedback.classList.toggle("error", isError);
  }

  function setStatus() {
    const status = el("backendStatus"); const button = el("authButton");
    if (!status || !button) return;
    if (!client) {
      status.textContent = "Backend config unavailable";
      button.textContent = "Backend unavailable";
      button.disabled = true;
      return;
    }
    if (session?.user) {
      status.textContent = `Live backend · ${session.user.email || "pilot user"}`;
      button.textContent = "Sign out";
    } else {
      status.textContent = "Live backend · sign in required";
      button.textContent = "Sign in";
    }
  }

  function showPanel(panelId) {
    ["authSignInPanel", "authEmailPanel", "authCodePanel", "authSetupPanel", "authResetPanel"].forEach((id) => {
      el(id).hidden = id !== panelId;
    });
    el("authTitle").textContent = {
      authSignInPanel: "Sign in",
      authEmailPanel: authFlow === "reset" ? "Reset password" : "Verify your email",
      authCodePanel: "Enter email code",
      authSetupPanel: "Finish your account",
      authResetPanel: "Set new password",
    }[panelId];
    setFeedback();
  }

  function showSignIn() {
    authFlow = "sign-in";
    pendingEmail = "";
    showPanel("authSignInPanel");
  }

  function showEmailFlow(flow) {
    authFlow = flow;
    pendingEmail = "";
    el("authEmailHint").textContent = flow === "reset"
      ? "We will send a six-digit code to your verified recovery email."
      : "We will send a six-digit code to verify your email before account setup.";
    showPanel("authEmailPanel");
  }

  async function invoke(action, payload = {}, withIdempotency = true) {
    if (!client || !session?.access_token) throw new Error("SIGN_IN_REQUIRED");
    const body = { action, payload };
    if (withIdempotency) body.idempotencyKey = idempotencyKey(action);
    const { data, error } = await client.functions.invoke("lift-api", { body });
    if (error) throw new Error(error.message || "API_REQUEST_FAILED");
    if (data?.error?.code) throw new Error(data.error.code);
    return data?.data;
  }

  async function invokeAuthGateway(body) {
    const { data, error } = await client.functions.invoke("auth-gateway", { body });
    if (error) throw new Error(error.message || "AUTH_GATEWAY_FAILED");
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
    const { data } = await client.auth.getSession();
    session = data.session;
    setStatus();
    client.auth.onAuthStateChange((_event, nextSession) => {
      session = nextSession;
      setStatus();
      notify();
    });
  }

  function openDialog() {
    if (session) { client.auth.signOut(); return; }
    showSignIn();
    el("authDialog")?.showModal();
  }

  async function signInWithPhone(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const phone = normalisePhone(form.elements.phone.value);
    const password = form.elements.password.value;
    setFeedback("Signing in…");
    try {
      const data = await invokeAuthGateway({ action: "password-sign-in", phone, password });
      const response = await client.auth.setSession({
        access_token: data.session.accessToken,
        refresh_token: data.session.refreshToken,
      });
      if (response.error) throw response.error;
      el("authDialog").close();
    } catch (error) {
      setFeedback(authError(error), true);
    }
  }

  async function sendEmailCode(event) {
    event.preventDefault();
    const email = event.currentTarget.elements.email.value.trim();
    setFeedback("Sending email code…");
    try {
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: authFlow === "sign-up" },
      });
      if (error) throw error;
      pendingEmail = email;
      el("authCodeHint").textContent = `Enter the six-digit code sent to ${email}.`;
      showPanel("authCodePanel");
      setFeedback("Email code sent. Check inbox and spam folder.");
    } catch (error) {
      setFeedback(authError(error), true);
    }
  }

  async function verifyEmailCode(event) {
    event.preventDefault();
    const otp = event.currentTarget.elements.otp.value.trim();
    setFeedback("Verifying email code…");
    try {
      const { error } = await client.auth.verifyOtp({ email: pendingEmail, token: otp, type: "email" });
      if (error) throw error;
      showPanel(authFlow === "reset" ? "authResetPanel" : "authSetupPanel");
      setFeedback(authFlow === "reset" ? "Email verified. Choose a new password." : "Email verified. Add your login details.");
    } catch (error) {
      setFeedback(authError(error), true);
    }
  }

  async function finishRegistration(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = {
      action: "complete-registration",
      displayName: form.elements.fullName.value.trim(),
      phone: normalisePhone(form.elements.phone.value),
      password: form.elements.password.value,
    };
    setFeedback("Saving your account…");
    try {
      await invokeAuthGateway(payload);
      setFeedback("Account ready. Your phone number and password can now be used to sign in.");
      setTimeout(() => el("authDialog")?.close(), 900);
    } catch (error) {
      setFeedback(authError(error), true);
    }
  }

  async function finishReset(event) {
    event.preventDefault();
    const password = event.currentTarget.elements.password.value;
    setFeedback("Saving new password…");
    try {
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      await client.auth.signOut();
      showSignIn();
      setFeedback("Password updated. Sign in with your phone number and new password.");
    } catch (error) {
      setFeedback(authError(error), true);
    }
  }

  window.LiftLive = Object.freeze({
    get ready() { return Boolean(client); },
    get session() { return session; },
    invoke,
    publishPilotRoute,
    onAuthChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  });

  document.addEventListener("DOMContentLoaded", () => {
    el("authButton")?.addEventListener("click", openDialog);
    el("authSignInForm")?.addEventListener("submit", signInWithPhone);
    el("authEmailForm")?.addEventListener("submit", sendEmailCode);
    el("authCodeForm")?.addEventListener("submit", verifyEmailCode);
    el("authSetupForm")?.addEventListener("submit", finishRegistration);
    el("authResetForm")?.addEventListener("submit", finishReset);
    el("showSignUp")?.addEventListener("click", () => showEmailFlow("sign-up"));
    el("showReset")?.addEventListener("click", () => showEmailFlow("reset"));
    document.querySelectorAll(".authBack").forEach((button) => button.addEventListener("click", showSignIn));
    initialise();
  });
})();
