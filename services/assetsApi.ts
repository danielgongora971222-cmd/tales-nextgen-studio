import { Asset } from "../types";
import { supabase } from "./supabaseClient";

type ApiOk = { ok: true; items: any[] };
type ApiFail = { ok: false; error: any };

function mapRowToAsset(row: any): Asset {
  return {
    id: row.id,
    url: row.url || "",
    type: row.type === "video" ? "video" : "image",
    name: row.name || `Generation ${String(row.id || "").slice(0, 4)}`,
    prompt: row.prompt ?? undefined,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    ownerId: row.owner_id,
    isPublic: false,
    likes: [],
    comments: [],
  };
}

export async function listMyAssets(opts?: { type?: "image" | "video"; limit?: number }): Promise<Asset[]> {
  // 1) sacar token del login actual
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  // 2) armar URL con filtros
  const params = new URLSearchParams();
  if (opts?.type) params.set("type", opts.type);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const url = `/api/assets${params.toString() ? `?${params.toString()}` : ""}`;

  // 3) mandar request con Authorization
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const resp = await fetch(url, { method: "GET", headers });

  // 4) leer respuesta (protege del error: Unexpected token '<')
  const text = await resp.text();
  let data: ApiOk | ApiFail | any;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `El backend devolvió HTML en vez de JSON (probable: /api/assets no existe aún o Vercel no reescribió). Inicio: ${text.slice(0, 30)}`
    );
  }

  if (!resp.ok || data?.ok === false) {
    const e = data?.error;
    const msg = typeof e === "string" ? e : e?.message || `Request failed: ${resp.status}`;
    throw new Error(msg);
  }

  return (Array.isArray(data.items) ? data.items : [])
    .map(mapRowToAsset)
    .filter((a) => a.url); // quita vacíos
}
