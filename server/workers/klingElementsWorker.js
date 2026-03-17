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

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readExactString(value) {
  if (value == null) return null;
  const out = String(value).trim();
  return out ? out : null;
}

function collectExplicitNamedValues(value, keyNames, out = [], depth = 0) {
  if (value == null || depth > 8) return out;

  if (Array.isArray(value)) {
    for (const item of value) collectExplicitNamedValues(item, keyNames, out, depth + 1);
    return out;
  }

  if (!isPlainObject(value)) return out;

  for (const key of keyNames) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      const candidate = readExactString(value[key]);
      if (candidate && !out.includes(candidate)) out.push(candidate);
    }
  }

  for (const nested of Object.values(value)) {
    if (Array.isArray(nested) || isPlainObject(nested)) {
      collectExplicitNamedValues(nested, keyNames, out, depth + 1);
    }
  }

  return out;
}

function extractExplicitElementIdFromAny(obj) {
  const d = obj?.data || obj;
  const values = collectExplicitNamedValues(d, ["element_id", "elementId"]);
  return values.length ? values[0] : null;
}

function extractExplicitTaskIdFromAny(obj) {
  const d = obj?.data || obj;
  const values = collectExplicitNamedValues(d, ["task_id", "taskId"]);
  return values.length ? values[0] : null;
}

function extractAdvancedCreateTaskIdFromAny(obj) {
  return (
    readExactString(obj?.data?.task_id) ||
    readExactString(obj?.data?.taskId) ||
    readExactString(obj?.task_id) ||
    readExactString(obj?.taskId) ||
    null
  );
}

function extractAdvancedElementIdFromTaskEnvelope(obj) {
  const roots = [];
  if (isPlainObject(obj?.data)) roots.push(obj.data);
  if (isPlainObject(obj)) roots.push(obj);

  for (const root of roots) {
    const taskResult = isPlainObject(root?.task_result)
      ? root.task_result
      : isPlainObject(root?.taskResult)
        ? root.taskResult
        : null;

    if (!taskResult) continue;

    const elements = Array.isArray(taskResult?.elements)
      ? taskResult.elements
      : Array.isArray(taskResult?.Elements)
        ? taskResult.Elements
        : null;

    if (!Array.isArray(elements)) continue;

    for (const element of elements) {
      const explicit =
        readExactString(element?.element_id) ||
        readExactString(element?.elementId) ||
        readExactString(element?.element?.element_id) ||
        readExactString(element?.element?.elementId) ||
        readExactString(element?.element_info?.element_id) ||
        readExactString(element?.elementInfo?.elementId);

      if (explicit) return explicit;
    }
  }

  return null;
}

function extractVerifiedElementInfoFromRaw(raw, opts = {}) {
  const env = getKlingRawEnvelope(raw);
  const strictAdvanced = opts?.strictAdvanced !== false;
  const verified = readExactString(env?.verification?.elementId ?? env?.verification?.element_id);
  if (verified) return { elementId: verified, source: "verification" };

  const advancedCandidates = [
    ["last_poll_response", env?.last_poll_response],
    ["list_response", env?.list_response],
    ["legacy_response", env?.legacy_response],
    ["raw", env?.raw],
  ];

  for (const [source, candidate] of advancedCandidates) {
    if (!candidate) continue;
    const elementId = extractAdvancedElementIdFromTaskEnvelope(candidate);
    if (elementId) return { elementId: String(elementId), source };
  }

  if (!strictAdvanced) {
    const legacyCandidates = [
      ["create_response", env?.create_response],
      ["last_poll_response", env?.last_poll_response],
      ["list_response", env?.list_response],
      ["legacy_response", env?.legacy_response],
      ["raw", env?.raw],
    ];

    for (const [source, candidate] of legacyCandidates) {
      if (!candidate) continue;
      const elementId = extractExplicitElementIdFromAny(candidate);
      if (elementId) return { elementId: String(elementId), source };
    }
  }

  return { elementId: null, source: null };
}

function isKlingRawEnvelope(raw) {
  return (
    isPlainObject(raw) &&
    ["create_response", "last_poll_response", "list_response", "requested", "verification", "legacy_response", "diagnostics"].some(
      (key) => Object.prototype.hasOwnProperty.call(raw, key)
    )
  );
}

function getKlingRawEnvelope(raw) {
  if (isKlingRawEnvelope(raw)) return raw;
  if (raw == null) return {};
  return { legacy_response: raw };
}

function rawResponseCandidates(raw) {
  if (!raw) return [];
  const env = getKlingRawEnvelope(raw);
  const verified = readExactString(env?.verification?.elementId ?? env?.verification?.element_id);
  return [
    verified ? { element_id: verified } : null,
    env?.last_poll_response,
    env?.list_response,
    env?.create_response,
    env?.legacy_response,
    env?.raw,
  ].filter(Boolean);
}

function buildKlingEnvSnapshot() {
  const accessKey = String(process.env.KLING_ACCESS_KEY || "").trim();
  const secretKey = String(process.env.KLING_SECRET_KEY || "").trim();
  const baseUrl = String(process.env.KLING_API_ORIGIN || process.env.KLING_BASE_URL || "https://api.klingai.com").trim().replace(/\/+$/g, "");
  const createPath = resolveKlingCreateElementPath();
  const taskStatusPath = String(process.env.KLING_ELEMENT_TASK_STATUS_PATH || "").trim() || null;
  const fingerprint = crypto
    .createHash("sha256")
    .update([accessKey, secretKey, baseUrl, createPath, taskStatusPath || ""].join("|"))
    .digest("hex")
    .slice(0, 12);

  return {
    fingerprint,
    accessKeyHint: accessKey ? `${accessKey.slice(0, 4)}…${accessKey.slice(-4)}` : null,
    baseUrl,
    createPath,
    taskStatusPath,
  };
}

function envSnapshotsMismatch(a, b) {
  const fa = readExactString(a?.fingerprint);
  const fb = readExactString(b?.fingerprint);
  return Boolean(fa && fb && fa !== fb);
}

function buildKlingRawEnvelope({
  existing,
  requested,
  createResponse,
  createPath,
  createMode,
  createTaskId,
  createElementId,
  lastPollResponse,
  lastPollPath,
  listResponse,
  verification,
  diagnostics,
}) {
  const env = { ...getKlingRawEnvelope(existing) };

  if (requested !== undefined) env.requested = requested;
  if (createResponse !== undefined) env.create_response = createResponse;
  if (createPath !== undefined) env.create_path = createPath;
  if (createMode !== undefined) env.create_mode = createMode;
  if (createTaskId !== undefined) env.create_task_id = createTaskId;
  if (createElementId !== undefined) env.create_element_id = createElementId;
  if (lastPollResponse !== undefined) env.last_poll_response = lastPollResponse;
  if (lastPollPath !== undefined) env.last_poll_path = lastPollPath;
  if (listResponse !== undefined) env.list_response = listResponse;
  if (verification !== undefined) env.verification = verification;
  if (diagnostics !== undefined) {
    env.diagnostics = {
      ...(isPlainObject(env.diagnostics) ? env.diagnostics : {}),
      ...(isPlainObject(diagnostics) ? diagnostics : {}),
    };
  }

  return env;
}

function buildKlingCorruptedDetail(issue, details = {}) {
  const baseByIssue = {
    missing_task_id: "corrupted: missing kling_task_id for advanced element.",
    missing_remote_id: "corrupted: missing kling_element_id.",
    remote_id_matches_task_id: "corrupted: kling_element_id matches kling_task_id.",
    missing_verified_evidence: "corrupted: no explicit element_id evidence found in kling_raw.",
    verified_evidence_mismatch: "corrupted: stored kling_element_id does not match verified element_id from Kling.",
  };

  let detail = baseByIssue[issue] || `corrupted: ${issue || "invalid_remote_id"}`;
  if (details.envMismatch) {
    detail += ` env_mismatch:create=${details.createFingerprint || "?"}, current=${details.currentFingerprint || "?"}`;
  }
  return detail;
}

function assessKlingElementRecord(row) {
  const statusDb = String(row?.status || "ready").trim().toLowerCase() || "ready";
  const storedRemoteId = readExactString(row?.kling_element_id);
  const taskId = readExactString(row?.kling_task_id);
  const apiVersion = String(row?.api_version || "").trim().toLowerCase();
  const referenceType = String(row?.reference_type || "").trim().toLowerCase();
  const isAdvanced = /advanced/.test(apiVersion) || referenceType === "video_refer" || Boolean(taskId);
  const verifiedInfo = extractVerifiedElementInfoFromRaw(row?.kling_raw, { strictAdvanced: isAdvanced });
  const envSnapshotStored = row?.kling_raw?.requested?.envSnapshot || row?.kling_raw?.envSnapshot || null;
  const envSnapshotCurrent = buildKlingEnvSnapshot();
  const envMismatch = envSnapshotsMismatch(envSnapshotStored, envSnapshotCurrent);

  let issue = null;
  if (statusDb === "ready") {
    if (!storedRemoteId) issue = "missing_remote_id";
    else if (isAdvanced && !taskId) issue = "missing_task_id";
    else if (isAdvanced && storedRemoteId === taskId) issue = "remote_id_matches_task_id";
    else if (isAdvanced && !verifiedInfo.elementId) issue = "missing_verified_evidence";
    else if (isAdvanced && verifiedInfo.elementId !== storedRemoteId) issue = "verified_evidence_mismatch";
  }

  let statusForClient = statusDb;
  if (issue && statusDb === "ready") statusForClient = "corrupted";

  let detail = readExactString(row?.status_detail);
  if (issue && statusDb === "ready") {
    detail = buildKlingCorruptedDetail(issue, {
      envMismatch,
      createFingerprint: envSnapshotStored?.fingerprint,
      currentFingerprint: envSnapshotCurrent?.fingerprint,
    });
  } else if (envMismatch) {
    const mismatchDetail = `env_mismatch:create=${envSnapshotStored?.fingerprint || "?"}, current=${envSnapshotCurrent?.fingerprint || "?"}`;
    detail = detail ? `${detail} | ${mismatchDetail}` : mismatchDetail;
  }

  return {
    statusDb,
    statusForClient,
    storedRemoteId,
    taskId,
    isAdvanced,
    verifiedElementId: verifiedInfo.elementId,
    verificationSource: verifiedInfo.source,
    issue,
    isVerified: !issue && statusDb === "ready" && Boolean(storedRemoteId),
    detail,
    repairable: isAdvanced && Boolean(taskId),
    envMismatch,
    envSnapshotStored,
    envSnapshotCurrent,
  };
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

  // Doc: pageSize permite hasta 500 → usamos 500 por defecto para minimizar páginas.
  const pageSize = Math.max(1, Math.min(500, Number(process.env.KLING_ELEMENT_LIST_PAGE_SIZE || 500)));
  const maxPages = Math.max(1, Math.min(30, Number(process.env.KLING_ELEMENT_LIST_MAX_PAGES || 10)));

  function normalizeList(raw) {
    const v = raw?.data ?? raw;

    if (Array.isArray(v)) return v;
    if (Array.isArray(v?.data)) return v.data;
    if (Array.isArray(v?.list)) return v.list;
    if (Array.isArray(v?.items)) return v.items;
    if (Array.isArray(v?.records)) return v.records;
    if (Array.isArray(v?.result)) return v.result;

    return null;
  }

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const path = `${base}?pageNum=${pageNum}&pageSize=${pageSize}`;

    try {
      const raw = await klingGetWithRetry(path, { timeoutMs: 20_000, retries: 2 });
      const list = normalizeList(raw);

      if (!Array.isArray(list)) continue;

      for (const entry of list) {
        const d = entry?.data || entry;

        // En la doc es task_id; evitamos usar d.id como fallback para no confundir con element_id
        const tid = d?.task_id || d?.taskId;
        if (!tid) continue;

        if (String(tid) === targetTaskId) {
          const elementId = extractAdvancedElementIdFromTaskEnvelope(entry);
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
      const elementId = /advanced-custom-elements/i.test(String(createPath || ""))
        ? extractAdvancedElementIdFromTaskEnvelope(raw)
        : extractExplicitElementIdFromAny(raw);

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
      let found = await klingFindElementIdInAdvancedList({ createPath, taskId });

      if (!found?.elementId) {
        await new Promise((r) => setTimeout(r, 1500));
        found = await klingFindElementIdInAdvancedList({ createPath, taskId });
      }

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

async function markFailedAndCleanup(row, reason, extra = {}) {
  await supabaseAdmin
    .from("kling_elements")
    .update({
      status: "failed",
      status_detail: String(reason || "failed"),
      kling_raw: extra.klingRaw !== undefined ? extra.klingRaw : row?.kling_raw || null,
      next_check_at: null,
      locked_at: null,
      locked_by: null,
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

  const assessment = assessKlingElementRecord(row);
  const nowIso = new Date().toISOString();

  if (!assessment.taskId) {
    const failedRaw = buildKlingRawEnvelope({
      existing: row.kling_raw,
      diagnostics: {
        workerMarkedFailedAt: nowIso,
        workerId: WORKER_ID,
        envMismatch: assessment.envMismatch,
        envSnapshotCurrent: assessment.envSnapshotCurrent,
      },
    });
    await markFailedAndCleanup(
      row,
      buildKlingCorruptedDetail("missing_task_id", {
        envMismatch: assessment.envMismatch,
        createFingerprint: assessment.envSnapshotStored?.fingerprint,
        currentFingerprint: assessment.envSnapshotCurrent?.fingerprint,
      }),
      { klingRaw: failedRaw }
    );
    return;
  }

  if (assessment.envMismatch) {
    console.warn(
      "[kling-elements:env-mismatch]",
      JSON.stringify({
        scope: "worker",
        localId: row.id,
        taskId: assessment.taskId,
        createFingerprint: assessment.envSnapshotStored?.fingerprint || null,
        currentFingerprint: assessment.envSnapshotCurrent?.fingerprint || null,
        createPathStored: row?.kling_raw?.create_path || null,
        createPathCurrent: assessment.envSnapshotCurrent?.createPath || null,
      })
    );
  }

  const createPath = resolveKlingCreateElementPath();
  const polled = await pollOnce({ createPath, taskId: assessment.taskId });

  if (!polled.ok) {
    const failures = Number(row.poll_failures || 0) + 1;
    const backoffMs = computeBackoffMs(failures);
    const pendingRaw = buildKlingRawEnvelope({
      existing: row.kling_raw,
      diagnostics: {
        lastPollErrorAt: nowIso,
        lastPollError: polled.error || "unknown",
        lastPollPathsTried: Array.isArray(polled.pathsTried) ? polled.pathsTried : undefined,
        workerId: WORKER_ID,
        envMismatch: assessment.envMismatch,
        envSnapshotCurrent: assessment.envSnapshotCurrent,
      },
    });

    await supabaseAdmin
      .from("kling_elements")
      .update({
        status_detail: `poll_error: ${polled.error || "unknown"}`,
        kling_raw: pendingRaw,
        poll_failures: failures,
        next_check_at: new Date(Date.now() + backoffMs).toISOString(),
        locked_at: null,
        locked_by: null,
      })
      .eq("id", row.id);

    return;
  }

  const statusNorm = normalizeStatus(polled.status);
  const baseUpdate = {
    poll_failures: 0,
    locked_at: null,
    locked_by: null,
  };
  const diagnostics = {
    lastPolledAt: nowIso,
    lastPollStatus: statusNorm || null,
    workerId: WORKER_ID,
    envMismatch: assessment.envMismatch,
    envSnapshotCurrent: assessment.envSnapshotCurrent,
  };

  console.info(
    "[kling-elements:poll]",
    JSON.stringify({
      scope: "worker",
      localId: row.id,
      taskId: assessment.taskId,
      pathUsed: polled.pathUsed || null,
      status: statusNorm || null,
      elementId: polled.elementId ? String(polled.elementId) : null,
    })
  );

  if (isSuccess(statusNorm) && polled.elementId) {
    const readyDetail = assessment.envMismatch
      ? `verified_remote_id | env_mismatch:create=${assessment.envSnapshotStored?.fingerprint || "?"}, current=${assessment.envSnapshotCurrent?.fingerprint || "?"}`
      : null;
    const readyRaw = buildKlingRawEnvelope({
      existing: row.kling_raw,
      lastPollResponse: polled.raw || null,
      lastPollPath: polled.pathUsed || null,
      verification: {
        elementId: String(polled.elementId),
        source: polled.pathUsed && String(polled.pathUsed).includes("pageNum=") ? "list_response" : "task_status",
        verifiedAt: nowIso,
        taskId: assessment.taskId,
        envSnapshot: assessment.envSnapshotCurrent,
      },
      diagnostics,
    });

    await supabaseAdmin
      .from("kling_elements")
      .update({
        ...baseUpdate,
        status: "ready",
        status_detail: readyDetail,
        kling_element_id: String(polled.elementId),
        kling_raw: readyRaw,
        next_check_at: null,
      })
      .eq("id", row.id);

    return;
  }

  if (isFailure(statusNorm)) {
    const failedRaw = buildKlingRawEnvelope({
      existing: row.kling_raw,
      lastPollResponse: polled.raw || null,
      lastPollPath: polled.pathUsed || null,
      diagnostics,
    });
    await markFailedAndCleanup(row, polled.msg || `task_failed:${statusNorm}`, { klingRaw: failedRaw });
    return;
  }

  const nextMs = computeNextCheckMsFromStatus(statusNorm);
  const detailBase =
    polled.msg ||
    (isSuccess(statusNorm) && !polled.elementId
      ? "awaiting verified element_id"
      : (statusNorm || "running"));
  const detail = assessment.envMismatch
    ? `${detailBase} | env_mismatch:create=${assessment.envSnapshotStored?.fingerprint || "?"}, current=${assessment.envSnapshotCurrent?.fingerprint || "?"}`
    : detailBase;
  const pendingRaw = buildKlingRawEnvelope({
    existing: row.kling_raw,
    lastPollResponse: polled.raw || null,
    lastPollPath: polled.pathUsed || null,
    diagnostics,
  });

  await supabaseAdmin
    .from("kling_elements")
    .update({
      ...baseUpdate,
      status: "creating",
      status_detail: detail,
      kling_raw: pendingRaw,
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
  const envSnapshot = buildKlingEnvSnapshot();
  console.log(`[kling-elements] worker started id=${WORKER_ID} limit=${CLAIM_LIMIT} loop=${LOOP_MS}ms createPath=${envSnapshot.createPath} env=${envSnapshot.fingerprint}`);

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