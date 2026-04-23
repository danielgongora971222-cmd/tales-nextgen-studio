const DEFAULT_POSTER_TIME_SECONDS = 0.12;
const DEFAULT_ASPECT_RATIO = "16 / 9";

const previewObserverCleanups = new WeakMap<HTMLVideoElement, () => void>();
const primingTimers = new WeakMap<HTMLVideoElement, number>();

function clampPosterTime(video: HTMLVideoElement) {
  const duration = Number(video.duration || 0);
  if (!Number.isFinite(duration) || duration <= 0) return DEFAULT_POSTER_TIME_SECONDS;
  return Math.max(0.04, Math.min(0.18, duration / 12));
}

function isLowPowerPreviewMode() {
  if (typeof window === "undefined") return true;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const coarse = window.matchMedia?.("(hover: none), (pointer: coarse)")?.matches;
  const small = window.matchMedia?.("(max-width: 767px)")?.matches;
  return Boolean(reduced || coarse || small || document.visibilityState === "hidden");
}

function clearScheduledPrime(video: HTMLVideoElement) {
  const timer = primingTimers.get(video);
  if (timer) {
    window.clearTimeout(timer);
    primingTimers.delete(video);
  }
}

function cleanupPreviewObserver(video: HTMLVideoElement) {
  const cleanup = previewObserverCleanups.get(video);
  if (cleanup) {
    cleanup();
    previewObserverCleanups.delete(video);
  }
}

function schedulePrime(video: HTMLVideoElement, delayMs = 0) {
  clearScheduledPrime(video);

  if (document.visibilityState === "hidden") return;

  const run = () => {
    primingTimers.delete(video);
    window.requestAnimationFrame(() => primeVideoStill(video));
  };

  if (delayMs > 0) {
    const timer = window.setTimeout(run, delayMs);
    primingTimers.set(video, timer);
    return;
  }

  const requestIdle = (window as any).requestIdleCallback as
    | ((cb: () => void, opts?: { timeout?: number }) => number)
    | undefined;

  if (requestIdle) {
    requestIdle(run, { timeout: 1600 });
    return;
  }

  const timer = window.setTimeout(run, 80);
  primingTimers.set(video, timer);
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
  if (document.visibilityState === "hidden") return;
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
  cleanupPreviewObserver(video);
  clearScheduledPrime(video);
  video.dataset.hoverPreview = "false";
  video.pause();
  video.preload = "metadata";
  video.dataset.posterPrimed = "false";
  const targetTime = getPosterSeekTime(video);
  try {
    video.currentTime = targetTime;
  } catch {
    try {
      video.currentTime = 0;
    } catch {}
  }
  schedulePrime(video, 80);
}

function attemptHoverPlay(video: HTMLVideoElement | null, retries = 4) {
  if (!video || video.dataset.hoverPreview !== "true") return;
  if (document.visibilityState === "hidden") return;

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
  cleanupPreviewObserver(video);
  clearScheduledPrime(video);
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

  cleanupPreviewObserver(video);
  clearScheduledPrime(video);

  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  applyVideoAspectRatio(video);

  // En móvil evitamos forzar load/seek de cada thumbnail: se prepara al hacer hover en desktop
  // o cuando el usuario abre el video. Esto baja mucho CPU, decodificación y temperatura.
  if (isLowPowerPreviewMode()) return;

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        previewObserverCleanups.delete(video);
        schedulePrime(video, 120);
      },
      { rootMargin: "640px 0px", threshold: 0.01 }
    );

    observer.observe(video);
    previewObserverCleanups.set(video, () => observer.disconnect());
    return;
  }

  schedulePrime(video, 120);
}
