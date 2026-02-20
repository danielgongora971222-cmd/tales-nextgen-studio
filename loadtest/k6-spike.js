import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  stages: [
    { duration: "30s", target: 50 },
    { duration: "30s", target: 200 },
    { duration: "30s", target: 500 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.02"],
    http_req_duration: ["p(95)<800"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const INTERNAL_TOKEN = __ENV.INTERNAL_LOADTEST_TOKEN || "";

export default function () {
  const r = http.post(`${BASE_URL}/api/_internal/loadtest/ping`, null, {
    headers: { "x-internal-token": INTERNAL_TOKEN },
  });
  check(r, { "ping 200": (x) => x.status === 200 });

  sleep(0.1);
}