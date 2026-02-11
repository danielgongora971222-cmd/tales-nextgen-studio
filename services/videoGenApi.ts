// services/videoGenApi.ts
import { supabase } from "./supabaseClient";

function getStatus(err: any): number | null {
  return typeof err?.status === "number"
    ? err.status
    : typeof err?.response?.status === "number"
      ? err.response.status
      : null;
}

function getErrMsg(err: any): string {
  return (
    err?.response?.data?.message ||
    err?.response?.data?.error ||
    err?.message ||
    (typeof err === "string" ? err : "Failed to generate video.")
  );
}

export function formatErr(err: any): string {
  const s = getStatus(err);
  const m = getErrMsg(err);
  return s ? `${m} (HTTP ${s})` : m;
}

export async function apiPostJson<T>(path: string, body: any): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const resp = await fetch(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const rawText = await resp.text();
  let data: any = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = null;
  }

  if (!resp.ok || data?.ok === false) {
    const e =
      data?.error ??
      data ??
      { message: rawText ? rawText.slice(0, 600) : `Request failed: ${resp.status}` };
    const msg =
      typeof e === "string"
        ? e
        : e?.message || e?.error || `Request failed: ${resp.status}`;
    const details = e?.details ? `\n\nDetalles:\n${JSON.stringify(e.details, null, 2)}` : "";
    throw new Error(`${e?.code ? `${e.code}: ` : ""}${msg}${details}`);
  }

  return data as T;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function waitFalJob(jobToken: string, maxWaitMs = 15 * 60 * 1000) {
  const t0 = Date.now();
  while (true) {
    const st = await apiPostJson<any>("/api/ai/video/fal/status", { jobToken });
    const status = st?.status;

    if (status === "COMPLETED") return;
    if (status === "FAILED") throw new Error(st?.error || "Fal job FAILED");
    if (Date.now() - t0 > maxWaitMs) throw new Error("Timeout esperando Kling V3 (Fal).");

    await delay(1500);
  }
}
