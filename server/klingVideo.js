import { createHmac } from "crypto";

const DEFAULT_KLING_BASE_URL = "https://api.klingai.com";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function base64urlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function makeKlingJwt(accessKey, secretKey, ttlSeconds = 300) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: accessKey,
    exp: now + ttlSeconds,
    nbf: now - 5,
  };

  const unsigned = `${base64urlEncode(JSON.stringify(header))}.${base64urlEncode(
    JSON.stringify(payload)
  )}`;

  const sig = createHmac("sha256", secretKey).update(unsigned).digest();
  return `${unsigned}.${base64urlEncode(sig)}`;
}

function resolveKlingBaseUrl() {
  let baseUrl = (process.env.KLING_BASE_URL || DEFAULT_KLING_BASE_URL)
    .toString()
    .trim()
    .replace(/\/+$/g, "");

  if (!/\/v1$/i.test(baseUrl)) baseUrl += "/v1";
  return baseUrl;
}

function resolveKlingUrl(path) {
  const trimmed = String(path || "").trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/+$/g, "");

  let pathValue = trimmed || "/";
  if (!pathValue.startsWith("/")) pathValue = `/${pathValue}`;
  if (pathValue.startsWith("/v1/")) pathValue = pathValue.slice(3);

  return `${resolveKlingBaseUrl()}${pathValue}`.replace(/\/+$/g, "");
}

function getKlingAuthToken() {
  const accessKey = process.env.KLING_ACCESS_KEY;
  const secretKey = process.env.KLING_SECRET_KEY;

  if (!accessKey) {
    throw new Error("KLING_NOT_CONFIGURED: faltan KLING_ACCESS_KEY en el backend.");
  }

  if (secretKey) return makeKlingJwt(accessKey, secretKey, 300);
  return accessKey;
}

function extractKlingErrorMessage(json, fallbackMessage) {
  return (
    json?.message ||
    json?.msg ||
    json?.error?.message ||
    json?.error ||
    fallbackMessage ||
    "Kling request failed."
  );
}

function throwKlingError({ status, json, text }) {
  const requestId = json?.request_id || json?.data?.request_id || json?.requestId;
  const code = json?.code;
  const message = extractKlingErrorMessage(json, text || `HTTP ${status}`);
  const err = new Error(
    `Kling error${code !== undefined ? ` (${code})` : ""}: ${message}${requestId ? ` (request_id: ${requestId})` : ""}`
  );
  err.code = code;
  err.requestId = requestId;
  err.status = status;
  throw err;
}

async function klingFetch(path, options = {}) {
  const url = resolveKlingUrl(path);
  const token = getKlingAuthToken();
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    ...(options.headers || {}),
  };

  const resp = await fetch(url, { ...options, headers });
  const text = await resp.text();

  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}

  if (!resp.ok || (json && json.code !== undefined && json.code !== 0)) {
    throwKlingError({ status: resp.status, json, text });
  }

  return { json, text };
}

export async function klingPost(path, body) {
  const payload = body ? JSON.stringify(body) : "{}";
  const { json } = await klingFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
  });
  return json;
}

export async function klingGet(path) {
  const { json } = await klingFetch(path, { method: "GET" });
  return json;
}

export async function createText2VideoTask({
  model,
  prompt,
  duration,
  aspectRatio,
  sound,
  ...rest
}) {
  const payload = {
    model_name: model,
    prompt,
    duration: duration !== undefined ? String(duration) : undefined,
    aspect_ratio: aspectRatio,
    ...(sound !== undefined ? { sound } : {}),
    ...rest,
  };

  Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);

  return klingPost("/videos/text2video", payload);
}

export async function createImage2VideoTask({
  model,
  prompt,
  duration,
  image,
  imageTail,
  sound,
  ...rest
}) {
  const payload = {
    model_name: model,
    prompt,
    duration: duration !== undefined ? String(duration) : undefined,
    image,
    image_tail: imageTail,
    ...(sound !== undefined ? { sound } : {}),
    ...rest,
  };

  Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);

  return klingPost("/videos/image2video", payload);
}

export async function pollTaskUntilDone({
  type,
  taskId,
  maxWaitMs = 120000,
  intervalMs = 2000,
}) {
  const deadline = Date.now() + maxWaitMs;
  const endpoint = `/videos/${type}/${taskId}`;

  while (Date.now() < deadline) {
    const json = await klingGet(endpoint);
    const data = json?.data || json;
    const status = data?.task_status;

    if (status === "succeed" || status === "success") return data;

    if (status === "failed") {
      const reason = data?.task_status_msg || "Kling task failed.";
      const err = new Error(`Kling task failed: ${reason}`);
      err.taskId = taskId;
      err.status = status;
      throw err;
    }

    await sleep(intervalMs);
  }

  const timeoutErr = new Error("Kling task timed out.");
  timeoutErr.taskId = taskId;
  throw timeoutErr;
}
