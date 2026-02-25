/**
 * server/workers/klingElementsWorker.js
 *
 * Worker pro para:
 * - claim de kling_elements.status='creating'
 * - polling a Kling task status
 * - retries/backoff (poll_failures + next_check_at)
 * - cleanup automático (borrar preview_path + image_paths) si falla
 *
 * Requiere:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 * - SUPABASE_BUCKET
 * - KLING_ACCESS_KEY
 * - KLING_SECRET_KEY (recomendado)
 *
 * Opcionales:
 * - WORKER_ID
 * - KLING_ELEMENT_CREATE_URL / KLING_ELEMENT_CREATE_PATH / KLING_BASE_URL
 * - KLING_ELEMENT_TASK_STATUS_PATH
 * - ELEMENTS_CLAIM_LIMIT (default 10)
 * - ELEMENTS_LOOP_MS (default 4000)
 * - ELEMENTS_LOCK_MINUTES (default 10)
 */

import "dotenv/config";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { createStorageHelpers } from "../lib/storage.js";
import { klingGetWithRetry } from "../klingVideo.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
}
if (!SUPABASE_BUCKET) {
  throw new Error("Falta SUPABASE_BUCKET");
}

const WORKER_ID = process.env.WORKER_ID || `wrk_el_${crypto.randomUUID()}`;
const CLAIM_LIMIT = Math.max(1, Math.min(50, Number(process.env.ELEMENTS_CLAIM_LIMIT || 10)));
const LOOP_MS = Math.max(800, Number(process.env.ELEMENTS_LOOP_MS || 4000));
const LOCK_MINUTES = Math.max(2, Math.min(60, Number(process.env.ELEMENTS_LOCK_MINUTES || 10)));

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { deleteStoragePath } = createStorageHelpers({ supabase: supabaseAdmin, bucket: SUPABASE_BUCKET });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function resolveKlingCreateElementUrl() {
  const directRaw = (process.env.KLING_ELEMENT_CREATE_URL || "").toString().trim();

  if (directRaw) {
    if (/^https?:\/\//i.test(directRaw)) return directRaw.replace(/\/+$/g, "");
    if (/^api\.klingai\.com/i.test(directRaw)) return `https://${directRaw}`.replace(/\/+$/g, "");
    process.env.KLING_ELEMENT_CREATE_PATH = directRaw;
  }

  let baseUrl = (process.env.KLING_BASE_URL || "https://api.klingai.com")
    .toString()
    .trim()
    .replace(/\/+$/g, "");

  if (!/\/v1$/i.test(baseUrl)) baseUrl += "/v1";

  // ✅ Default a endpoint "advanced" (es el recomendado / actual para image_refer y requerido para video_refer)
  let pathRaw = (process.env.KLING_ELEMENT_CREATE_PATH || "/general/advanced-custom-elements")
    .toString()
    .trim()
    .replace(/\s+/g, "");

  if (/^https?:\/\//i.test(pathRaw)) return pathRaw.replace(/\/+$/g, "");
  if (!pathRaw.startsWith("/")) pathRaw = "/" + pathRaw;
  if (pathRaw.startsWith("/v1/")) pathRaw = pathRaw.slice(3);

  return `${baseUrl}${pathRaw}`.replace(/\/+$/g, "");
}

function resolveKlingCreateElementPath() {
  const url = resolveKlingCreateElementUrl();

  if (/^https?:\/\//i.test(url)) {
    const u = new URL(url);
    let p = (u.pathname || "").trim();
    if (!p.startsWith("/")) p = "/" + p;
    if (p.startsWith("/v1/")) p = p.slice(3);
    return p.replace(/\/+$/g, "") || "/general/advanced-custom-elements";
  }

  let p = String(url || "").trim();
  if (!p.startsWith("/")) p = "/" + p;
  if (p.startsWith("/v1/")) p = p.slice(3);
  return p.replace(/\/+$/g, "") || "/general/advanced-custom-elements";
}

function normalizeStatus(raw) {
  return String(raw || "").trim().toLowerCase();
}

function isSuccess(status) {
  const s = normalizeStatus(status);
  return s === "succeed" || s === "succeeded" || s === "success" || s === "completed" || s === "done" || s === "finished";
}

function isFailure(status) {
  const s = normalizeStatus(status);
  return s === "failed" || s === "fail" || s === "error" || s === "canceled" || s === "cancelled" || s === "timeout";
}

function resolveTaskStatusPaths({ createPath, taskId }) {
  const paths = [];

  const override = String(process.env.KLING_ELEMENT_TASK_STATUS_PATH || "").trim();
  if (override) {
    const tpl = override.includes("{taskId}")
      ? override
      : `${override.replace(/\/+$/g, "")}/{taskId}`;
    const out = tpl.replace("{taskId}", encodeURIComponent(String(taskId)));
    paths.push(out.startsWith("/") ? out : "/" + out);
  }

  const base = String(createPath || "/general/custom-elements").split("?")[0].replace(/\/+$/g, "");
  const safeTask = encodeURIComponent(String(taskId));

  // ✅ Prioriza endpoint documentado: /v1/general/advanced-custom-elements/{task_id}
  paths.push(`${base}/${safeTask}`);
  // Fallback no documentado
  paths.push(`${base}/tasks/${safeTask}`);

  paths.push(`/general/custom-elements/tasks/${safeTask}`);
  paths.push(`/general/custom-elements/${safeTask}`);
  paths.push(`/general/advanced-custom-elements/tasks/${safeTask}`);
  paths.push(`/general/advanced-custom-elements/${safeTask}`);

  return [...new Set(paths.map((p) => (p.startsWith("/v1/") ? p.slice(3) : p)).map((p) => p.replace(/\/+$/g, "")))];
}

function extractElementIdFromAny(obj) {
  const d = obj?.data || obj;

  const elementId =
    d?.element_id ||
    d?.elementId ||
    d?.id ||
    d?.element?.id ||
    d?.element?.element_id ||

    // ✅ Kling advanced: task_result.element_id
    d?.task_result?.element_id ||
    d?.task_result?.elementId ||
    d?.task_result?.id ||
    d?.taskResult?.element_id ||
    d?.taskResult?.elementId ||
    d?.taskResult?.id ||

    d?.result?.element_id ||
    d?.result?.elementId ||
    d?.result?.id;

  return elementId ? String(elementId) : null;
}

function extractTaskStatusFromAny(obj) {
  const d = obj?.data || obj;
  return d?.task_status || d?.taskStatus || d?.status || d?.task?.status || d?.result?.status || d?.state || "";
}

function extractTaskMsgFromAny(obj) {
  const d = obj?.data || obj;
  return d?.task_status_msg || d?.taskStatusMsg || d?.message || d?.msg || d?.error?.message || "";
}

// ✅ Fallback LIST: recuperar element_id buscando por task_id en el listado advanced
async function klingFindElementIdInAdvancedList({ createPath, taskId }) {
  const base = String(createPath || "/general/advanced-custom-elements")
    .split("?")[0]
    .replace(/\/+$/g, "")
    .replace(/\/tasks$/i, "");

  if (!/advanced-custom-elements/i.test(base)) return null;

  const targetTaskId = String(taskId);
  const pageSize = 100;

  for (let pageNum = 1; pageNum <= 3; pageNum++) {
    const path = `${base}?pageNum=${pageNum}&pageSize=${pageSize}`;

    try {
      const raw = await klingGetWithRetry(path, { timeoutMs: 20_000, retries: 2 });
      const list = raw?.data || raw;

      if (!Array.isArray(list)) continue;

      for (const entry of list) {
        const d = entry?.data || entry;
        const tid = d?.task_id || d?.taskId || d?.id;
        if (!tid) continue;

        if (String(tid) === targetTaskId) {
          const elementId = extractElementIdFromAny(entry);
          if (elementId) return { elementId: String(elementId), raw: entry, pathUsed: path };
          return null;
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function pollOnce({ createPath, taskId }) {
  const paths = resolveTaskStatusPaths({ createPath, taskId });

  let lastErr = null;
  let firstOk = null;

  for (const p of paths) {
    try {
      const raw = await klingGetWithRetry(p, { timeoutMs: 20_000, retries: 2 });
      const status = extractTaskStatusFromAny(raw);
      const msg = extractTaskMsgFromAny(raw);
      const elementId = extractElementIdFromAny(raw);

      const out = { ok: true, pathUsed: p, raw, status, msg, elementId };
      if (!firstOk) firstOk = out;

      // ✅ Igual que en server.js: si ya dice "succeed" pero no trae element_id,
      // seguimos probando otros endpoints (a menudo el endpoint documentado sí lo incluye).
      if (isSuccess(status) && !elementId) {
        continue;
      }

      return out;
    } catch (e) {
      lastErr = e;
      continue;
    }
  }

  if (firstOk) {
    if (isSuccess(firstOk.status) && !firstOk.elementId) {
      const found = await klingFindElementIdInAdvancedList({ createPath, taskId });
      if (found?.elementId) {
        return {
          ...firstOk,
          elementId: String(found.elementId),
          raw: found.raw || firstOk.raw,
          pathUsed: `${firstOk.pathUsed} -> ${found.pathUsed}`,
        };
      }
    }
    return firstOk;
  }

  return { ok: false, error: lastErr ? String(lastErr?.message || lastErr) : "unknown", pathsTried: paths };
}

async function deleteStoragePaths(paths) {
  const unique = [...new Set((paths || []).filter(Boolean))];
  if (!unique.length) return;

  await Promise.allSettled(unique.map((p) => deleteStoragePath(p)));
}

function computeNextCheckMsFromStatus(taskStatus) {
  const s = normalizeStatus(taskStatus);
  if (!s) return 12_000;
  if (s.includes("submitted")) return 10_000;
  if (s.includes("processing")) return 7_000;
  if (s.includes("running")) return 7_000;
  if (s.includes("queued")) return 12_000;
  return 12_000;
}

function computeBackoffMs(failures) {
  const f = Math.max(0, Math.min(12, Number(failures || 0)));
  const ms = 2000 * Math.pow(2, f); // 2s,4s,8s...
  return Math.min(ms, 5 * 60 * 1000); // cap 5 min
}

async function markFailedAndCleanup(row, reason) {
  const imagePaths = Array.isArray(row.image_paths) ? row.image_paths : [];
  const previewPath = row.preview_path ? [row.preview_path] : [];
  const allPaths = [...imagePaths, ...previewPath];

  await supabaseAdmin
    .from("kling_elements")
    .update({
      status: "failed",
      status_detail: String(reason || "failed"),
      next_check_at: null,
      locked_at: null,
      locked_by: null,
    })
    .eq("id", row.id);

  // Cleanup best-effort
  await deleteStoragePaths(allPaths);

  // Limpia paths para no acumular basura en Storage
  await supabaseAdmin
    .from("kling_elements")
    .update({
      image_paths: [],
      preview_path: null,
    })
    .eq("id", row.id);
}

async function processRow(row) {
  if (!row?.id) return;

  if (row.status !== "creating") {
    await supabaseAdmin
      .from("kling_elements")
      .update({ locked_at: null, locked_by: null })
      .eq("id", row.id);
    return;
  }

  const taskId = row.kling_task_id;
  if (!taskId) {
    await markFailedAndCleanup(row, "missing_kling_task_id");
    return;
  }

  const createPath = resolveKlingCreateElementPath();
  const polled = await pollOnce({ createPath, taskId });

  if (!polled.ok) {
    const failures = Number(row.poll_failures || 0) + 1;
    const backoffMs = computeBackoffMs(failures);

    await supabaseAdmin
      .from("kling_elements")
      .update({
        status_detail: `poll_error: ${polled.error || "unknown"}`,
        poll_failures: failures,
        next_check_at: new Date(Date.now() + backoffMs).toISOString(),
        locked_at: null,
        locked_by: null,
      })
      .eq("id", row.id);

    return;
  }

  const statusNorm = normalizeStatus(polled.status);

  // Reset failures cuando Kling responde OK
  const baseUpdate = {
    poll_failures: 0,
    locked_at: null,
    locked_by: null,
  };

  // Success
  if (isSuccess(statusNorm) && polled.elementId) {
    await supabaseAdmin
      .from("kling_elements")
      .update({
        ...baseUpdate,
        status: "ready",
        status_detail: null,
        kling_element_id: String(polled.elementId),
        kling_raw: polled.raw || null,
        next_check_at: null,
      })
      .eq("id", row.id);

    return;
  }

  // Failure
  if (isFailure(statusNorm)) {
    await markFailedAndCleanup(row, polled.msg || `task_failed:${statusNorm}`);
    return;
  }

  // Still running
  const nextMs = computeNextCheckMsFromStatus(statusNorm);
  await supabaseAdmin
    .from("kling_elements")
    .update({
      ...baseUpdate,
      status_detail: polled.msg || statusNorm || "running",
      kling_raw: polled.raw || null,
      next_check_at: new Date(Date.now() + nextMs).toISOString(),
    })
    .eq("id", row.id);
}

async function claimBatch() {
  const { data, error } = await supabaseAdmin.rpc("claim_kling_elements", {
    p_limit: CLAIM_LIMIT,
    p_worker_id: WORKER_ID,
    p_lock_minutes: LOCK_MINUTES,
  });

  if (error) {
    console.error("[kling-elements] claim error:", error.message || error);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

async function loop() {
  console.log(`[kling-elements] worker started id=${WORKER_ID} limit=${CLAIM_LIMIT} loop=${LOOP_MS}ms`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const rows = await claimBatch();

      if (rows.length) {
        for (const row of rows) {
          try {
            await processRow(row);
          } catch (e) {
            console.error("[kling-elements] process error:", e?.message || e);
            // backoff corto para no spinnear
            await supabaseAdmin
              .from("kling_elements")
              .update({
                status_detail: `worker_error: ${e?.message || String(e)}`,
                next_check_at: new Date(Date.now() + 30_000).toISOString(),
                locked_at: null,
                locked_by: null,
              })
              .eq("id", row.id);
          }
        }
      }
    } catch (e) {
      console.error("[kling-elements] loop error:", e?.message || e);
    }

    await sleep(LOOP_MS);
  }
}

loop();