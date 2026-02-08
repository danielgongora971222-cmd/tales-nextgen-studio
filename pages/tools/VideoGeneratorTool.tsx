import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "./VideoGeneratorTool.module.css";
import ErrorModal from "../../components/ErrorModal";
import { listMyAssets, uploadUserAsset } from "../../services/assetsApi";
import { supabase } from "../../services/supabaseClient";
import type { Asset } from "../../types";

type PanelKey = "model" | "parameters" | "duration" | null;

type FrameSlotKey = "first" | "last";

type VideoGenItem = { url: string; assetId: string };

type VideoGenResponse =
  | { ok: true; items: VideoGenItem[]; urlExpiresInSeconds?: number }
  | { ok: false; error: any };

const TOOL_ID = "video-generator";
const FRAME_UPLOAD_TOOL = "video-gen-frame";

const VEO_3 = "veo-3.0-generate-001";
const VEO_3_FAST = "veo-3.0-fast-generate-001";
const VEO_3_1 = "veo-3.1-generate-preview";
const VEO_3_1_FAST = "veo-3.1-fast-generate-preview";

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
function formatErr(err: any): string {
  const s = getStatus(err);
  const m = getErrMsg(err);
  return s ? `${m} (HTTP ${s})` : m;
}

async function apiPostJson<T>(path: string, body: any): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const resp = await fetch(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  let data: any = null;
  try {
    data = await resp.json();
  } catch {
    data = null;
  }

  if (!resp.ok || data?.ok === false) {
    const e = data?.error ?? data ?? { message: `Request failed: ${resp.status}` };
    const msg =
      typeof e === "string"
        ? e
        : e?.message || e?.error || `Request failed: ${resp.status}`;
    const details = e?.details ? `\n\nDetalles:\n${JSON.stringify(e.details, null, 2)}` : "";
    throw new Error(`${e?.code ? `${e.code}: ` : ""}${msg}${details}`);
  }

  return data as T;
}

function clampInt(n: any, min: number, max: number, fallback: number) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

function shortText(s?: string, max = 60) {
  const t = (s || "").trim().replace(/\s+/g, " ");
  if (!t) return "";
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

const VideoGeneratorTool: React.FC = () => {
  const [error, setError] = useState<string | null>(null);

  // Core
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<string>(VEO_3_1);
  const [panel, setPanel] = useState<PanelKey>(null);

  // Frames (First / Last)
  const [firstFrame, setFirstFrame] = useState<Asset | null>(null);
  const [lastFrame, setLastFrame] = useState<Asset | null>(null);

  // Params
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16">("16:9");
  const [resolution, setResolution] = useState<"720p" | "1080p" | "4k">("720p");
  const [count, setCount] = useState<number>(1);

  // Duration
  const [durationSeconds, setDurationSeconds] = useState<number>(8);

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);

  // Assets
  const [imageAssets, setImageAssets] = useState<Asset[]>([]);
  const [videoAssets, setVideoAssets] = useState<Asset[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const selectedVideo = useMemo(
    () => videoAssets.find((a) => a.id === selectedVideoId) || null,
    [videoAssets, selectedVideoId]
  );

  // Picker modal
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSlot, setPickerSlot] = useState<FrameSlotKey>("first");
  const [pickerQuery, setPickerQuery] = useState("");

  const popoverRef = useRef<HTMLDivElement>(null);

  const hasFirst = !!firstFrame;
  const hasLast = !!lastFrame;

  const isVeo30 = model.startsWith("veo-3.0");
  const isVeo31 = model.startsWith("veo-3.1");

  // Allowed durations logic (según tu regla)
  const allowedDurations = useMemo(() => {
    // Veo 3 / Veo 3 Fast: en Gemini API es 8s fijo
    if (isVeo30) return [8] as const;

    // Veo 3.1: 8s obligatorio si 1080p/4k o si usas imágenes (first/last)
    if (hasFirst || hasLast) return [8] as const;
    if (resolution === "720p") return [4, 6, 8] as const;
    return [8] as const;
  }, [isVeo30, hasFirst, hasLast, resolution]);

  const supportedResolutions = useMemo(() => {
    return isVeo30 ? (["720p", "1080p"] as const) : (["720p", "1080p", "4k"] as const);
  }, [isVeo30]);

  useEffect(() => {
    if (isVeo30 && resolution === "4k") setResolution("1080p");
  }, [isVeo30, resolution]);

  useEffect(() => {
    if (isVeo30 && !hasFirst && resolution === "1080p" && aspectRatio === "9:16") {
      setAspectRatio("16:9");
    }
  }, [isVeo30, hasFirst, resolution, aspectRatio]);

  useEffect(() => {
    if (!hasLast) return;
    if (!isVeo30) return;

    // Mantener "fast" si venías en fast
    const wantsFast = model.includes("-fast-");
    setModel(wantsFast ? VEO_3_1_FAST : VEO_3_1);
  }, [hasLast, isVeo30, model]);

  // Si cambia allowedDurations, ajusta duration si no es válido
  useEffect(() => {
    if (!allowedDurations.includes(durationSeconds)) {
      setDurationSeconds(allowedDurations[0] || 8);
    }
  }, [allowedDurations, durationSeconds]);

  // Si quitas el first frame, también se limpia el last (tu regla)
  useEffect(() => {
    if (!hasFirst && hasLast) {
      setLastFrame(null);
    }
  }, [hasFirst, hasLast]);

  // Cargar assets (imágenes para picker + videos para historial)
  useEffect(() => {
    (async () => {
      try {
        const [imgs, vids] = await Promise.all([
          listMyAssets({ type: "image", limit: 200 }),
          listMyAssets({ type: "video", limit: 80 }),
        ]);
        setImageAssets(imgs);
        setVideoAssets(vids);

        if (!selectedVideoId && vids.length > 0) {
          setSelectedVideoId(vids[0].id);
        }
      } catch (e: any) {
        // no lo vuelvo “fatal” para no bloquear UI
        console.warn(e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cerrar popover al click afuera
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!panel) return;
      const el = popoverRef.current;
      if (el && !el.contains(e.target as any)) {
        setPanel(null);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [panel]);

  const modelLabel = useMemo(() => {
    if (model === VEO_3) return "Veo 3";
    if (model === VEO_3_FAST) return "Veo 3 Fast";
    if (model === VEO_3_1) return "Veo 3.1";
    if (model === VEO_3_1_FAST) return "Veo 3.1 Fast";
    return model;
  }, [model]);

  const paramsLabel = useMemo(() => {
    const ar = hasFirst ? "Auto" : aspectRatio;
    return `${ar} • ${resolution} • x${count}`;
  }, [hasFirst, aspectRatio, resolution, count]);

  const durationLabel = useMemo(() => `${durationSeconds}s`, [durationSeconds]);

  const openPicker = (slot: FrameSlotKey) => {
    if (slot === "last" && !hasFirst) return; // bloquea last si no hay first
    setPanel(null);
    setPickerSlot(slot);
    setPickerQuery("");
    setPickerOpen(true);
  };

  const setFrameFromAsset = (slot: FrameSlotKey, asset: Asset) => {
    if (slot === "first") {
      setFirstFrame(asset);
    } else {
      if (!hasFirst) return;
      setLastFrame(asset);
    }
    setPickerOpen(false);
  };

  const clearFrame = (slot: FrameSlotKey) => {
    if (slot === "first") {
      setFirstFrame(null);
      setLastFrame(null); // regla: al limpiar first se limpia last
    } else {
      setLastFrame(null);
    }
  };

  const swapFrames = () => {
    // Solo si hay ambas (para respetar tu regla de bloqueo)
    if (!firstFrame || !lastFrame) return;
    const a = firstFrame;
    const b = lastFrame;
    setFirstFrame(b);
    setLastFrame(a);
  };

  const handleUploadForSlot = async (slot: FrameSlotKey, file: File) => {
    try {
      const asset = await uploadUserAsset(file, FRAME_UPLOAD_TOOL);
      // Añádelo al historial de imágenes (para que aparezca inmediatamente)
      setImageAssets((prev) => [asset, ...prev]);
      setFrameFromAsset(slot, asset);
    } catch (e: any) {
      setError(formatErr(e));
    }
  };

  const filteredPickerAssets = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    const base = imageAssets.filter((a) => a.type === "image" && a.url);
    if (!q) return base;
    return base.filter((a) => {
      const t = `${a.name || ""} ${a.prompt || ""}`.toLowerCase();
      return t.includes(q);
    });
  }, [imageAssets, pickerQuery]);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setIsGenerating(true);
    setError(null);

    try {
      const body: any = {
        prompt,
        model, // Veo 3 / 3.1
        tool: TOOL_ID,
        nameHint: "video",
        resolution,
        count: clampInt(count, 1, 4, 1),
        durationSeconds: Number(durationSeconds),
      };

      if (firstFrame?.id) body.firstFrameAssetId = firstFrame.id;
      if (lastFrame?.id) body.lastFrameAssetId = lastFrame.id;

      // si NO hay first frame, se permite escoger aspect ratio
      if (!firstFrame) body.aspectRatio = aspectRatio;

      const res = await apiPostJson<VideoGenResponse>("/api/ai/video", body);

      if (!("ok" in res) || (res as any).ok !== true) {
        throw new Error("Respuesta inválida del backend.");
      }

      const items = Array.isArray((res as any).items) ? (res as any).items : [];
      if (!items.length) throw new Error("No se devolvió ningún video.");

      // Creamos assets locales (rápido) y los añadimos al historial
      const now = Date.now();
      const newAssets: Asset[] = items.map((it: VideoGenItem, idx: number) => ({
        id: it.assetId || `${now}_${idx}`,
        url: it.url,
        type: "video",
        name: `video_${now}_${idx + 1}`,
        prompt,
        createdAt: now,
        ownerId: "me",
        isPublic: false,
        likes: [],
        comments: [],
        meta: {
          model,
          aspectRatio: firstFrame ? "auto" : aspectRatio,
          resolution,
          durationSeconds: Number(durationSeconds),
          firstFrameAssetId: firstFrame?.id || null,
          lastFrameAssetId: lastFrame?.id || null,
        },
      }));

      setVideoAssets((prev) => [...newAssets, ...prev]);
      setSelectedVideoId(newAssets[0].id);
    } catch (e: any) {
      setError(formatErr(e));
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className={styles.root}>
      <ErrorModal error={error} onClose={() => setError(null)} />

      <div className={styles.topBar}>
        <div className={styles.titleWrap}>
          <div className={styles.title}>GENERAL VIDEO GENERATOR</div>
          <div className={styles.hint}>
            Veo 3 / 3.1 • First/Last frame • Historial guardado en assets
          </div>
        </div>
        <div className={styles.badges}>
          <span className={styles.badge}>{modelLabel}</span>
          <span className={styles.badgeDim}>{hasFirst ? "Frames: ON" : "Frames: OFF"}</span>
        </div>
      </div>

      <div className={styles.shell}>
        {/* LEFT: stage */}
        <div className={styles.stage}>
          <div className={styles.stageHeader}>
            <div className={styles.kicker}>Output</div>
            <div className={styles.stageMeta}>
              <span className={styles.metaPill}>{paramsLabel}</span>
              <span className={styles.metaPill}>{durationLabel}</span>
            </div>
          </div>

          <div className={styles.viewer}>
            {selectedVideo?.url ? (
              <video
                className={styles.viewerVideo}
                src={selectedVideo.url}
                controls
                autoPlay
                loop
                playsInline
              />
            ) : (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}>
                  <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M15 10l4.553-2.276A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14v1a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v1z"
                    />
                  </svg>
                </div>
                <div className={styles.emptyText}>Aún no hay video seleccionado</div>
                <div className={styles.emptySub}>Genera uno o elige del historial</div>
              </div>
            )}
          </div>

          {/* Dock prompt + frames */}
          <div className={styles.promptArea}>
            <div className={styles.promptRow}>
              <div className={styles.promptInputWrap}>
                <div className={styles.frameDock}>
                  {/* FIRST */}
                  <button
                    type="button"
                    className={styles.frameBox}
                    onClick={() => openPicker("first")}
                    title="First Frame"
                    aria-label="First Frame"
                  >
                    {firstFrame?.url ? (
                      <>
                        <img className={styles.frameImg} src={firstFrame.url} alt="First frame" />
                        <span className={styles.frameTag}>FIRST</span>
                        <span
                          className={styles.frameX}
                          onClick={(e) => {
                            e.stopPropagation();
                            clearFrame("first");
                          }}
                          role="button"
                          aria-label="Remove first frame"
                        >
                          ×
                        </span>
                      </>
                    ) : (
                      <>
                        <div className={styles.frameEmpty}>FIRST</div>
                        <div className={styles.frameHint}>Pick / Upload</div>
                      </>
                    )}
                  </button>

                  {/* SWAP */}
                  <button
                    type="button"
                    className={styles.swapBtn}
                    onClick={swapFrames}
                    disabled={!firstFrame || !lastFrame}
                    title="Swap frames"
                    aria-label="Swap frames"
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M7 7h11l-2.5-2.5L17 3l6 6-6 6-1.5-1.5L18 9H7V7zm10 10H6l2.5 2.5L7 21l-6-6 6-6 1.5 1.5L6 15h11v2z"
                      />
                    </svg>
                  </button>

                  {/* LAST */}
                  <button
                    type="button"
                    className={`${styles.frameBox} ${!hasFirst ? styles.frameBoxLocked : ""}`}
                    onClick={() => openPicker("last")}
                    title={!hasFirst ? "Carga FIRST para desbloquear LAST" : "Last Frame"}
                    aria-label="Last Frame"
                    disabled={!hasFirst}
                  >
                    {lastFrame?.url ? (
                      <>
                        <img className={styles.frameImg} src={lastFrame.url} alt="Last frame" />
                        <span className={styles.frameTag}>LAST</span>
                        <span
                          className={styles.frameX}
                          onClick={(e) => {
                            e.stopPropagation();
                            clearFrame("last");
                          }}
                          role="button"
                          aria-label="Remove last frame"
                        >
                          ×
                        </span>
                      </>
                    ) : (
                      <>
                        <div className={styles.frameEmpty}>LAST</div>
                        <div className={styles.frameHint}>{hasFirst ? "Pick / Upload" : "Locked"}</div>
                      </>
                    )}
                  </button>
                </div>

                <div className={styles.promptEditor}>
                  <textarea
                    className={styles.prompt}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Describe el video… (ej: cinematic neon city, rain, slow dolly in, high detail)"
                    rows={2}
                  />
                </div>
              </div>

              <div className={styles.generateCol}>
                <button
                  type="button"
                  className={styles.generateBtn}
                  disabled={isGenerating || !prompt.trim()}
                  onClick={handleGenerate}
                  data-loading={isGenerating ? "true" : "false"}
                >
                  <span className={styles.generateLabel}>{isGenerating ? "GENERATING" : "GENERATE"}</span>
                  {isGenerating && <span className={styles.generateSpinner} aria-hidden="true" />}
                </button>
              </div>
            </div>

            {/* Controls row (sin Reference, como pediste) */}
            <div className={styles.controlsRow}>
              <button
                type="button"
                className={`${styles.controlBtn} ${panel === "model" ? styles.controlBtnActive : ""}`}
                onClick={() => setPanel((p) => (p === "model" ? null : "model"))}
              >
                <span>Model</span>
                <span className={styles.controlBtnMeta}>{modelLabel}</span>
              </button>

              <button
                type="button"
                className={`${styles.controlBtn} ${panel === "parameters" ? styles.controlBtnActive : ""}`}
                onClick={() => setPanel((p) => (p === "parameters" ? null : "parameters"))}
              >
                <span>Parameters</span>
                <span className={styles.controlBtnMeta}>{paramsLabel}</span>
              </button>

              <button
                type="button"
                className={`${styles.controlBtn} ${panel === "duration" ? styles.controlBtnActive : ""}`}
                onClick={() => setPanel((p) => (p === "duration" ? null : "duration"))}
              >
                <span>Duration</span>
                <span className={styles.controlBtnMeta}>{durationLabel}</span>
              </button>
            </div>

            {/* Popovers */}
            {panel && (
              <div ref={popoverRef} className={styles.popover}>
                {/* MODEL */}
                {panel === "model" && (
                  <div className={styles.popoverInner}>
                    <div className={styles.popoverHeader}>
                      <div className={styles.popoverTitle}>Model</div>
                      <button className={styles.closeBtn} onClick={() => setPanel(null)} type="button">
                        ×
                      </button>
                    </div>

                    <div className={styles.modelGrid}>
                      <button
                        className={`${styles.modelOption} ${model === VEO_3 ? styles.modelOptionActive : ""}`}
                        onClick={() => setModel(VEO_3)}
                      >
                        <div className={styles.modelName}>Veo 3</div>
                        <div className={styles.modelDesc}>Stable · con audio · 8s</div>
                      </button>

                      <button
                        className={`${styles.modelOption} ${model === VEO_3_FAST ? styles.modelOptionActive : ""}`}
                        onClick={() => setModel(VEO_3_FAST)}
                      >
                        <div className={styles.modelName}>Veo 3 Fast</div>
                        <div className={styles.modelDesc}>Más barato · más rápido · 8s</div>
                      </button>

                      <button
                        className={`${styles.modelOption} ${model === VEO_3_1 ? styles.modelOptionActive : ""}`}
                        onClick={() => setModel(VEO_3_1)}
                      >
                        <div className={styles.modelName}>Veo 3.1</div>
                        <div className={styles.modelDesc}>Preview · 4/6/8s · 4k</div>
                      </button>

                      <button
                        className={`${styles.modelOption} ${model === VEO_3_1_FAST ? styles.modelOptionActive : ""}`}
                        onClick={() => setModel(VEO_3_1_FAST)}
                      >
                        <div className={styles.modelName}>Veo 3.1 Fast</div>
                        <div className={styles.modelDesc}>Preview · rápido · 4k</div>
                      </button>
                    </div>

                    <div className={styles.note}>
                      Tip: si usas <b>LAST frame</b>, el backend puede forzar Veo 3.1 automáticamente.
                    </div>
                  </div>
                )}

                {/* PARAMETERS */}
                {panel === "parameters" && (
                  <div className={styles.popoverInner}>
                    <div className={styles.popoverHeader}>
                      <div className={styles.popoverTitle}>Parameters</div>
                      <button className={styles.closeBtn} onClick={() => setPanel(null)} type="button">
                        ×
                      </button>
                    </div>

                    <div className={styles.formRow}>
                      <label className={styles.formLabel}>Aspect Ratio</label>
                      <div className={styles.segment}>
                        <button
                          type="button"
                          className={`${styles.segmentBtn} ${hasFirst ? styles.segmentBtnDisabled : ""} ${
                            !hasFirst && aspectRatio === "16:9" ? styles.segmentBtnActive : ""
                          }`}
                          onClick={() => !hasFirst && setAspectRatio("16:9")}
                          disabled={hasFirst}
                        >
                          16:9
                        </button>
                        <button
                          type="button"
                          className={`${styles.segmentBtn} ${hasFirst ? styles.segmentBtnDisabled : ""} ${
                            !hasFirst && aspectRatio === "9:16" ? styles.segmentBtnActive : ""
                          }`}
                          onClick={() => !hasFirst && setAspectRatio("9:16")}
                          disabled={hasFirst}
                        >
                          9:16
                        </button>
                        <div className={styles.segmentMeta}>{hasFirst ? "AUTO (por First Frame)" : "Manual"}</div>
                      </div>
                    </div>

                    <div className={styles.formRow}>
                      <label className={styles.formLabel}>Resolution</label>
                      <div className={styles.segment}>
                        {supportedResolutions.map((r) => (
                          <button
                            key={r}
                            className={`${styles.segmentBtn} ${resolution === r ? styles.segmentBtnActive : ""}`}
                            onClick={() => setResolution(r)}
                          >
                            {r.toUpperCase()}
                          </button>
                        ))}
                      </div>
                      <div className={styles.noteSmall}>
                        Nota: 1080p/4k fuerzan 8s por reglas del modelo.
                      </div>
                    </div>

                    <div className={styles.formRow}>
                      <label className={styles.formLabel}>Count</label>
                      <div className={styles.segment}>
                        {/* por ahora dejamos 1 (Veo suele devolver 1 por request) */}
                        {[1].map((c) => (
                          <button
                            key={c}
                            type="button"
                            className={`${styles.segmentBtn} ${count === c ? styles.segmentBtnActive : ""}`}
                            onClick={() => setCount(c)}
                          >
                            x{c}
                          </button>
                        ))}
                        <div className={styles.segmentMeta}>Actualmente: 1 por request</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* DURATION */}
                {panel === "duration" && (
                  <div className={styles.popoverInner}>
                    <div className={styles.popoverHeader}>
                      <div className={styles.popoverTitle}>Duration</div>
                      <button className={styles.closeBtn} onClick={() => setPanel(null)} type="button">
                        ×
                      </button>
                    </div>

                    <div className={styles.durationGrid}>
                      {allowedDurations.map((d) => (
                        <button
                          key={d}
                          type="button"
                          className={`${styles.durationOption} ${durationSeconds === d ? styles.durationOptionActive : ""}`}
                          onClick={() => setDurationSeconds(d)}
                        >
                          {d}s
                        </button>
                      ))}
                    </div>

                    <div className={styles.note}>
                      {hasFirst
                        ? "Con frames (First/Last) la duración es 8s."
                        : resolution !== "720p"
                          ? "Con 1080p/4k la duración es 8s."
                          : "Con 720p sin frames puedes elegir 4/6/8s."}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: History */}
        <div className={styles.history}>
          <div className={styles.historyHeader}>
            <div className={styles.kicker}>Session History</div>
            <div className={styles.historyCount}>{videoAssets.length}</div>
          </div>

          <div className={styles.historyGrid}>
            {videoAssets.length === 0 ? (
              <div className={styles.historyEmpty}>Aún no has generado videos.</div>
            ) : (
              videoAssets.map((v) => {
                const active = v.id === selectedVideoId;
                return (
                  <button
                    key={v.id}
                    type="button"
                    className={`${styles.historyTile} ${active ? styles.historyTileActive : ""}`}
                    onClick={() => setSelectedVideoId(v.id)}
                    title={v.prompt || v.name}
                  >
                    <div className={styles.historyThumb}>
                      <video
                        className={styles.historyThumbVideo}
                        src={v.url}
                        muted
                        playsInline
                        preload="metadata"
                      />
                      <div className={styles.historyThumbOverlay}>
                        <div className={styles.historyThumbTitle}>
                          {shortText(v.prompt || v.name, 52)}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Picker modal */}
      {pickerOpen && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>
                Pick {pickerSlot === "first" ? "FIRST" : "LAST"} Frame
              </div>
              <button className={styles.modalClose} onClick={() => setPickerOpen(false)} type="button">
                ×
              </button>
            </div>

            <div className={styles.modalActions}>
              <input
                className={styles.search}
                placeholder="Search in history..."
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
              />

              <label className={styles.uploadBtn}>
                Upload
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUploadForSlot(pickerSlot, f);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
            </div>

            <div className={styles.pickerGrid}>
              {filteredPickerAssets.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={styles.pickerTile}
                  onClick={() => setFrameFromAsset(pickerSlot, a)}
                >
                  <img src={a.url} alt={a.name} />
                  <div className={styles.pickerCap}>
                    {shortText(a.prompt || a.name, 56)}
                  </div>
                </button>
              ))}
            </div>

            {pickerSlot === "last" && !hasFirst && (
              <div className={styles.modalNote}>
                LAST está bloqueado: primero carga FIRST.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoGeneratorTool;
