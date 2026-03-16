const DEFAULT_POSTER_TIME_SECONDS = 0.12;
const DEFAULT_ASPECT_RATIO = "16 / 9";

function clampPosterTime(video: HTMLVideoElement) {
  const duration = Number(video.duration || 0);
  if (!Number.isFinite(duration) || duration <= 0) return DEFAULT_POSTER_TIME_SECONDS;
  return Math.max(0.04, Math.min(0.18, duration / 12));
}

export function getPosterSeekTime(video: HTMLVideoElement) {
  const saved = Number(video.dataset.posterTime || "");
  if (Number.isFinite(saved) && saved > 0) return saved;
  const next = clampPosterTime(video);
  video.dataset.posterTime = String(next);
  return next;
}

export function applyVideoAspectRatio(video: HTMLVideoElement | null) {
  if (!video) return;
  const width = Number(video.videoWidth || 0);
  const height = Number(video.videoHeight || 0);
  if (width > 0 && height > 0) {
    video.style.setProperty("--video-thumb-aspect", `${width} / ${height}`);
  } else if (!video.style.getPropertyValue("--video-thumb-aspect")) {
    video.style.setProperty("--video-thumb-aspect", DEFAULT_ASPECT_RATIO);
  }
}

export function primeVideoStill(video: HTMLVideoElement | null) {
  if (!video) return;
  applyVideoAspectRatio(video);
  if (video.dataset.hoverPreview === "true") return;
  if (video.dataset.posterPrimed === "true" || video.dataset.posterPriming === "true") return;

  video.dataset.posterPriming = "true";
  const targetTime = getPosterSeekTime(video);

  if (video.readyState < 1) {
    try {
      video.load();
    } catch {
      video.dataset.posterPriming = "false";
    }
    return;
  }

  try {
    if (Math.abs(Number(video.currentTime || 0) - targetTime) > 0.02) {
      video.currentTime = targetTime;
      return;
    }
  } catch {
    video.dataset.posterPriming = "false";
    return;
  }

  finalizeVideoStill(video);
}

export function finalizeVideoStill(video: HTMLVideoElement | null) {
  if (!video) return;
  applyVideoAspectRatio(video);
  if (video.dataset.posterPriming !== "true") return;
  video.pause();
  video.dataset.posterPriming = "false";
  video.dataset.posterPrimed = "true";
}

export function resetVideoStill(video: HTMLVideoElement | null) {
  if (!video) return;
  applyVideoAspectRatio(video);
  video.dataset.hoverPreview = "false";
  video.pause();
  video.dataset.posterPrimed = "false";
  const targetTime = getPosterSeekTime(video);
  try {
    video.currentTime = targetTime;
  } catch {
    try {
      video.currentTime = 0;
    } catch {}
  }
  window.requestAnimationFrame(() => primeVideoStill(video));
}

function attemptHoverPlay(video: HTMLVideoElement | null, retries = 4) {
  if (!video || video.dataset.hoverPreview !== "true") return;

  const playPromise = video.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(() => {
      if (video.dataset.hoverPreview !== "true") return;
      if (retries <= 0) {
        primeVideoStill(video);
        return;
      }
      window.setTimeout(() => attemptHoverPlay(video, retries - 1), 120);
    });
  }
}

export function startVideoHoverPreview(video: HTMLVideoElement | null) {
  if (!video) return;
  applyVideoAspectRatio(video);
  video.dataset.hoverPreview = "true";
  video.dataset.posterPrimed = "false";
  video.dataset.posterPriming = "false";
  video.preload = "auto";
  try {
    video.currentTime = 0;
  } catch {}
  if (video.readyState < 2) {
    try {
      video.load();
    } catch {}
  }
  window.requestAnimationFrame(() => attemptHoverPlay(video));
}

export function prepareVideoPreview(video: HTMLVideoElement | null) {
  if (!video) return;
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  applyVideoAspectRatio(video);
  window.requestAnimationFrame(() => primeVideoStill(video));
}
