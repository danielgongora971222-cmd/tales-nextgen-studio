import { supabase } from "./supabaseClient";

export type GenerationJobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type GenerationJobRow = {
  id: string;
  owner_id: string;
  type: "video_generate";
  status: GenerationJobStatus;
  label: string | null;
  model_norm: string | null;
  prompt: string | null;
  job_token: string | null;
  pending_slots_count: number | null;
  result: any;
  error: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

export async function fetchMyGenerationJobs({
  ownerId,
  limit = 50,
}: {
  ownerId: string;
  limit?: number;
}): Promise<GenerationJobRow[]> {
  const { data, error } = await supabase
    .from("generation_jobs")
    .select(
      "id, owner_id, type, status, label, model_norm, prompt, job_token, pending_slots_count, result, error, created_at, updated_at, finished_at"
    )
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data || []) as any;
}

export async function ensureGenerationJobRow({
  id,
  ownerId,
  type,
  status,
  label,
  modelNorm,
  prompt,
  jobToken,
  pendingSlotsCount,
}: {
  id: string;
  ownerId: string;
  type: "video_generate";
  status: GenerationJobStatus;
  label: string;
  modelNorm: string;
  prompt: string;
  jobToken: string;
  pendingSlotsCount: number;
}): Promise<void> {
  // Si ya existe, no hacemos nada.
  const existing = await supabase
    .from("generation_jobs")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (existing.error && existing.error.code !== "PGRST116") {
    // PGRST116 = "Results contain 0 rows" cuando usamos maybeSingle()
    throw existing.error;
  }

  if (existing.data?.id) return;

  const payload = {
    id,
    owner_id: ownerId,
    type,
    status,
    label,
    model_norm: modelNorm,
    prompt,
    job_token: jobToken,
    pending_slots_count: pendingSlotsCount,
    result: {},
    error: null,
  };

  const ins = await supabase.from("generation_jobs").insert(payload);
  if (ins.error) throw ins.error;
}

export async function cancelGenerationJob({
  id,
  ownerId,
}: {
  id: string;
  ownerId: string;
}): Promise<void> {
  const upd = await supabase
    .from("generation_jobs")
    .update({ status: "canceled", finished_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", ownerId);
  if (upd.error) throw upd.error;
}

export function subscribeMyGenerationJobs({
  ownerId,
  onUpsert,
}: {
  ownerId: string;
  onUpsert: (row: GenerationJobRow) => void;
}) {
  const channel = supabase
    .channel(`generation_jobs:${ownerId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "generation_jobs",
        filter: `owner_id=eq.${ownerId}`,
      },
      (payload) => {
        const next = (payload as any)?.new || null;
        if (!next) return;
        onUpsert(next as GenerationJobRow);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
