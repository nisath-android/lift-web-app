(() => {
  "use strict";

  let deferredInstallPrompt = null;

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      await navigator.serviceWorker.register('./service-worker.js');
    } catch (error) {
      // The passenger experience remains usable online when a browser blocks workers.
      console.warn('PWA service worker registration failed', error);
    }
  }

  function wireInstallButton() {
    const button = document.getElementById('installApp');
    if (!button) return;

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      button.hidden = false;
    });

    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      button.hidden = true;
    });

    button.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      button.hidden = true;
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    registerServiceWorker();
    wireInstallButton();
  });
})();
