import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App";

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

const apiBase = import.meta.env.VITE_API_BASE_URL as string | undefined;

const traceTargets: Array<string | RegExp> = ["localhost", /^\//];
if (apiBase && apiBase.trim()) {
  try {
    const u = new URL(apiBase.trim());
    traceTargets.push(u.origin);
  } catch {
    // Si VITE_API_BASE_URL no es una URL válida, no añadimos nada.
  }
}

if (dsn) {
  Sentry.init({
    dsn,
    environment: (import.meta.env.VITE_APP_ENV as string) || "development",
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || 0.05),

    // En Sentry v8, tracePropagationTargets se configura a nivel de Sentry.init (no en la integración).
    tracePropagationTargets: traceTargets,

    integrations: [Sentry.browserTracingIntegration()],
  });
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<div>Ocurrió un error inesperado.</div>}>
      <App />
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);