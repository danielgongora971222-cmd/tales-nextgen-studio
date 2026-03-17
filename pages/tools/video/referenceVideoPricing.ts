import type { Asset } from "../../../types";

function asFinitePositive(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

export function readStoredAssetDurationSeconds(asset: Asset | null | undefined): number | null {
  const meta: any = asset?.meta || {};
  return (
    asFinitePositive(meta?.durationSeconds) ||
    asFinitePositive(meta?.videoDurationSeconds) ||
    asFinitePositive(meta?.duration) ||
    null
  );
}

export function loadVideoDurationFromUrl(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const safeUrl = String(url || "").trim();
    if (!safeUrl) {
      resolve(null);
      return;
    }

    const video = document.createElement("video");
    let settled = false;

    const cleanup = () => {
      video.onloadedmetadata = null;
      video.onerror = null;
      video.src = "";
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        // noop
      }
    };

    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";

    video.onloadedmetadata = () => {
      const durationSeconds = asFinitePositive(video.duration);
      finish(durationSeconds);
    };

    video.onerror = () => finish(null);
    video.src = safeUrl;
  });
}

export async function resolveReferenceVideoDurationSeconds(
  asset: Asset | null | undefined
): Promise<number | null> {
  if (!asset || asset.type !== "video") return null;

  const stored = readStoredAssetDurationSeconds(asset);
  if (stored != null) return stored;

  const url = typeof asset.url === "string" ? asset.url.trim() : "";
  if (!url) return null;

  return loadVideoDurationFromUrl(url);
}

export function formatDurationLabel(durationSeconds: number | null | undefined): string | null {
  const value = asFinitePositive(durationSeconds);
  if (value == null) return null;
  if (value >= 10 || Math.abs(value - Math.round(value)) < 0.05) {
    return `${Math.round(value)}s`;
  }
  return `${value.toFixed(1)}s`;
}
