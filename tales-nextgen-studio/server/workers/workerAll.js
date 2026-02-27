// server/workers/workerAll.js
// Arranca ambos workers (video + imagen) en el MISMO proceso.
// Útil cuando en Render usas un solo Worker Service (npm run start:worker).
import "./jobsWorker.js";        // JOB_KIND=video (default)
import "./imageJobsWorker.js";   // JOB_KIND=image (default)

// ✅ Elements worker (opt-in)
const enable =
  String(process.env.WORKER_ENABLE_KLING_ELEMENTS || "").toLowerCase() === "true" ||
  String(process.env.WORKER_ENABLE_KLING_ELEMENTS || "") === "1" ||
  String(process.env.WORKER_ENABLE_KLING_ELEMENTS || "").toLowerCase() === "yes";

if (enable) {
  import("./klingElementsWorker.js").catch((e) => {
    console.error("[workerAll] Failed to start klingElementsWorker:", e?.message || e);
  });
}