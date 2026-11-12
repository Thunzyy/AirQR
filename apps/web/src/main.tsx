import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./i18n";
import App from "./App.tsx";
import {
  cleanupServiceWorkers,
  shouldDisableServiceWorkerForLocation,
} from "./utils/serviceWorker";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

if ('serviceWorker' in navigator) {
  const shouldDisableServiceWorker =
    import.meta.env.DEV || shouldDisableServiceWorkerForLocation(window.location);

  if (shouldDisableServiceWorker) {
    void cleanupServiceWorkers({
      cacheStorage: 'caches' in globalThis ? globalThis.caches : undefined,
      reloader: () => window.location.reload(),
      serviceWorker: navigator.serviceWorker,
      sessionStorage: window.sessionStorage,
    });
  } else if (import.meta.env.PROD) {
    window.addEventListener(
      'load',
      () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {
          // SW registration failed silently
        });
      },
      { once: true },
    );
  }
}
