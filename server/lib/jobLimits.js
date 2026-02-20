function readInt(name, fallback) {
  const raw = String(process.env[name] || "").trim();
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export async function assertJobLimits({ supabaseAdmin, httpError, ownerId, kind }) {
  if (!supabaseAdmin) return;

  const maxTotal = readInt("MAX_RUNNING_JOBS_TOTAL_PER_USER", 5);

  const maxPerKind =
    kind === "video"
      ? readInt("MAX_RUNNING_JOBS_VIDEO_PER_USER", 1)
      : readInt("MAX_RUNNING_JOBS_IMAGE_PER_USER", 3);

  // Total running (cualquier kind)
  const totalQ = await supabaseAdmin
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("status", "running")
    .is("result_asset_id", null);

  if (totalQ.error) {
    throw httpError(500, "JOB_LIMIT_CHECK_FAILED", "No se pudo validar límites de jobs.", {
      details: String(totalQ.error.message || totalQ.error),
    });
  }

  const total = totalQ.count || 0;
  if (total >= maxTotal) {
    throw httpError(429, "TOO_MANY_JOBS_TOTAL", "Tienes demasiados jobs en proceso. Espera a que terminen.", {
      maxTotal,
      totalRunning: total,
    });
  }

  // Per kind running
  const kindQ = await supabaseAdmin
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("status", "running")
    .eq("kind", kind)
    .is("result_asset_id", null);

  if (kindQ.error) {
    throw httpError(500, "JOB_LIMIT_CHECK_FAILED", "No se pudo validar límites de jobs.", {
      details: String(kindQ.error.message || kindQ.error),
    });
  }

  const byKind = kindQ.count || 0;
  if (byKind >= maxPerKind) {
    throw httpError(
      429,
      "TOO_MANY_JOBS_KIND",
      `Tienes demasiados jobs de tipo "${kind}" en proceso. Espera a que terminen.`,
      { kind, maxPerKind, runningOfKind: byKind }
    );
  }
}