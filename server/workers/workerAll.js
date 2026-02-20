// server/workers/workerAll.js
// Arranca ambos workers (video + imagen) en el MISMO proceso.
// Útil cuando en Render usas un solo Worker Service (npm run start:worker).
import "./jobsWorker.js";        // JOB_KIND=video (default)
import "./imageJobsWorker.js";   // JOB_KIND=image (default)
