function clampInt(value, fallback, { min = 0, max = null } = {}) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return fallback;
  let out = Math.trunc(raw);
  if (out < min) out = min;
  if (max != null && out > max) out = max;
  return out;
}

function readIntEnv(name, fallback, opts) {
  return clampInt(process.env[name], fallback, opts);
}

function secondsSince(isoString) {
  const ts = Date.parse(String(isoString || ""));
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, Math.round((Date.now() - ts) / 1000));
}

function summarizeWorkers(rows, activeWindowMs = 90_000) {
  const now = Date.now();
  const byKind = {};

  for (const row of Array.isArray(rows) ? rows : []) {
    const kind = String(row?.kind || "unknown");
    const updatedAt = row?.updated_at || null;
    const ts = Date.parse(String(updatedAt || ""));
    const isActive = Number.isFinite(ts) && now - ts <= activeWindowMs;

    if (!byKind[kind]) {
      byKind[kind] = {
        active: 0,
        total: 0,
        latestAt: updatedAt,
      };
    }

    byKind[kind].total += 1;
    if (isActive) byKind[kind].active += 1;

    const currentLatestTs = Date.parse(String(byKind[kind].latestAt || ""));
    if (!Number.isFinite(currentLatestTs) || (Number.isFinite(ts) && ts > currentLatestTs)) {
      byKind[kind].latestAt = updatedAt;
    }
  }

  return byKind;
}

function normalizeImageModel(params) {
  return String(params?.model || "unknown").trim() || "unknown";
}


function isWorkerHeartbeatTableMissingError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  const message = String(error?.message || error || "").toLowerCase();
  const details = String(error?.details || "").toLowerCase();
  const hint = String(error?.hint || "").toLowerCase();

  return (
    code === "PGRST205" ||
    ((message.includes("worker_heartbeats") || details.includes("worker_heartbeats") || hint.includes("worker_heartbeats")) &&
      (message.includes("schema cache") || message.includes("does not exist") || message.includes("could not find the table") ||
        details.includes("schema cache") || hint.includes("reload the schema cache")))
  );
}

function normalizeVideoProvider(params) {
  const provider = String(params?.provider || "").trim();
  if (provider) return provider;
  const model = String(params?.model || "").trim().toLowerCase();
  if (model.startsWith("kling")) return "kling";
  if (model.startsWith("veo")) return "google";
  if (model.startsWith("fal")) return "fal";
  return "unknown";
}

function buildCapacitySnapshot(kind, workersActive = 0) {
  const safeWorkers = Math.max(1, clampInt(workersActive, 0, { min: 0, max: 100 }));

  if (kind === "image") {
    const perWorker = readIntEnv("QUEUE_IMAGE_PENDING_PER_WORKER", 20, { min: 1, max: 200 });
    const hardCap = readIntEnv("QUEUE_IMAGE_PENDING_HARD_CAP", 120, { min: 1, max: 5000 });
    const perModel = readIntEnv("QUEUE_IMAGE_PENDING_PER_MODEL", 24, { min: 1, max: 1000 });
    return {
      kind,
      perWorker,
      hardCap,
      recommendedCap: Math.min(hardCap, safeWorkers * perWorker),
      perModelCap: perModel,
      activeWorkers: workersActive,
    };
  }

  const perWorker = readIntEnv("QUEUE_VIDEO_PENDING_PER_WORKER", 6, { min: 1, max: 100 });
  const hardCap = readIntEnv("QUEUE_VIDEO_PENDING_HARD_CAP", 24, { min: 1, max: 1000 });
  const perProvider = readIntEnv("QUEUE_VIDEO_PENDING_PER_PROVIDER", 12, { min: 1, max: 500 });

  return {
    kind,
    perWorker,
    hardCap,
    recommendedCap: Math.min(hardCap, safeWorkers * perWorker),
    perProviderCap: perProvider,
    activeWorkers: workersActive,
  };
}

async function loadWorkerHeartbeatRows({ supabaseAdmin, limit = 200 }) {
  if (!supabaseAdmin) return [];

  const { data, error } = await supabaseAdmin
    .from("worker_heartbeats")
    .select("worker_id,kind,updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (isWorkerHeartbeatTableMissingError(error)) return [];
    throw error;
  }
  return Array.isArray(data) ? data : [];
}

async function countPendingJobs({ supabaseAdmin, kind, ownerId = null, model = null, provider = null }) {
  if (!supabaseAdmin) return { count: 0, error: null };

  let q = supabaseAdmin
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "running")
    .is("result_asset_id", null);

  if (kind) q = q.eq("kind", kind);
  if (ownerId) q = q.eq("owner_id", ownerId);
  if (model) q = q.filter("params->>model", "eq", String(model));
  if (provider) q = q.filter("params->>provider", "eq", String(provider));

  const res = await q;
  return { count: Number(res.count || 0), error: res.error || null };
}

async function loadPendingJobsSample({ supabaseAdmin, limit = 1000 }) {
  if (!supabaseAdmin) return [];

  const { data, error } = await supabaseAdmin
    .from("jobs")
    .select("id, kind, created_at, params")
    .eq("status", "running")
    .is("result_asset_id", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

function summarizePendingJobs(rows, workerSummary) {
  const out = {
    image: {
      pendingTotal: 0,
      oldestAgeSeconds: null,
      topModels: [],
      capacity: buildCapacitySnapshot("image", workerSummary?.image?.active || 0),
    },
    video: {
      pendingTotal: 0,
      oldestAgeSeconds: null,
      byProvider: {},
      capacity: buildCapacitySnapshot("video", workerSummary?.video?.active || 0),
    },
  };

  const imageModelCounts = new Map();
  const videoProviderCounts = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const kind = String(row?.kind || "").trim();
    const ageSeconds = secondsSince(row?.created_at);

    if (kind === "image") {
      out.image.pendingTotal += 1;
      if (ageSeconds != null) {
        out.image.oldestAgeSeconds =
          out.image.oldestAgeSeconds == null ? ageSeconds : Math.max(out.image.oldestAgeSeconds, ageSeconds);
      }
      const key = normalizeImageModel(row?.params || {});
      imageModelCounts.set(key, Number(imageModelCounts.get(key) || 0) + 1);
      continue;
    }

    if (kind === "video") {
      out.video.pendingTotal += 1;
      if (ageSeconds != null) {
        out.video.oldestAgeSeconds =
          out.video.oldestAgeSeconds == null ? ageSeconds : Math.max(out.video.oldestAgeSeconds, ageSeconds);
      }
      const provider = normalizeVideoProvider(row?.params || {});
      videoProviderCounts.set(provider, Number(videoProviderCounts.get(provider) || 0) + 1);
    }
  }

  out.image.topModels = Array.from(imageModelCounts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  out.video.byProvider = Object.fromEntries(
    Array.from(videoProviderCounts.entries()).sort((a, b) => b[1] - a[1])
  );

  return out;
}

export async function getQueueOpsSnapshot({ supabaseAdmin, activeWindowMs = 90_000 } = {}) {
  if (!supabaseAdmin) {
    return {
      workers: {},
      queues: {
        image: { pendingTotal: 0, oldestAgeSeconds: null, topModels: [], capacity: buildCapacitySnapshot("image", 0) },
        video: { pendingTotal: 0, oldestAgeSeconds: null, byProvider: {}, capacity: buildCapacitySnapshot("video", 0) },
      },
    };
  }

  const [heartbeatRows, pendingRows] = await Promise.all([
    loadWorkerHeartbeatRows({ supabaseAdmin, limit: 200 }),
    loadPendingJobsSample({ supabaseAdmin, limit: 1000 }),
  ]);

  const workers = summarizeWorkers(heartbeatRows, activeWindowMs);
  const queues = summarizePendingJobs(pendingRows, workers);

  return { workers, queues };
}

export async function assertQueueAdmission({
  supabaseAdmin,
  httpError,
  kind,
  ownerId = null,
  model = null,
  provider = null,
} = {}) {
  if (!supabaseAdmin || !httpError || !kind) return null;

  const snapshot = await getQueueOpsSnapshot({ supabaseAdmin });
  const workers = snapshot.workers || {};
  const activeWorkers = Number(workers?.[kind]?.active || 0);
  const capacity = buildCapacitySnapshot(kind, activeWorkers);

  const pendingTotal = Number(snapshot?.queues?.[kind]?.pendingTotal || 0);
  if (pendingTotal >= capacity.recommendedCap) {
    throw httpError(
      503,
      "QUEUE_AT_CAPACITY",
      kind === "image"
        ? "La cola global de imágenes está al límite. Espera un poco antes de lanzar más generaciones."
        : "La cola global de video está al límite. Espera un poco antes de lanzar más generaciones.",
      {
        kind,
        pendingTotal,
        recommendedCap: capacity.recommendedCap,
        hardCap: capacity.hardCap,
        activeWorkers,
        perWorker: capacity.perWorker,
      }
    );
  }

  if (kind === "image" && model) {
    const byModel = await countPendingJobs({ supabaseAdmin, kind: "image", model });
    if (byModel.error) {
      throw httpError(500, "QUEUE_CHECK_FAILED", "No se pudo validar el estado de la cola de imágenes.", {
        details: String(byModel.error.message || byModel.error),
      });
    }

    if (byModel.count >= capacity.perModelCap) {
      throw httpError(
        503,
        "QUEUE_MODEL_AT_CAPACITY",
        "Ese modelo de imagen está muy cargado ahora mismo. Espera un poco o usa otro modelo temporalmente.",
        {
          kind: "image",
          model,
          pendingModel: byModel.count,
          perModelCap: capacity.perModelCap,
          globalPending: pendingTotal,
          recommendedCap: capacity.recommendedCap,
        }
      );
    }
  }

  if (kind === "video") {
    const effectiveProvider = provider || (model && String(model).toLowerCase().startsWith("kling") ? "kling" : null);
    if (effectiveProvider) {
      const byProvider = await countPendingJobs({ supabaseAdmin, kind: "video", provider: effectiveProvider });
      if (byProvider.error) {
        throw httpError(500, "QUEUE_CHECK_FAILED", "No se pudo validar el estado de la cola de video.", {
          details: String(byProvider.error.message || byProvider.error),
        });
      }

      if (byProvider.count >= capacity.perProviderCap) {
        throw httpError(
          503,
          "QUEUE_PROVIDER_AT_CAPACITY",
          "El proveedor de video está muy cargado ahora mismo. Espera un poco antes de reintentar.",
          {
            kind: "video",
            provider: effectiveProvider,
            pendingProvider: byProvider.count,
            perProviderCap: capacity.perProviderCap,
            globalPending: pendingTotal,
            recommendedCap: capacity.recommendedCap,
          }
        );
      }
    }
  }

  if (ownerId) {
    const perUserCap = kind === "image"
      ? readIntEnv("QUEUE_IMAGE_PENDING_PER_USER", 4, { min: 1, max: 100 })
      : readIntEnv("QUEUE_VIDEO_PENDING_PER_USER", 2, { min: 1, max: 100 });

    const byUser = await countPendingJobs({ supabaseAdmin, kind, ownerId });
    if (byUser.error) {
      throw httpError(500, "QUEUE_CHECK_FAILED", "No se pudo validar el estado de tu cola.", {
        details: String(byUser.error.message || byUser.error),
      });
    }

    if (byUser.count >= perUserCap) {
      throw httpError(
        429,
        kind === "image" ? "QUEUE_USER_IMAGE_LIMIT" : "QUEUE_USER_VIDEO_LIMIT",
        kind === "image"
          ? "Ya tienes demasiadas imágenes activas o en cola. Espera a que termine una antes de lanzar otra."
          : "Ya tienes demasiados videos activos o en cola. Espera a que termine uno antes de lanzar otro.",
        {
          kind,
          ownerPending: byUser.count,
          perUserCap,
        }
      );
    }
  }

  return {
    workers: workers?.[kind] || { active: 0, total: 0, latestAt: null },
    pendingTotal,
    capacity,
  };
}
