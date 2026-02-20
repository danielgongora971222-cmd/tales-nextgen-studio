import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: (process.env.APP_ENV || process.env.NODE_ENV || "development").toString(),
    serverName: (process.env.RENDER_INSTANCE_ID || process.env.HOSTNAME || "unknown").toString(),
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.05),
  });

  console.log("[Sentry] enabled");
} else {
  console.log("[Sentry] disabled (SENTRY_DSN not set)");
}