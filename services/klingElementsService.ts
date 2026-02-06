import { supabase } from "./supabaseClient";

export type KlingElementTagId =
  | "o_101" | "o_102" | "o_103" | "o_104"
  | "o_105" | "o_106" | "o_107" | "o_108";

export type KlingElement = {
  id: string;
  elementId: number;
  elementName: string;
  elementDescription: string;
  frontalAssetId: string;
  referAssetIds: string[];
  tagIds: KlingElementTagId[];
  createdAt: number;
};

type ApiOk<T> = { ok: true; item?: T; items?: T[] };
type ApiFail = { ok: false; error: any };

async function authHeadersJson() {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

function mapRowToKlingElement(row: any): KlingElement {
  const createdRaw = row.created_at ?? row.createdAt;
  const createdAt =
    typeof createdRaw === "string"
      ? new Date(createdRaw).getTime()
      : typeof createdRaw === "number"
        ? createdRaw
        : Date.now();

  return {
    id: row.id,
    elementId: Number(row.element_id ?? row.elementId),
    elementName: String(row.element_name ?? row.elementName ?? ""),
    elementDescription: String(row.element_description ?? row.elementDescription ?? ""),
    frontalAssetId: String(row.frontal_asset_id ?? row.frontalAssetId ?? ""),
    referAssetIds: Array.isArray(row.refer_asset_ids ?? row.referAssetIds)
      ? (row.refer_asset_ids ?? row.referAssetIds).map((x: any) => String(x))
      : [],
    tagIds: Array.isArray(row.tag_ids ?? row.tagIds) ? (row.tag_ids ?? row.tagIds) : [],
    createdAt,
  };
}

export async function listKlingElements(): Promise<KlingElement[]> {
  const headers = await authHeadersJson();
  const resp = await fetch("/api/kling/elements", { method: "GET", headers });
  const data = await resp.json();

  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error?.message || "Error listando Elements.");
  }
  return (data.items || []).map(mapRowToKlingElement);
}

export async function createKlingElement(payload: {
  elementName: string;
  elementDescription: string;
  frontalAssetId: string;
  referAssetIds: string[];
  tagIds?: KlingElementTagId[];
}): Promise<KlingElement> {
  const headers = await authHeadersJson();
  const resp = await fetch("/api/kling/elements", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const data = await resp.json();

  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error?.message || "Error creando Element.");
  }
  return mapRowToKlingElement(data.item);
}

export async function deleteKlingElement(rowId: string): Promise<void> {
  const headers = await authHeadersJson();
  const resp = await fetch("/api/kling/elements/delete", {
    method: "POST",
    headers,
    body: JSON.stringify({ id: rowId }),
  });
  const data = await resp.json();

  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error?.message || "Error borrando Element.");
  }
}
