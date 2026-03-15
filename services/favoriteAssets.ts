const FAVORITES_STORAGE_KEY = "tales.favoriteAssets";
const FAVORITES_EVENT = "tales:favorites-updated";

function normalizeIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((id) => (typeof id === "string" ? id.trim() : ""))
    .filter(Boolean);
}

export function readFavoriteAssetIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
    return normalizeIds(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

export function writeFavoriteAssetIds(ids: string[]): string[] {
  if (typeof window === "undefined") return normalizeIds(ids);
  const next = Array.from(new Set(normalizeIds(ids)));
  try {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }

  try {
    window.dispatchEvent(new CustomEvent(FAVORITES_EVENT, { detail: { ids: next } }));
  } catch {
    // ignore event errors
  }

  return next;
}

export function syncFavoriteAssetState(assetId: string, liked: boolean): string[] {
  const set = new Set(readFavoriteAssetIds());
  if (liked) set.add(String(assetId));
  else set.delete(String(assetId));
  return writeFavoriteAssetIds(Array.from(set));
}

export function toggleFavoriteAssetState(assetId: string): string[] {
  const set = new Set(readFavoriteAssetIds());
  if (set.has(assetId)) set.delete(assetId);
  else set.add(assetId);
  return writeFavoriteAssetIds(Array.from(set));
}

export function isFavoriteAsset(assetId: string): boolean {
  return readFavoriteAssetIds().includes(String(assetId));
}

export { FAVORITES_EVENT, FAVORITES_STORAGE_KEY };
