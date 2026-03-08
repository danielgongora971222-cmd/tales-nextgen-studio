import React, { useEffect, useMemo, useRef, useState } from "react";
import FileUploader from "../../components/FileUploader";
import ErrorModal from "../../components/ErrorModal";
import { useAuth } from "../../contexts/AuthContext";
import type { Asset } from "../../types";
import { deleteAsset, listMyAssets, uploadUserAsset, downloadAssetToDisk } from "../../services/assetsApi";
import { apiPostJson, formatErr } from "../../services/videoGenApi";
import { waitJobCompletion } from "../../services/jobsApi";
import { estimateVideoCostCredits } from "../../config/pricing.js";

type Orientation = "image" | "video";

type PendingMotionControlJob = {
  jobId: string;
  taskId?: string;
  prompt: string;
  imageAssetId: string;
  videoAssetId: string;
  keepOriginalSound: boolean;
  characterOrientation: Orientation;
  mode: "std" | "pro";
  createdAt: number;
};

const PENDING_MOTION_KEY = "tales_pending_motion_control_job_v1";

function savePending(job: PendingMotionControlJob) {
  try {
    localStorage.setItem(PENDING_MOTION_KEY, JSON.stringify(job));
  } catch {}
}

function loadPending(): PendingMotionControlJob | null {
  try {
    const raw = localStorage.getItem(PENDING_MOTION_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (!j?.jobId || !j?.prompt) return null;
    return j as PendingMotionControlJob;
  } catch {
    return null;
  }
}

function clearPending() {
  try {
    localStorage.removeItem(PENDING_MOTION_KEY);
  } catch {}
}

function getMetaTool(a: Asset): string {
  const meta = (a as any)?.meta || {};
  return typeof meta.tool === "string" ? meta.tool : "";
}

function byCreatedDesc(a: Asset, b: Asset) {
  return (b.createdAt || 0) - (a.createdAt || 0);
}

export default function MotionControlTool() {
  const { user } = useAuth();

  // Inputs
  const [refImage, setRefImage] = useState<Asset | null>(null);
  const [refVideo, setRefVideo] = useState<Asset | null>(null);
  const [prompt, setPrompt] = useState("");
  const [keepOriginalSound, setKeepOriginalSound] = useState(true);
  const [characterOrientation, setCharacterOrientation] = useState<Orientation>("video");
  const [mode, setMode] = useState<"std" | "pro">("std");

  // Job state
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressMsg, setProgressMsg] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);

  const [pendingJob, setPendingJob] = useState<PendingMotionControlJob | null>(null);

    const pendingSlots = useMemo(() => {
    if (isGenerating) return ["pending-1"];
    if (pendingJob) return ["pending-resume-1"];
    return [];
  }, [isGenerating, pendingJob]);

  // Output + history
  const [latest, setLatest] = useState<Asset | null>(null);
  const [history, setHistory] = useState<Asset[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Viewer
  const [viewer, setViewer] = useState<Asset | null>(null);
  const [viewerRefImage, setViewerRefImage] = useState<Asset | null>(null);
  const [viewerRefVideo, setViewerRefVideo] = useState<Asset | null>(null);

  // Picker modal
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerType, setPickerType] = useState<"image" | "video">("image");
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerAssets, setPickerAssets] = useState<Asset[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerLimit, setPickerLimit] = useState(60);
  const [pickerTarget, setPickerTarget] = useState<"refImage" | "refVideo">("refImage");

  const [error, setError] = useState<string | null>(null);

  const canGenerate = !!user && !!refImage && !!refVideo && !isGenerating;
  const estimatedCostCredits = useMemo(() => {
    const pricingModelNorm = mode === "pro" ? "kling-2.6-motion-control-pro" : "kling-2.6-motion-control";
    return estimateVideoCostCredits({ modelNorm: pricingModelNorm, isKling: true, durationSeconds: 5 });
  }, [mode]);

  const filteredPickerAssets = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return pickerAssets;

    return pickerAssets.filter((a) => {
      const hay = `${a.name || ""} ${(a.prompt || "")}`.toLowerCase();
      return hay.includes(q);
    });
  }, [pickerAssets, pickerQuery]);

  async function refreshHistory() {
    setHistoryLoading(true);
    try {
      const vids = await listMyAssets({ type: "video", limit: 120 });
      const mc = vids.filter((a) => getMetaTool(a) === "motion-control").sort(byCreatedDesc);
      setHistory(mc);
      setLatest(mc[0] || null);
    } catch (e: any) {
      setError(e?.message || "No se pudo cargar el historial.");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadPickerAssets(nextType: "image" | "video", nextLimit: number) {
    setPickerLoading(true);
    try {
      const res = await listMyAssets({ type: nextType, limit: nextLimit });
      setPickerAssets(res.sort(byCreatedDesc));
    } catch (e: any) {
      setError(e?.message || "No se pudo cargar tu librería.");
    } finally {
      setPickerLoading(false);
    }
  }

  async function openPicker(target: "refImage" | "refVideo") {
    const t = target === "refImage" ? "image" : "video";
    setPickerTarget(target);
    setPickerType(t);
    setPickerQuery("");
    setPickerLimit(60);
    setPickerOpen(true);
    await loadPickerAssets(t, 60);
  }

  async function pickAsset(a: Asset) {
    if (pickerTarget === "refImage") setRefImage(a);
    else setRefVideo(a);
    setPickerOpen(false);
  }

  async function handleDownload(asset: Asset) {
    try {
      await downloadAssetToDisk(asset.id, asset.name || "image");
    } catch (e: any) {
      setError(e?.message || "No se pudo descargar.");
    }
  }

  async function handleDelete(asset: Asset) {
    const ok = window.confirm("¿Seguro que deseas eliminar este video? Esta acción no se puede deshacer.");
    if (!ok) return;

    try {
      await deleteAsset(asset.id);
      setHistory((prev) => prev.filter((x) => x.id !== asset.id));
      if (latest?.id === asset.id) {
        const next = history.filter((x) => x.id !== asset.id);
        setLatest(next[0] || null);
      }
      if (viewer?.id === asset.id) setViewer(null);
    } catch (e: any) {
      setError(e?.message || "No se pudo eliminar.");
    }
  }

  function togglePublish(asset: Asset) {
    window.dispatchEvent(new CustomEvent("tales:open-sell", { detail: { asset } }));
  }

  function cancelWaitOnly() {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = null;
    setIsGenerating(false);
    setProgressMsg("Cancelado. Puedes reanudar más tarde.");
  }

  async function runMotionControlJob(job: PendingMotionControlJob) {
    setIsGenerating(true);
    setProgressMsg("Procesando (Kling)…");
    abortRef.current = new AbortController();

    try {
      const row = await waitJobCompletion(job.jobId, {
        signal: abortRef.current.signal,
        onProgress: (m) => setProgressMsg(m),
        pollMs: 12_000,
      });

      if (row.status === "failed") {
        throw new Error(row.error || "El job falló en background.");
      }

      await refreshHistory();

      clearPending();
      setPendingJob(null);

      setProgressMsg("Listo.");
    } catch (e: any) {
      if (e?.name === "AbortError" || e?.isCanceled) {
        setProgressMsg("Cancelado. Puedes reanudar más tarde.");
        return;
      }
      setError(formatErr(e));
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  }

  async function handleGenerate() {
    if (!user) {
      setError("Necesitas iniciar sesión para usar esta herramienta.");
      return;
    }
    if (!refImage || !refVideo) {
      setError("Selecciona una imagen (personaje) y un video (movimiento).");
      return;
    }

    const finalPrompt = (prompt || "").trim() || "Motion Control";

    setIsGenerating(true);
    setProgressMsg("Encolando…");
    abortRef.current = new AbortController();

    try {
    const start = await apiPostJson<any>(
      "/api/ai/video/motion-control",
      {
        tool: "motion-control",
        nameHint: "motion-control",
        prompt: finalPrompt,
        imageAssetId: refImage.id,
        videoAssetId: refVideo.id,
        keepOriginalSound,
        characterOrientation,
        mode,
        async: true,
      },
      { timeoutMs: 60_000, retries: 0 }
    );

    const jobId = String(start?.jobId || "").trim();
    if (!jobId) throw new Error("No llegó jobId.");

    const job: PendingMotionControlJob = {
      jobId,
      taskId: start?.taskId ? String(start.taskId) : undefined,
      prompt: finalPrompt,
      imageAssetId: refImage.id,
      videoAssetId: refVideo.id,
      keepOriginalSound,
      characterOrientation,
      mode,
      createdAt: Date.now(),
    };

      savePending(job);
      setPendingJob(job);

      await runMotionControlJob(job);
    } catch (e: any) {
      if (e?.name === "AbortError" || e?.isCanceled) {
        setProgressMsg("Cancelado. Puedes reanudar más tarde.");
        return;
      }
      setError(formatErr(e));
      setIsGenerating(false);
      abortRef.current = null;
    }
  }

  async function openViewer(a: Asset) {
    setViewer(a);

    const meta = (a as any)?.meta || {};
    const mc = meta?.motionControl;
    if (!mc?.imageAssetId && !mc?.videoAssetId) {
      setViewerRefImage(null);
      setViewerRefVideo(null);
      return;
    }

    try {
      const [imgs, vids] = await Promise.all([
        mc?.imageAssetId ? listMyAssets({ type: "image", limit: 200 }) : Promise.resolve([] as Asset[]),
        mc?.videoAssetId ? listMyAssets({ type: "video", limit: 200 }) : Promise.resolve([] as Asset[]),
      ]);

      if (mc?.imageAssetId) setViewerRefImage(imgs.find((x) => x.id === mc.imageAssetId) || null);
      if (mc?.videoAssetId) setViewerRefVideo(vids.find((x) => x.id === mc.videoAssetId) || null);
    } catch {
      setViewerRefImage(null);
      setViewerRefVideo(null);
    }
  }

 useEffect(() => {
    void refreshHistory();

    const p = typeof window !== "undefined" ? loadPending() : null;
    if (!p) return;

    setPendingJob(p);
    void runMotionControlJob(p);
  }, []);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <ErrorModal error={error} onClose={() => setError(null)} />

      <div className="glass-panel p-6 rounded-2xl border border-white/10">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Motion Control</h1>
            <p className="text-white/70 mt-1">
              Transfiere movimiento de un video a tu personaje (Kling 2.6 · Motion Control via Fal).
            </p>
          </div>

          <div className="flex gap-2">
            <button
              className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-sm"
              type="button"
              onClick={refreshHistory}
              disabled={historyLoading}
            >
              {historyLoading ? "Cargando…" : "Refrescar historial"}
            </button>
          </div>
        </div>

        {pendingJob && !isGenerating && (
          <div className="mt-4 p-4 rounded-xl border border-amber-500/30 bg-amber-500/10">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <div className="text-xs font-bold tracking-wider text-amber-300 uppercase">Job pendiente</div>
                <div className="text-sm text-white/80 mt-1">
                  Hay una generación en progreso guardada. Si cancelaste o recargaste, puedes reanudarla.
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  className="px-4 py-2 rounded-xl bg-amber-400 text-black font-bold text-xs uppercase hover:opacity-90"
                  onClick={() => runMotionControlJob(pendingJob)}
                >
                  Reanudar
                </button>
                <button
                  type="button"
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-xs uppercase font-bold"
                  onClick={() => {
                    clearPending();
                    setPendingJob(null);
                  }}
                >
                  Descartar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: inputs */}
        <div className="glass-panel p-6 rounded-2xl border border-white/10 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Inputs</h2>
            <div className="text-xs text-white/50">Kling 2.6 Pro</div>
          </div>

          <div className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <div className="text-sm font-semibold">Character Image</div>
              <button
                type="button"
                className="text-xs px-3 py-1 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10"
                onClick={() => openPicker("refImage")}
              >
                Elegir de mi librería
              </button>
            </div>

            <FileUploader
              label="Imagen del personaje"
              accept="image/*"
              uploadTool="motion-control-ref"
              uploadCategory="reference"
              onAssetReady={(a) => setRefImage(a)}
            />

            {refImage && (
              <div className="text-xs text-white/60">
                Seleccionado: <span className="text-white/80 font-mono">{refImage.name}</span>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <div className="text-sm font-semibold">Motion Reference Video</div>
              <button
                type="button"
                className="text-xs px-3 py-1 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10"
                onClick={() => openPicker("refVideo")}
              >
                Elegir de mi librería
              </button>
            </div>

            <FileUploader
              label="Video de movimiento"
              accept="video/*"
              uploadTool="motion-control-ref"
              uploadCategory="reference"
              onAssetReady={(a) => setRefVideo(a)}
            />

            {refVideo && (
              <div className="text-xs text-white/60">
                Seleccionado: <span className="text-white/80 font-mono">{refVideo.name}</span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">
              Prompt (opcional)
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe al personaje y el estilo (opcional). Ej: 'Mujer cyberpunk con chaqueta de cuero, iluminación neón, realista'."
              className="w-full min-h-[110px] rounded-xl bg-black/40 border border-white/10 p-3 text-sm outline-none focus:border-white/30"
              maxLength={14000}
            />
            <div className="text-[11px] text-white/45">
              Tip: el modelo ya usa tu video para el movimiento; el prompt se usa más para consistencia del personaje/estilo.
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                Character orientation
              </div>

              <div className="space-y-2">
                <label className="flex items-start gap-3 p-3 rounded-xl border border-white/10 bg-black/30 cursor-pointer hover:bg-white/5">
                  <input
                    type="radio"
                    name="orientation"
                    checked={characterOrientation === "video"}
                    onChange={() => setCharacterOrientation("video")}
                    className="mt-1"
                  />
                  <div>
                    <div className="text-sm font-semibold">From video</div>
                    <div className="text-xs text-white/60">
                      Mejor si el video tiene el sujeto centrado. Hasta 30s.
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3 rounded-xl border border-white/10 bg-black/30 cursor-pointer hover:bg-white/5">
                  <input
                    type="radio"
                    name="orientation"
                    checked={characterOrientation === "image"}
                    onChange={() => setCharacterOrientation("image")}
                    className="mt-1"
                  />
                  <div>
                    <div className="text-sm font-semibold">From image</div>
                    <div className="text-xs text-white/60">
                      Mantiene la orientación de la imagen. Hasta 10s.
                    </div>
                  </div>
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                Audio
              </div>

              <label className="flex items-start gap-3 p-3 rounded-xl border border-white/10 bg-black/30 cursor-pointer hover:bg-white/5">
                <input
                  type="checkbox"
                  checked={keepOriginalSound}
                  onChange={(e) => setKeepOriginalSound(e.target.checked)}
                  className="mt-1"
                />
                <div>
                  <div className="text-sm font-semibold">Keep original sound</div>
                  <div className="text-xs text-white/60">
                    Conserva el audio del video de referencia (si existe).
                  </div>
                </div>
              </label>

              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ fontWeight: 700, opacity: 0.9 }}>Output:</div>

                <button
                  type="button"
                  onClick={() => setMode("std")}
                  disabled={isGenerating}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: mode === "std" ? "rgba(255,255,255,0.15)" : "transparent",
                    cursor: "pointer",
                  }}
                >
                  720p
                </button>

                <button
                  type="button"
                  onClick={() => setMode("pro")}
                  disabled={isGenerating}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: mode === "pro" ? "rgba(255,255,255,0.15)" : "transparent",
                    cursor: "pointer",
                  }}
                >
                  1080p
                </button>
              </div>

              {isGenerating ? (
                <button
                  type="button"
                  className="w-full px-4 py-3 rounded-xl bg-white text-black font-bold text-sm uppercase hover:opacity-90 mt-2"
                  onClick={cancelWaitOnly}
                >
                  Cancelar (solo espera)
                </button>
              ) : (
                <button
                  type="button"
                  className={`w-full px-4 py-3 rounded-xl font-bold text-sm uppercase mt-2 ${
                    canGenerate
                      ? "bg-white text-black hover:opacity-90"
                      : "bg-white/10 text-white/40 border border-white/10 cursor-not-allowed"
                  }`}
                  onClick={handleGenerate}
                  disabled={!canGenerate}
                >
                  Generar motion control
                </button>
              )}

              <div className="text-xs text-white/60 mt-2 text-center">
                Coste estimado: <span className="font-semibold text-white/85">{estimatedCostCredits}</span> créditos
              </div>

              {progressMsg && (
                <div className="text-xs text-white/60 mt-2">
                  Estado: <span className="font-mono text-white/80">{progressMsg}</span>
                </div>
              )}
            </div>
          </div>

          <div className="text-xs text-white/45 border-t border-white/10 pt-4 space-y-2">
            <div className="font-bold text-white/60 uppercase tracking-wider text-[11px]">
              Requisitos del video
            </div>
            <ul className="list-disc pl-5 space-y-1">
              <li>El sujeto debe estar visible en todo el video (sin cortes).</li>
              <li>Plano medio o primer plano funciona mejor.</li>
              <li>Evita cambios bruscos de iluminación o cámara.</li>
              <li>Si tu video pesa mucho, exporta a 720p/1080p para subir más rápido.</li>
            </ul>
          </div>
        </div>

        {/* Right: preview */}
        <div className="glass-panel p-6 rounded-2xl border border-white/10 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Preview</h2>
            {latest?.isPublic ? (
              <span className="text-xs px-2 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-200">
                PUBLIC
              </span>
            ) : latest ? (
              <span className="text-xs px-2 py-1 rounded-lg bg-white/10 border border-white/10 text-white/60">
                PRIVATE
              </span>
            ) : null}
          </div>

          {latest ? (
            <div className="rounded-2xl overflow-hidden border border-white/10 bg-black/40">
              <video src={latest.url} controls playsInline className="w-full h-auto" />
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-black/40 aspect-video flex items-center justify-center text-white/40">
              Aún no hay videos generados en Motion Control.
            </div>
          )}

          {latest && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-sm"
                onClick={() => openViewer(latest)}
              >
                Ver detalles
              </button>

              <button
                type="button"
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-sm"
                title="Vender / Administrar listing"
                onClick={() => togglePublish(latest)}
              >
                Vender / Administrar listing
              </button>

              <button
                type="button"
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-sm"
                onClick={() => handleDownload(latest)}
              >
                Descargar
              </button>

              <button
                type="button"
                className="px-4 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-sm text-red-200"
                onClick={() => handleDelete(latest)}
              >
                Eliminar
              </button>
            </div>
          )}

          <div className="border-t border-white/10 pt-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                Historial (Motion Control)
              </div>

              <div className="text-xs text-white/50">
                {historyLoading ? "Cargando…" : `${history.length} videos`}
              </div>
            </div>

            {historyLoading ? (
              <div className="text-sm text-white/50">Cargando…</div>
            ) : history.length === 0 && !pendingJob ? (
              <div className="text-sm text-white/40">Todavía no hay generaciones aquí.</div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {pendingJob && (
                  <div className="rounded-xl overflow-hidden border border-amber-400/20 bg-black/40">
                    <div className="aspect-video bg-black/60 relative overflow-hidden">
                      <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-white/10 via-white/5 to-transparent" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="px-3 py-1 rounded-full border border-amber-400/30 bg-amber-400/10 text-[11px] uppercase tracking-wider text-amber-200 font-bold">
                          Generando...
                        </div>
                      </div>
                    </div>
                    <div className="p-2 text-left">
                      <div className="text-xs text-white/80">
                        {(pendingJob.prompt || "Motion Control").trim()}
                      </div>
                      <div className="text-[11px] text-amber-200/80 mt-1">
                        {progressMsg || "En curso"}
                      </div>
                    </div>
                  </div>
                )}

                {history.slice(0, 12).map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="rounded-xl overflow-hidden border border-white/10 bg-black/40 hover:border-white/20 transition"
                    onClick={() => openViewer(a)}
                    title="Abrir"
                  >
                    <div className="aspect-video bg-black/60">
                      <video src={a.url} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                    </div>
                    <div className="p-2 text-left">
                      <div className="text-xs text-white/80">
                        {(a.prompt || a.name || "—").trim()}
                      </div>
                      <div className="text-[11px] text-white/40 mt-1">
                        {new Date(a.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {history.length > 12 && (
              <div className="mt-3 text-xs text-white/45">
                Mostrando 12 de {history.length}. El resto lo encuentras en <span className="text-white/70">My Creations</span>.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Picker modal */}
      {pickerOpen && (
        <div className="fixed inset-0 z-[5000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-4xl rounded-2xl border border-white/10 bg-[#0a0a0a] overflow-hidden">
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">Mi librería</div>
                <div className="text-lg font-bold">
                  {pickerType === "image" ? "Selecciona una imagen" : "Selecciona un video"}
                </div>
              </div>

              <button
                type="button"
                className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-sm"
                onClick={() => setPickerOpen(false)}
              >
                Cerrar
              </button>
            </div>

            <div className="p-4 border-b border-white/10 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
              <input
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                placeholder="Buscar por nombre o prompt…"
                className="w-full md:max-w-md rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm outline-none focus:border-white/30"
              />

              <div className="flex gap-2">
                <button
                  type="button"
                  className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-sm"
                  disabled={pickerLoading}
                  onClick={() => {
                    const next = pickerLimit + 60;
                    setPickerLimit(next);
                    loadPickerAssets(pickerType, next);
                  }}
                >
                  {pickerLoading ? "Cargando…" : "Cargar más"}
                </button>
              </div>
            </div>

            <div className="p-4 max-h-[70vh] overflow-auto">
              {pickerLoading ? (
                <div className="text-sm text-white/50">Cargando…</div>
              ) : filteredPickerAssets.length === 0 ? (
                <div className="text-sm text-white/40">
                  No hay resultados. Sube un asset con el botón de arriba (Upload) o genera en otras herramientas.
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {filteredPickerAssets.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className="rounded-xl overflow-hidden border border-white/10 bg-black/40 hover:border-white/20 transition text-left"
                      onClick={() => pickAsset(a)}
                    >
                      <div className="aspect-video bg-black/60">
                        {pickerType === "video" ? (
                          <video src={a.url} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                        ) : (
                          <img src={a.url} alt={a.name} className="w-full h-full object-cover" />
                        )}
                      </div>
                      <div className="p-2">
                        <div className="text-xs text-white/80">{(a.prompt || a.name || "—").trim()}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Viewer modal */}
      {viewer && (
        <div className="fixed inset-0 z-[6000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setViewer(null)}>
          <div className="w-full max-w-5xl rounded-2xl border border-white/10 bg-[#0a0a0a] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">Motion Control</div>
                <div className="text-lg font-bold">Detalles</div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-sm"
                  title="Vender / Administrar listing"
                  onClick={() => togglePublish(viewer)}
                >
                  Vender / Administrar listing
                </button>
                <button
                  type="button"
                  className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-sm"
                  onClick={() => handleDownload(viewer)}
                >
                  Descargar
                </button>
                <button
                  type="button"
                  className="px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-sm text-red-200"
                  onClick={() => handleDelete(viewer)}
                >
                  Eliminar
                </button>
                <button
                  type="button"
                  className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-sm"
                  onClick={() => setViewer(null)}
                >
                  Cerrar
                </button>
              </div>
            </div>

            <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-2xl overflow-hidden border border-white/10 bg-black/40">
                <video src={viewer.url} controls autoPlay loop playsInline className="w-full h-auto" />
              </div>

              <div className="space-y-4">
                <div className="p-4 rounded-2xl border border-white/10 bg-black/40">
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">Prompt</div>
                  <div className="text-sm text-white/80 mt-2 whitespace-pre-wrap">{viewer.prompt || "—"}</div>
                </div>

                <div className="p-4 rounded-2xl border border-white/10 bg-black/40 space-y-3">
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">Recipe</div>

                  <RecipeRow label="Model" value={(viewer as any)?.meta?.model || "—"} />
                  <RecipeRow label="Endpoint" value={(viewer as any)?.meta?.falEndpointId || "—"} />
                  <RecipeRow label="RequestId" value={(viewer as any)?.meta?.requestId || "—"} />

                  <div className="pt-2 border-t border-white/10" />

                  <RecipeRow label="Orientation" value={(viewer as any)?.meta?.motionControl?.characterOrientation || "—"} />
                  <RecipeRow label="Keep sound" value={(viewer as any)?.meta?.motionControl?.keepOriginalSound ? "yes" : "no"} />

                  <div className="pt-2 border-t border-white/10" />

                  <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">References</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl overflow-hidden border border-white/10 bg-black/60">
                      {viewerRefImage ? (
                        <img src={viewerRefImage.url} alt={viewerRefImage.name} className="w-full h-full object-cover aspect-video" />
                      ) : (
                        <div className="aspect-video flex items-center justify-center text-white/30 text-xs">
                          (imagen no disponible)
                        </div>
                      )}
                      <div className="p-2 text-[11px] text-white/60">Character image</div>
                    </div>

                    <div className="rounded-xl overflow-hidden border border-white/10 bg-black/60">
                      {viewerRefVideo ? (
                        <video src={viewerRefVideo.url} muted playsInline preload="metadata" className="w-full h-full object-cover aspect-video" />
                      ) : (
                        <div className="aspect-video flex items-center justify-center text-white/30 text-xs">
                          (video no disponible)
                        </div>
                      )}
                      <div className="p-2 text-[11px] text-white/60">Motion video</div>
                    </div>
                  </div>
                </div>

                <div className="text-[11px] text-white/40">
                  Nota: Las URLs de referencias son firmadas y pueden expirar. Si no aparecen, refresca o vuelve a abrir el modal.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RecipeRow({ label, value }: { label: string; value: any }) {
  const v = value == null || value === "" ? "—" : String(value);
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-xs text-white/50">{label}</div>
      <div className="text-xs text-white/80 font-mono text-right break-all">{v}</div>
    </div>
  );
}
