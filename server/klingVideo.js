import { createHmac } from "crypto";

const DEFAULT_KLING_BASE_URL = "https://api.klingai.com";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeKlingSound(sound) {
  if (sound === undefined || sound === null) return undefined;

  if (typeof sound === "string") {
    const s = sound.trim().toLowerCase();
    if (s === "on" || s === "off") return s;
    if (s === "true") return "on";
    if (s === "false") return "off";
  }

  if (typeof sound === "boolean") return sound ? "on" : "off";
  return undefined;
}

function coerceMotionControlModelName(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return null;

  if (
    v === "kling-v3" ||
    v === "kling-v3-0" ||
    v === "kling-v3.0" ||
    v === "kling-v3-motion-control" ||
    v === "kling-v3-motion-control-pro"
  ) {
    return "kling-v3";
  }

  if (
    v === "kling-v2-6" ||
    v === "kling-v2.6" ||
    v === "kling-2.6-motion-control" ||
    v === "kling-2.6-motion-control-pro"
  ) {
    return "kling-v2-6";
  }

  return null;
}

function normalizeKlingTaskStatus(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s.toLowerCase();
}

function isKlingSuccessStatus(status) {
  const s = normalizeKlingTaskStatus(status);
  return (
    s === "succeed" ||
    s === "succeeded" ||
    s === "success" ||
    s === "completed" ||
    s === "done" ||
    s === "finished"
  );
}

function isKlingFailureStatus(status) {
  const s = normalizeKlingTaskStatus(status);
  return (
    s === "failed" ||
    s === "fail" ||
    s === "error" ||
    s === "canceled" ||
    s === "cancelled" ||
    s === "timeout"
  );
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
  // Preferimos KLING_API_ORIGIN (tu consola Kling), y dejamos KLING_BASE_URL como fallback.
  let baseUrl = (process.env.KLING_API_ORIGIN || process.env.KLING_BASE_URL || DEFAULT_KLING_BASE_URL)
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

  // Kling API es /v1/...
  // - Si el baseUrl YA termina en /v1, no duplicamos.
  // - Si el baseUrl NO tiene /v1, lo agregamos al path.
  const base = resolveKlingBaseUrl();
  const baseHasV1 = /\/v1$/i.test(base);
  const pathHasV1 = pathValue.startsWith("/v1/");

  if (baseHasV1 && pathHasV1) pathValue = pathValue.slice(3);
  if (!baseHasV1 && !pathHasV1) pathValue = `/v1${pathValue}`;

  return `${base}${pathValue}`.replace(/\/+$/g, "");
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

async function klingPostForm(path, fields = {}) {
  if (typeof FormData === "undefined") {
    throw new Error(
      "KLING_FORMDATA_UNAVAILABLE: FormData no está disponible en este runtime de Node. Actualiza Node (>=18) o implementa FormData con undici."
    );
  }

  const form = new FormData();

  for (const [key, value] of Object.entries(fields || {})) {
    if (value === undefined || value === null) continue;

    // Kling suele esperar strings en form-data; booleans como "true"/"false".
    const v =
      typeof value === "boolean" ? (value ? "true" : "false") : String(value);

    form.append(key, v);
  }

  const { json } = await klingFetch(path, {
    method: "POST",
    body: form,
  });

  return json;
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

// ===============================
// ✅ HARDENING (solo si lo usas)
// Timeouts + retries
// ===============================
function isRetriableKlingError(err) {
  const status = Number(err?.status || 0);
  const code = err?.code != null ? Number(err.code) : null;

  // 1303 = parallel task over resource pack limit -> NO reintentar rápido
  if (status === 429 && code === 1303) return false;

  return (
    err?.name === "AbortError" ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

async function klingFetchWithTimeout(path, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await klingFetch(path, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function klingGetWithRetry(path, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs || 20000);
  const retries = Math.max(0, Math.min(5, Number(opts.retries || 2)));

  let attempt = 0;
  while (true) {
    try {
      const { json } = await klingFetchWithTimeout(path, { method: "GET" }, timeoutMs);
      return json;
    } catch (err) {
      if (!isRetriableKlingError(err) || attempt >= retries) throw err;
      const backoff = 800 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, backoff));
      attempt++;
    }
  }
}

export async function klingPostWithRetry(path, body, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs || 60000);
  const retries = Math.max(0, Math.min(5, Number(opts.retries || 2)));

  const payload = body ? JSON.stringify(body) : "{}";

  let attempt = 0;
  while (true) {
    try {
      const { json } = await klingFetchWithTimeout(
        path,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: payload },
        timeoutMs
      );
      return json;
    } catch (err) {
      if (!isRetriableKlingError(err) || attempt >= retries) throw err;
      const backoff = 800 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, backoff));
      attempt++;
    }
  }
}

export async function createText2VideoTask({
  model,
  prompt,
  duration,
  aspectRatio,
  sound,
  ...rest
}) {
  const soundValue = normalizeKlingSound(sound);

  const payload = {
    model_name: model,
    prompt,
    duration: duration !== undefined ? String(duration) : undefined,
    aspect_ratio: aspectRatio,
    ...(soundValue !== undefined ? { sound: soundValue } : {}),
    ...rest,
  };

  Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);

  // ✅ Timeout + retry para evitar requests colgadas “infinito”
  return klingPostWithRetry("/videos/text2video", payload, { timeoutMs: 60_000, retries: 2 });
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
  const soundValue = normalizeKlingSound(sound);

  const payload = {
    model_name: model,
    prompt,
    duration: duration !== undefined ? String(duration) : undefined,
    image,
    image_tail: imageTail,
    ...(soundValue !== undefined ? { sound: soundValue } : {}),
    ...rest,
  };

  Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);

  // ✅ Timeout + retry para evitar requests colgadas “infinito”
  return klingPostWithRetry("/videos/image2video", payload, { timeoutMs: 60_000, retries: 2 });
}

export async function createMotionControlTask({
  model,
  prompt,
  imageUrl,
  videoUrl,
  mode,
  keepOriginalSound,
  characterOrientation,
  externalTaskId,
  callbackUrl,
  watermarkInfo,
  ...rest
}) {
  const modelName = coerceMotionControlModelName(model);

  const payload = {
    ...(modelName ? { model_name: modelName } : {}),
    image_url: imageUrl,
    video_url: videoUrl,

    // Kling Motion Control espera "yes" / "no"
    keep_original_sound: keepOriginalSound ? "yes" : "no",

    // Requeridos por el endpoint motion-control
    character_orientation: characterOrientation,
    mode, // "std" | "pro"

    ...(prompt ? { prompt } : {}),
    ...(externalTaskId ? { external_task_id: externalTaskId } : {}),
    ...(callbackUrl ? { callback_url: callbackUrl } : {}),
    ...(watermarkInfo ? { watermark_info: watermarkInfo } : {}),
    ...rest,
  };

  Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);

  // Kling puede variar el path exacto; intentamos varios por robustez.
  const candidates = [
    "/videos/motion-control",
    "/videos/motion_create",
    "/videos/motion-create",
    "/videos/motioncontrol",
  ];

  let lastErr = null;
  for (const path of candidates) {
    try {
      return await klingPostWithRetry(path, payload, { timeoutMs: 60_000, retries: 2 });
    } catch (e) {
      lastErr = e;
      const status = e?.status || e?.response?.status || null;
      // si no es 404, no seguimos probando
      if (status && Number(status) !== 404) throw e;
    }
  }

  throw lastErr || new Error("Kling motion control: no se pudo crear el task (endpoint desconocido).");
}
export async function pollTaskUntilDone({
  type,
  taskId,
  modelName,
  maxWaitMs = 120000,
  intervalMs = 2000,
}) {
  const deadline = Date.now() + maxWaitMs;
  const endpoint = `/videos/${type}/${taskId}`;

  while (Date.now() < deadline) {
    const json = await klingGet(endpoint);
    const data = json?.data || json;

    const statusRaw =
      data?.task_status || data?.taskStatus || data?.status || json?.data?.task_status || json?.task_status;

    const status = normalizeKlingTaskStatus(statusRaw);

    if (isKlingSuccessStatus(status)) return data;

    if (isKlingFailureStatus(status)) {
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
