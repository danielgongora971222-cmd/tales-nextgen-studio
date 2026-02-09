import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "./VideoGeneratorTool.module.css";
import ErrorModal from "../../components/ErrorModal";
import { listMyAssets, uploadUserAsset } from "../../services/assetsApi";
import { supabase } from "../../services/supabaseClient";
import type { Asset } from "../../types";
import { listKlingElements, type KlingElement } from "../../services/klingElementsService";

type PanelKey = "model" | "parameters" | "duration" | null;

type FrameSlotKey = "first" | "last";

type VideoGenItem = { url: string; assetId: string };

type VideoGenResponse =
  | { ok: true; items: VideoGenItem[]; urlExpiresInSeconds?: number }
  | { ok: false; error: any };

type KlingV3Shot = { prompt: string; durationSeconds: number };

const TOOL_ID = "video-generator";
const FRAME_UPLOAD_TOOL = "video-gen-frame";

const VEO_3 = "veo-3.0-generate-001";
const VEO_3_FAST = "veo-3.0-fast-generate-001";
const VEO_3_1 = "veo-3.1-generate-preview";
const VEO_3_1_FAST = "veo-3.1-fast-generate-preview";
const KLING_2_5_TURBO = "kling-v2-5-turbo";
const KLING_2_6 = "kling-v2-6";
const KLING_V3 = "kling-v3";

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

  // A veces un 502 viene como HTML (gateway) y resp.json() falla.
  // Leemos texto y luego intentamos parsear JSON.
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

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitFalJob(jobToken: string, maxWaitMs = 15 * 60 * 1000) {
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
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const [resolution, setResolution] = useState<"720p" | "1080p" | "4k">("720p");
  const [count, setCount] = useState<number>(1);
  const [klingSound, setKlingSound] = useState<boolean>(false);
  const [klingSoundTouched, setKlingSoundTouched] = useState<boolean>(false);
  const [klingMode, setKlingMode] = useState<"std" | "pro">("std");

  // ===============================
  // Kling V3 (Fal) — Elements + Multishot + Params
  // ===============================
  const [klingElements, setKlingElements] = useState<KlingElement[]>([]);
  const [elementsOpen, setElementsOpen] = useState(false);
  const [elementsQuery, setElementsQuery] = useState("");
  const [selectedKlingElementIds, setSelectedKlingElementIds] = useState<string[]>([]);

  const [multishotEnabled, setMultishotEnabled] = useState(false);
  const [multishotOpen, setMultishotOpen] = useState(false);
  const [klingShots, setKlingShots] = useState<KlingV3Shot[]>([
    { prompt: "", durationSeconds: 3 },
    { prompt: "", durationSeconds: 3 },
  ]);
  const [klingShotType, setKlingShotType] = useState<"customize" | "intelligent">("customize");

  // V3 extra params
  const [negativePrompt, setNegativePrompt] = useState("");
  const [klingCfgScale, setKlingCfgScale] = useState<number>(0.5);
  const [klingVoiceIdsText, setKlingVoiceIdsText] = useState("");

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
  const isKling = model.startsWith("kling-");
  const isKlingV2 = model === KLING_2_5_TURBO || model === KLING_2_6;
  const isKlingV3 = model === KLING_V3;




  const capability = useMemo(() => {
    if (model === KLING_2_5_TURBO || model === KLING_2_6) {
      return {
        supportsResolution: false,
        supportsAspectRatio: !hasFirst,
        supportsAspectRatio1x1: !hasFirst,
        durations: [5, 10] as const,
        supportsSound: model === KLING_2_6 && klingMode === "pro",
        supportsLastFrame: true,
      };
    }

    if (model === KLING_V3) {
      return {
        supportsResolution: false,
        supportsAspectRatio: !hasFirst,
        supportsAspectRatio1x1: !hasFirst,
        durations: [3,4,5,6,7,8,9,10,11,12,13,14,15] as const,
        supportsSound: true,       // en v3 pro es nativo
        supportsLastFrame: true,   // usaremos end_image_url luego
      };
    }

    const durations = (() => {
      // Veo 3 / Veo 3 Fast: en Gemini API es 8s fijo
      if (isVeo30) return [8] as const;

      // Veo 3.1: 8s obligatorio si 1080p/4k o si usas imágenes (first/last)
      if (hasFirst || hasLast) return [8] as const;
      if (resolution === "720p") return [4, 6, 8] as const;
      return [8] as const;
    })();

    return {
      supportsResolution: true,
      supportsAspectRatio: !hasFirst,
      supportsAspectRatio1x1: false,
      durations,
      supportsSound: false,
      supportsLastFrame: true,
    };
  }, [hasFirst, hasLast, isVeo30, model, resolution, klingMode]);

  // Allowed durations logic (según tu regla)
  const allowedDurations = useMemo(() => capability.durations, [capability.durations]);

  const supportedResolutions = useMemo(() => {
    if (!capability.supportsResolution) return ["720p"] as const;
    return isVeo30 ? (["720p", "1080p"] as const) : (["720p", "1080p", "4k"] as const);
  }, [capability.supportsResolution, isVeo30]);

  useEffect(() => {
    if (!capability.supportsResolution && resolution !== "720p") {
      setResolution("720p");
      return;
    }
    if (isVeo30 && resolution === "4k") setResolution("1080p");
  }, [capability.supportsResolution, isVeo30, resolution]);

  useEffect(() => {
    if (isVeo30 && !hasFirst && resolution === "1080p" && aspectRatio === "9:16") {
      setAspectRatio("16:9");
    }
  }, [isVeo30, hasFirst, resolution, aspectRatio]);

  useEffect(() => {
    if (!capability.supportsAspectRatio1x1 && aspectRatio === "1:1") {
      setAspectRatio("16:9");
    }
  }, [aspectRatio, capability.supportsAspectRatio1x1]);

  // 1) Regla Kling: si estás en STD y tenías sound ON, lo apagamos
  useEffect(() => {
  if (!isKlingV2) return;

  if (klingMode === "std" && klingSound) {
    setKlingSound(false);
    setKlingSoundTouched(true);
  }
}, [isKlingV2, klingMode, klingSound]);

  // 2) Regla Veo: si hay LAST frame y estabas en Veo 3.0, forzar Veo 3.1
  useEffect(() => {
    if (!hasLast) return;
    if (!isVeo30) return;

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

  useEffect(() => {
    if (!isKlingV3) return;
    if (!elementsOpen) return;

    (async () => {
      try {
        const items = await listKlingElements();
        setKlingElements(items || []);
      } catch (e: any) {
        setError(e?.message || "No pude cargar tus Elements.");
      }
    })();
  }, [isKlingV3, elementsOpen]);

  useEffect(() => {
    if (!isKlingV3) return;
    if (firstFrame?.id) return;

    // Si quitas FIRST, dejamos elements en 0 para evitar errores
    if (selectedKlingElementIds.length > 0) {
      setSelectedKlingElementIds([]);
    }
  }, [isKlingV3, firstFrame?.id, selectedKlingElementIds.length]);

  const modelLabel = useMemo(() => {
    if (model === VEO_3) return "Veo 3";
    if (model === VEO_3_FAST) return "Veo 3 Fast";
    if (model === VEO_3_1) return "Veo 3.1";
    if (model === VEO_3_1_FAST) return "Veo 3.1 Fast";
    if (model === KLING_2_5_TURBO) return "Kling 2.5 Turbo";
    if (model === KLING_2_6) return "Kling 2.6";
    if (model === KLING_V3) return "Kling V3";
    return model;
  }, [model]);

  const paramsLabel = useMemo(() => {
    const ar = capability.supportsAspectRatio ? aspectRatio : "Auto";
    const resLabel = capability.supportsResolution ? resolution : "Auto";
    return `${ar} • ${resLabel} • x${count}`;
  }, [aspectRatio, capability.supportsAspectRatio, capability.supportsResolution, count, resolution]);

  

  const multishotValidShots = useMemo(() => {
  if (!isKlingV3 || !multishotEnabled) return [];
  return klingShots
    .map((s) => ({
      prompt: (s.prompt || "").trim(),
      durationSeconds: clampInt(s.durationSeconds, 3, 15, 3),
    }))
    .filter((s) => s.prompt.length > 0);
}, [isKlingV3, multishotEnabled, klingShots]);

const multishotTotalSeconds = useMemo(() => {
  if (!isKlingV3 || !multishotEnabled) return 0;
  return multishotValidShots.reduce((acc, s) => acc + s.durationSeconds, 0);
}, [isKlingV3, multishotEnabled, multishotValidShots]);

const multishotIsReady = useMemo(() => {
  if (!isKlingV3 || !multishotEnabled) return true;
  if (multishotValidShots.length < 2) return false;
  return multishotTotalSeconds >= 3 && multishotTotalSeconds <= 15;
}, [isKlingV3, multishotEnabled, multishotValidShots.length, multishotTotalSeconds]);

const durationLabel = useMemo(() => {
  if (isKlingV3 && multishotEnabled) {
    return `${multishotTotalSeconds || 0}s (multishot)`;
  }
  return `${durationSeconds}s`;
}, [durationSeconds, isKlingV3, multishotEnabled, multishotTotalSeconds]);


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
    const allowEmptyPrompt = isKlingV3 && multishotEnabled;
    if (!allowEmptyPrompt && !prompt.trim()) return;

    setIsGenerating(true);
    setError(null);

    const modelNorm = String(model || "").trim().replace(/^models\//i, "");

    try {
      // Si es Kling V3 + Multishot: usamos el primer shot válido como prompt fallback (por schema min(1))
      const effectivePrompt =
        modelNorm === KLING_V3 && multishotEnabled
          ? (multishotValidShots[0]?.prompt || "multishot")
          : prompt;

      const effectiveDurationSeconds =
        modelNorm === KLING_V3 && multishotEnabled
          ? Number(multishotTotalSeconds || 5)
          : Number(durationSeconds);

      const body: any = {
        prompt: effectivePrompt,
        model: modelNorm,
        tool: TOOL_ID,
        nameHint: "video",
        count: modelNorm === KLING_V3 ? 1 : clampInt(count, 1, 4, 1),
        durationSeconds: effectiveDurationSeconds,
      };

      if (capability.supportsResolution) {
        body.resolution = resolution;
      }

      if (firstFrame?.id) body.firstFrameAssetId = firstFrame.id;
      if (lastFrame?.id) body.lastFrameAssetId = lastFrame.id;

      // si NO hay first frame, se permite escoger aspect ratio
      if (!firstFrame && capability.supportsAspectRatio) body.aspectRatio = aspectRatio;

      // Kling v2.* directo
      if (isKling && modelNorm !== "kling-v3") {
        body.klingMode = klingMode;
      }

      // Kling 2.6: solo enviamos si el usuario tocó el toggle
      if (isKling && modelNorm === KLING_2_6 && klingSoundTouched) {
        body.klingSound = klingSound;
      }

      // Kling V3 (Fal): enviamos SIEMPRE audio + extras
      if (modelNorm === "kling-v3") {
        // Audio nativo (Fal: generate_audio)
        body.klingSound = klingSound;

        // Elements (requiere FIRST)
        if (selectedKlingElementIds.length > 0) {
          if (!firstFrame?.id) {
            throw new Error("Kling V3: Para usar Elements debes cargar FIRST frame.");
          }
          body.klingElementIds = selectedKlingElementIds.slice(0, 5);
        }

        // Multishot
        if (multishotEnabled) {
          if (!multishotIsReady) {
            throw new Error("Multishot: necesitas 2+ shots con prompt y la suma de duración 3–15s.");
          }

          body.klingMultiPrompt = multishotValidShots;

          // shot_type solo importa en text-to-video (sin FIRST)
          if (!firstFrame?.id) body.klingShotType = klingShotType;
        }

        // Params extra V3
        if (negativePrompt.trim()) body.negativePrompt = negativePrompt.trim();
        if (Number.isFinite(Number(klingCfgScale))) body.klingCfgScale = Number(klingCfgScale);

        const voiceIds = klingVoiceIdsText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 2);
        if (voiceIds.length) body.klingVoiceIds = voiceIds;
      }

      let res: any;

      if (modelNorm === KLING_V3) {
        const submit = await apiPostJson<any>("/api/ai/video", { ...body, async: true });

        if (submit?.mode === "async" && submit?.jobToken) {
          const jobToken = String(submit.jobToken);

          await waitFalJob(jobToken);

          // Finalize: aquí es donde bajas el video de Fal y lo guardas en Supabase Storage
          res = await apiPostJson<VideoGenResponse>("/api/ai/video/fal/finalize", {
            jobToken,
            prompt: effectivePrompt,
          });
        } else {
          // fallback por si el backend responde sync
          res = submit;
        }
      } else {
        res = await apiPostJson<VideoGenResponse>("/api/ai/video", body);
      }

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
        prompt: effectivePrompt,
        createdAt: now,
        ownerId: "me",
        isPublic: false,
        likes: [],
        comments: [],
        meta: {
          model: modelNorm,
          aspectRatio: firstFrame ? "auto" : aspectRatio,
          resolution: capability.supportsResolution ? resolution : "auto",
          durationSeconds: effectiveDurationSeconds,
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
            Veo 3 / 3.1 · Kling 2.5/2.6 • First/Last frame • Historial guardado en assets
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
                  {isKlingV3 && (
                    <div className={styles.promptToolbar}>
                      <button
                        type="button"
                        className={styles.toolbarBtn}
                        onClick={() => setElementsOpen(true)}
                        disabled={!firstFrame?.id} // V3 Elements requiere FIRST
                        title={!firstFrame?.id ? "Para usar Elements primero carga FIRST frame" : "Seleccionar Elements"}
                      >
                        Elements {selectedKlingElementIds.length ? `(${selectedKlingElementIds.length})` : ""}
                      </button>

                      <button
                        type="button"
                        className={`${styles.toolbarBtn} ${multishotEnabled ? styles.toolbarBtnActive : ""}`}
                        onClick={() => setMultishotEnabled((v) => !v)}
                        title="Activar/Desactivar Multishot"
                      >
                        Multishot {multishotEnabled ? "ON" : "OFF"}
                      </button>

                      {multishotEnabled && (
                        <button
                          type="button"
                          className={styles.toolbarBtn}
                          onClick={() => setMultishotOpen(true)}
                          title="Editar shots"
                        >
                          Edit ({klingShots.length} · {multishotTotalSeconds}s)
                        </button>
                      )}
                    </div>
                  )}

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
                  disabled={isGenerating || (isKlingV3 && multishotEnabled ? !multishotIsReady : !prompt.trim())}
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

                      <button
                        className={`${styles.modelOption} ${model === KLING_2_5_TURBO ? styles.modelOptionActive : ""}`}
                        onClick={() => setModel(KLING_2_5_TURBO)}
                      >
                        <div className={styles.modelName}>Kling 2.5 Turbo</div>
                        <div className={styles.modelDesc}>Rápido · 5/10s · sin sound</div>
                      </button>

                      <button
                        className={`${styles.modelOption} ${model === KLING_2_6 ? styles.modelOptionActive : ""}`}
                        onClick={() => setModel(KLING_2_6)}
                      >
                        <div className={styles.modelName}>Kling 2.6</div>
                        <div className={styles.modelDesc}>Mejor calidad · 5/10s · sound</div>
                      </button>

                      <button
                        className={`${styles.modelOption} ${model === KLING_V3 ? styles.modelOptionActive : ""}`}
                        onClick={() => setModel(KLING_V3)}
                      >
                        <div className={styles.modelName}>Kling V3</div>
                        <div className={styles.modelDesc}>Pro · 3–15s · sound · elements · multishot</div>
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
                          className={`${styles.segmentBtn} ${
                            !capability.supportsAspectRatio ? styles.segmentBtnDisabled : ""
                          } ${capability.supportsAspectRatio && aspectRatio === "16:9" ? styles.segmentBtnActive : ""}`}
                          onClick={() => capability.supportsAspectRatio && setAspectRatio("16:9")}
                          disabled={!capability.supportsAspectRatio}
                        >
                          16:9
                        </button>
                        <button
                          type="button"
                          className={`${styles.segmentBtn} ${
                            !capability.supportsAspectRatio ? styles.segmentBtnDisabled : ""
                          } ${capability.supportsAspectRatio && aspectRatio === "9:16" ? styles.segmentBtnActive : ""}`}
                          onClick={() => capability.supportsAspectRatio && setAspectRatio("9:16")}
                          disabled={!capability.supportsAspectRatio}
                        >
                          9:16
                        </button>
                        {capability.supportsAspectRatio1x1 && capability.supportsAspectRatio && (
                          <button
                            type="button"
                            className={`${styles.segmentBtn} ${
                              aspectRatio === "1:1" ? styles.segmentBtnActive : ""
                            }`}
                            onClick={() => setAspectRatio("1:1")}
                          >
                            1:1
                          </button>
                        )}
                        <div className={styles.segmentMeta}>
                          {capability.supportsAspectRatio ? "Manual" : "AUTO (por imagen)"}
                        </div>
                      </div>
                    </div>

                    {capability.supportsResolution && (
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
                    )}

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

                    {isKlingV2 && (
                      <div className={styles.formRow}>
                        <label className={styles.formLabel}>Kling Mode</label>
                        <div className={styles.segment}>
                          <button
                            type="button"
                            className={`${styles.segmentBtn} ${klingMode === "std" ? styles.segmentBtnActive : ""}`}
                            onClick={() => setKlingMode("std")}
                          >
                            Standard
                          </button>
                          <button
                            type="button"
                            className={`${styles.segmentBtn} ${klingMode === "pro" ? styles.segmentBtnActive : ""}`}
                            onClick={() => setKlingMode("pro")}
                          >
                            Pro
                          </button>
                          <div className={styles.segmentMeta}>
                            Pro habilita Sound (solo Kling 2.6)
                          </div>
                        </div>
                      </div>
                    )}

                    {capability.supportsSound && (
                      <div className={styles.formRow}>
                        <label className={styles.formLabel}>Sound</label>
                        <div className={styles.segment}>
                          <button
                            type="button"
                            className={`${styles.segmentBtn} ${klingSound ? styles.segmentBtnActive : ""}`}
                            onClick={() => {
                              setKlingSound(true);
                              setKlingSoundTouched(true);
                            }}
                          >
                            On
                          </button>
                          <button
                            type="button"
                            className={`${styles.segmentBtn} ${!klingSound ? styles.segmentBtnActive : ""}`}
                            onClick={() => {
                              setKlingSound(false);
                              setKlingSoundTouched(true);
                            }}
                          >
                            Off
                          </button>
                          <div className={styles.segmentMeta}>
                            {isKlingV3 ? "Native audio (Kling V3)" : "Solo Kling 2.6 (Mode Pro)"}
                          </div>
                        </div>
                      </div>
                    )}

                    {isKlingV3 && (
                      <>
                        <div className={styles.formRow}>
                          <label className={styles.formLabel}>Negative Prompt</label>
                          <textarea
                            className={styles.textarea}
                            value={negativePrompt}
                            onChange={(e) => setNegativePrompt(e.target.value)}
                            placeholder="blur, distort, low quality…"
                            rows={2}
                          />
                        </div>

                        <div className={styles.formRow}>
                          <label className={styles.formLabel}>CFG Scale</label>
                          <input
                            className={styles.input}
                            type="number"
                            min={0}
                            max={1}
                            step={0.05}
                            value={klingCfgScale}
                            onChange={(e) => setKlingCfgScale(Number(e.target.value))}
                          />
                        </div>

                        <div className={styles.formRow}>
                          <label className={styles.formLabel}>Voice IDs</label>
                          <input
                            className={styles.input}
                            value={klingVoiceIdsText}
                            onChange={(e) => setKlingVoiceIdsText(e.target.value)}
                            placeholder="id1,id2 (máx 2)"
                          />
                          <div className={styles.segmentMeta}>
                            Usa {"<<<voice_1>>>"} y {"<<<voice_2>>>"} en el prompt
                          </div>
                        </div>
                      </>
                    )}
                    {isKlingV3 && multishotEnabled && !multishotIsReady && (
                      <div className={styles.noteSmall}>
                        Multishot: necesitas 2+ shots con prompt y la suma de duración debe ser 3–15s.
                      </div>
                    )}
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

                    {isKlingV3 && multishotEnabled ? (
                      <>
                        <div className={styles.note}>
                          Multishot controla la duración total. Total actual: <b>{multishotTotalSeconds}s</b> (debe ser 3–15s).
                        </div>
                        <div className={styles.note}>
                          Edita los shots en “Edit” para ajustar la duración.
                        </div>
                      </>
                    ) : (
                      <>
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
                          {isKlingV2
                            ? "Kling 2.5/2.6 permite 5s o 10s."
                            : isKlingV3
                              ? "Kling V3 permite 3s–15s."
                              : hasFirst
                                ? "Con frames (First/Last) la duración es 8s."
                                : resolution !== "720p"
                                  ? "Con 1080p/4k la duración es 8s."
                                  : "Con 720p sin frames puedes elegir 4/6/8s."}
                        </div>
                      </>
                    )}
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

      {/* Multishot modal (Kling V3) */}
      {multishotOpen && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>Multishot</div>
              <button className={styles.modalClose} onClick={() => setMultishotOpen(false)} type="button">
                ×
              </button>
            </div>

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.uploadBtn}
                onClick={() =>
                  setKlingShots((prev) =>
                    prev.length >= 10 ? prev : [...prev, { prompt: "", durationSeconds: 3 }]
                  )
                }
              >
                + Add shot
              </button>

              <div className={styles.segmentMeta}>
                Total: {multishotTotalSeconds}s (cada shot 3–15s · max 10)
              </div>
            </div>

            <div className={styles.modalActions}>
              <label className={styles.formLabel} style={{ width: 110 }}>Shot type</label>
              <div className={styles.segment}>
                <button
                  type="button"
                  className={`${styles.segmentBtn} ${klingShotType === "customize" ? styles.segmentBtnActive : ""}`}
                  onClick={() => setKlingShotType("customize")}
                >
                  customize
                </button>
                <button
                  type="button"
                  className={`${styles.segmentBtn} ${klingShotType === "intelligent" ? styles.segmentBtnActive : ""}`}
                  onClick={() => setKlingShotType("intelligent")}
                  disabled={!!firstFrame?.id} // i2v: solo customize
                >
                  intelligent
                </button>
                <div className={styles.segmentMeta}>
                  {firstFrame?.id ? "Con FIRST frame solo permite customize" : "Text-only permite intelligent"}
                </div>
              </div>
            </div>

            <div className={styles.shotsList}>
              {klingShots.map((s, i) => (
                <div key={i} className={styles.shotRow}>
                  <div className={styles.shotHeader}>
                    <div className={styles.shotTitle}>Shot {i + 1}</div>
                    <button
                      type="button"
                      className={styles.swapBtn}
                      onClick={() => setKlingShots((prev) => prev.filter((_, idx) => idx !== i))}
                      disabled={klingShots.length <= 1}
                    >
                      Remove
                    </button>
                  </div>

                  <textarea
                    className={styles.textarea}
                    rows={2}
                    value={s.prompt}
                    onChange={(e) =>
                      setKlingShots((prev) =>
                        prev.map((x, idx) => (idx === i ? { ...x, prompt: e.target.value } : x))
                      )
                    }
                    placeholder="Prompt de este shot..."
                  />

                  <div className={styles.formRow}>
                    <label className={styles.formLabel}>Duration</label>
                    <input
                      className={styles.input}
                      type="number"
                      min={3}
                      max={15}
                      value={s.durationSeconds}
                      onChange={(e) =>
                        setKlingShots((prev) =>
                          prev.map((x, idx) =>
                            idx === i ? { ...x, durationSeconds: Number(e.target.value) } : x
                          )
                        )
                      }
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.modalNote}>
              Si Multishot está ON, el backend enviará `multi_prompt` y usará la suma de durations.
            </div>
          </div>
        </div>
      )}

      {/* Elements modal (Kling V3) */}
      {elementsOpen && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>Kling Elements</div>
              <button className={styles.modalClose} onClick={() => setElementsOpen(false)} type="button">
                ×
              </button>
            </div>

            <div className={styles.modalActions}>
              <input
                className={styles.search}
                placeholder="Search elements..."
                value={elementsQuery}
                onChange={(e) => setElementsQuery(e.target.value)}
              />
              <button
                type="button"
                className={styles.swapBtn}
                onClick={() => setSelectedKlingElementIds([])}
              >
                Clear
              </button>
            </div>

            <div className={styles.pickerGrid}>
              {klingElements
                .filter((el) => {
                  const q = elementsQuery.trim().toLowerCase();
                  if (!q) return true;
                  const t = `${el.elementName} ${el.elementDescription}`.toLowerCase();
                  return t.includes(q);
                })
                .map((el) => {
                  const selected = selectedKlingElementIds.includes(el.id);
                  const thumbAsset =
                    imageAssets.find((a) => a.id === el.frontalAssetId) || null;

                  return (
                    <button
                      key={el.id}
                      type="button"
                      className={`${styles.pickerTile} ${selected ? styles.pickerTileActive : ""}`}
                      onClick={() => {
                        setSelectedKlingElementIds((prev) => {
                          const has = prev.includes(el.id);
                          if (has) return prev.filter((x) => x !== el.id);
                          if (prev.length >= 5) return prev; // max 5
                          return [...prev, el.id];
                        });
                      }}
                    >
                      <img
                        src={thumbAsset?.url || "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="}
                        alt={el.elementName}
                      />
                      <div className={styles.pickerCap}>
                        {el.elementName}
                        {selected ? " ✓" : ""}
                      </div>
                    </button>
                  );
                })}
            </div>

            {!firstFrame?.id && (
              <div className={styles.modalNote}>
                Para usar Elements en Kling V3 primero debes cargar FIRST frame.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoGeneratorTool;
