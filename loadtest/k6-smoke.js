import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: 10,
  duration: "30s",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const INTERNAL_TOKEN = __ENV.INTERNAL_LOADTEST_TOKEN || "";

export default function () {
  const h = http.get(`${BASE_URL}/api/health`);
  check(h, { "health 200": (r) => r.status === 200 });

  // Si habilitas el endpoint interno, úsalo para carga “real” sin IA
  if (INTERNAL_TOKEN) {
    const r = http.post(`${BASE_URL}/api/_internal/loadtest/ping`, null, {
      headers: { "x-internal-token": INTERNAL_TOKEN },
    });
    check(r, { "ping 200": (x) => x.status === 200 });
  }

  sleep(0.2);
}