import { supabase } from "./supabaseClient";
import { apiUrl } from "./apiBase";
import { invalidatePurchasedAssetsCache } from "./assetsApi";
import type { Comment } from "../types";

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

function parseJsonOrThrow(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`El backend devolvió texto/HTML en vez de JSON. Inicio: ${text.slice(0, 80)}`);
  }
}

export async function listCommunityListings(opts?: {
  limit?: number;
  offset?: number;
  sort?: "recent" | "oldest" | "top_liked" | "top_sold" | "top_commented";
  media?: "all" | "image" | "video" | "workflow";
  seller?: string;
  q?: string;
  mine?: boolean;
}) {
  const headers = await authHeaders();

  const params = new URLSearchParams();
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  if (opts?.offset != null) params.set("offset", String(opts.offset));
  if (opts?.sort) params.set("sort", opts.sort);
  if (opts?.media) params.set("media", opts.media);
  if (opts?.seller) params.set("seller", opts.seller);
  if (opts?.q) params.set("q", opts.q);
  if (opts?.mine) params.set("mine", "1");

  const resp = await fetch(apiUrl(`/api/community-store/listings?${params.toString()}`), {
    method: "GET",
    headers,
  });

  const raw = await resp.text();
  const data = parseJsonOrThrow(raw);

  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error?.message || `List listings failed (${resp.status})`);
  }

  return {
    items: Array.isArray(data.items) ? data.items : [],
    nextOffset: Number.isFinite(Number(data.nextOffset)) ? Number(data.nextOffset) : 0,
    hasMore: Boolean(data.hasMore),
  };
}

export async function getCommunityListing(listingId: string) {
  const headers = await authHeaders();
  const resp = await fetch(apiUrl(`/api/community-store/listings/${listingId}`), { headers, method: "GET" });
  const raw = await resp.text();
  const data = parseJsonOrThrow(raw);

  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error?.message || `Get listing failed (${resp.status})`);
  }

  return data.item;
}

export async function createCommunityListingFromAsset(input: {
  previewAssetId: string;
  name: string;
  priceCredits: number;
  description: string;
  listingKind?: "single" | "workflow";
}) {
  const headers = await authHeaders();
  const resp = await fetch(apiUrl(`/api/community-store/listings`), {
    method: "POST",
    headers,
    body: JSON.stringify({
      previewAssetId: input.previewAssetId,
      name: input.name,
      priceCredits: input.priceCredits,
      description: input.description,
      listingKind: input.listingKind || "single",
    }),
  });

  const raw = await resp.text();
  const data = parseJsonOrThrow(raw);

  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error?.message || `Create listing failed (${resp.status})`);
  }

  return { listingId: String(data.listingId), reused: Boolean(data.reused) };
}

export async function deleteCommunityListing(listingId: string) {
  return updateCommunityListing(listingId, { status: "deleted" });
}

export async function updateCommunityListing(
  listingId: string,
  patch: { priceCredits?: number; description?: string; status?: "active" | "unlisted" | "deleted"; name?: string }
) {
  const headers = await authHeaders();
  const resp = await fetch(apiUrl(`/api/community-store/listings/${listingId}`), {
    method: "PATCH",
    headers,
    body: JSON.stringify(patch),
  });

  const raw = await resp.text();
  const data = parseJsonOrThrow(raw);

  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error?.message || `Update listing failed (${resp.status})`);
  }

  return { ok: true };
}

export async function purchaseCommunityListing(listingId: string, referralCode?: string | null) {
  const headers = await authHeaders();

  // Idempotency key (browser moderno)
  const idem = typeof crypto !== "undefined" && "randomUUID" in crypto ? (crypto as any).randomUUID() : String(Date.now());

  const resp = await fetch(apiUrl(`/api/community-store/purchase`), {
    method: "POST",
    headers: { ...headers, "x-idempotency-key": idem },
    body: JSON.stringify({ listingId, referralCode: referralCode || null }),
  });

  const raw = await resp.text();
  const data = parseJsonOrThrow(raw);

  if (!resp.ok || data?.ok === false) {
    const msg = data?.error?.message || `Purchase failed (${resp.status})`;
    const code = data?.error?.code;
    const details = data?.error?.details || null;

    const err: any = new Error(msg);
    err.code = code;
    err.details = details;

    if (code === "INSUFFICIENT_CREDITS" && details) {
      const { emitInsufficientCredits } = await import("./appEvents");
      emitInsufficientCredits(details);
    }

    const { emitWalletRefresh } = await import("./appEvents");
    emitWalletRefresh();
    throw err;
  }

  // ✅ Compra OK: refrescar wallet para que los créditos se descuenten al instante en toda la app.
  const { emitWalletRefresh } = await import("./appEvents");
  emitWalletRefresh();

  // ✅ limpia caché de assets comprados para que aparezcan al instante en tools/pickers
  invalidatePurchasedAssetsCache();

  return { purchaseId: data.purchaseId, paidCredits: Number(data.paidCredits) || 0 };
}

export async function getCommunityListingRecipe(listingId: string) {
  const headers = await authHeaders();
  const resp = await fetch(apiUrl(`/api/community-store/listings/${listingId}/recipe`), { method: "GET", headers });

  const raw = await resp.text();
  const data = parseJsonOrThrow(raw);

  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error?.message || `Get recipe failed (${resp.status})`);
  }

  return {
    recipe: data.recipe,
    recipeHash: data.recipeHash,
    createdAt: data.createdAt,
    resolvedAssets: Array.isArray(data.resolvedAssets) ? data.resolvedAssets : [],
  };
}

export async function toggleCommunityListingLike(listingId: string) {
  const headers = await authHeaders();

  const resp = await fetch(apiUrl(`/api/community-store/listings/${listingId}/like`), {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });

  const raw = await resp.text();
  const data = parseJsonOrThrow(raw);

  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error?.message || `Toggle like failed (${resp.status})`);
  }

  return {
    liked: Boolean(data.liked),
    likesCount: Number.isFinite(Number(data.likesCount)) ? Number(data.likesCount) : 0,
  };
}

export async function listCommunityListingComments(
  listingId: string,
  opts?: { limit?: number; offset?: number }
): Promise<{ comments: Comment[]; commentsCount: number }> {
  const headers = await authHeaders();

  const params = new URLSearchParams();
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  if (opts?.offset != null) params.set("offset", String(opts.offset));

  const resp = await fetch(
    apiUrl(`/api/community-store/listings/${listingId}/comments${params.toString() ? `?${params.toString()}` : ""}`),
    { method: "GET", headers }
  );

  const raw = await resp.text();
  const data = parseJsonOrThrow(raw);

  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error?.message || `List comments failed (${resp.status})`);
  }

  return {
    comments: Array.isArray(data.comments) ? (data.comments as Comment[]) : [],
    commentsCount: Number.isFinite(Number(data.commentsCount)) ? Number(data.commentsCount) : 0,
  };
}

export async function createCommunityListingComment(
  listingId: string,
  text: string
): Promise<{ comment: Comment; commentsCount: number }> {
  const headers = await authHeaders();

  const resp = await fetch(apiUrl(`/api/community-store/listings/${listingId}/comments`), {
    method: "POST",
    headers,
    body: JSON.stringify({ text }),
  });

  const raw = await resp.text();
  const data = parseJsonOrThrow(raw);

  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error?.message || `Create comment failed (${resp.status})`);
  }

  return {
    comment: data.comment as Comment,
    commentsCount: Number.isFinite(Number(data.commentsCount)) ? Number(data.commentsCount) : 0,
  };
}