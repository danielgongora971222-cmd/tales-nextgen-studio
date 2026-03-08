function readInt(name, fallback) {
  const rawEnv = process.env[name];

  if (rawEnv === undefined || rawEnv === null) return fallback;

  const raw = String(rawEnv).trim();
  if (raw === "") return fallback;

  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

async function countActiveJobs({ supabaseAdmin, ownerId, kind, tool }) {
  let q = supabaseAdmin
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .in("status", ["queued", "running"])
    .is("result_asset_id", null);

  if (kind) q = q.eq("kind", kind);
  if (tool) q = q.filter("params->>tool", "eq", tool);

  const res = await q;
  return res;
}

export async function assertJobLimits({ supabaseAdmin, httpError, ownerId, kind, tool }) {
  if (!supabaseAdmin) return;

  const maxTotalAnyKind = readInt("MAX_RUNNING_JOBS_TOTAL_PER_USER", 5);
  const maxVideoPerUser = readInt("MAX_RUNNING_JOBS_VIDEO_PER_USER", 1);

  // ✅ nuevos defaults alineados con lo que pediste
  const maxImagePerUser = readInt("MAX_RUNNING_JOBS_IMAGE_PER_USER", 4);
  const maxImageTotal = readInt("MAX_RUNNING_IMAGE_JOBS_TOTAL_PER_USER", 4);
  const maxImagePerTool = readInt("MAX_RUNNING_IMAGE_JOBS_PER_TOOL_PER_USER", 2);

  // 1) total activos de cualquier kind
  const totalQ = await countActiveJobs({ supabaseAdmin, ownerId });
  if (totalQ.error) {
    throw httpError(500, "JOB_LIMIT_CHECK_FAILED", "No se pudo validar límites de jobs.", {
      details: String(totalQ.error.message || totalQ.error),
    });
  }

  const totalAnyKind = totalQ.count || 0;
  if (totalAnyKind >= maxTotalAnyKind) {
    throw httpError(
      429,
      "TOO_MANY_JOBS_TOTAL",
      "Tienes demasiados jobs activos en total. Espera a que termine uno antes de seguir.",
      {
        maxTotalAnyKind,
        totalActiveJobs: totalAnyKind,
      }
    );
  }

  // 2) límites por kind
  const kindQ = await countActiveJobs({ supabaseAdmin, ownerId, kind });
  if (kindQ.error) {
    throw httpError(500, "JOB_LIMIT_CHECK_FAILED", "No se pudo validar límites de jobs.", {
      details: String(kindQ.error.message || kindQ.error),
    });
  }

  const byKind = kindQ.count || 0;
  const maxPerKind = kind === "video" ? maxVideoPerUser : maxImagePerUser;

  if (byKind >= maxPerKind) {
    throw httpError(
      429,
      "TOO_MANY_JOBS_KIND",
      `Tienes demasiados jobs activos de tipo "${kind}". Espera a que termine uno antes de seguir.`,
      {
        kind,
        maxPerKind,
        activeOfKind: byKind,
      }
    );
  }

  // 3) límites extra SOLO para imágenes
  if (kind === "image") {
    if (byKind >= maxImageTotal) {
      throw httpError(
        429,
        "TOO_MANY_IMAGE_JOBS_TOTAL",
        "Ya tienes 4 generaciones de imagen activas en total. Espera a que termine una antes de lanzar otra.",
        {
          maxImageTotal,
          activeImageJobs: byKind,
        }
      );
    }

    if (tool) {
      const toolQ = await countActiveJobs({ supabaseAdmin, ownerId, kind: "image", tool });
      if (toolQ.error) {
        throw httpError(500, "JOB_LIMIT_CHECK_FAILED", "No se pudo validar límites por herramienta.", {
          details: String(toolQ.error.message || toolQ.error),
        });
      }

      const byTool = toolQ.count || 0;
      if (byTool >= maxImagePerTool) {
        throw httpError(
          429,
          "TOO_MANY_IMAGE_JOBS_TOOL",
          "Ya tienes 2 generaciones activas en esta herramienta. Espera a que termine una antes de lanzar otra.",
          {
            tool,
            maxImagePerTool,
            activeToolJobs: byTool,
          }
        );
      }
    }
  }
}