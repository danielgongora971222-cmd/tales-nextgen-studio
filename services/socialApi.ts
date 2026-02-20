import { supabase } from "./supabaseClient";
import { apiUrl } from "./apiBase";
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
    throw new Error(`Respuesta no-JSON del backend. Inicio: ${text.slice(0, 120)}`);
  }
}

export async function toggleLike(assetId: string): Promise<{ liked: boolean; likesCount: number }> {
  const headers = await authHeaders();
  const resp = await fetch(apiUrl(`/api/assets/${assetId}/like`), { method: "POST", headers });

  const raw = await resp.text();
  const data = parseJsonOrThrow(raw);

  if (!resp.ok || data?.ok === false) {
    const msg = data?.error?.message || `Like failed (${resp.status})`;
    throw new Error(msg);
  }

  return {
    liked: Boolean(data.liked),
    likesCount: Number.isFinite(Number(data.likesCount)) ? Number(data.likesCount) : 0,
  };
}

export async function listComments(
  assetId: string,
  opts?: { limit?: number; offset?: number }
): Promise<{ comments: Comment[]; commentsCount: number }> {
  const headers = await authHeaders();
  const params = new URLSearchParams();
  params.set("limit", String(opts?.limit ?? 50));
  params.set("offset", String(opts?.offset ?? 0));

  const resp = await fetch(apiUrl(`/api/assets/${assetId}/comments?${params.toString()}`), {
    method: "GET",
    headers: { Authorization: headers.Authorization || "" },
  });

  const raw = await resp.text();
  const data = parseJsonOrThrow(raw);

  if (!resp.ok || data?.ok === false) {
    const msg = data?.error?.message || `List comments failed (${resp.status})`;
    throw new Error(msg);
  }

  const comments: Comment[] = Array.isArray(data.comments) ? data.comments : [];
  const commentsCount = Number.isFinite(Number(data.commentsCount)) ? Number(data.commentsCount) : comments.length;

  return { comments, commentsCount };
}

export async function createComment(
  assetId: string,
  text: string
): Promise<{ comment: Comment; commentsCount: number }> {
  const headers = await authHeaders();
  const resp = await fetch(apiUrl(`/api/assets/${assetId}/comments`), {
    method: "POST",
    headers,
    body: JSON.stringify({ text }),
  });

  const raw = await resp.text();
  const data = parseJsonOrThrow(raw);

  if (!resp.ok || data?.ok === false) {
    const msg = data?.error?.message || `Create comment failed (${resp.status})`;
    throw new Error(msg);
  }

  return {
    comment: data.comment,
    commentsCount: Number.isFinite(Number(data.commentsCount)) ? Number(data.commentsCount) : 0,
  };
}