import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "./ImageGeneratorTool.module.css";
import { generateImageBatch } from "../../services/geminiService";
import { deleteAsset, listMyAssets, publishAsset, unpublishAsset, uploadUserAsset } from "../../services/assetsApi";
import { useAuth } from "../../contexts/AuthContext";
import { Asset, GeminiModel } from "../../types";
import ErrorModal from "../../components/ErrorModal";

type StylePreset = {
  id: string;
  name: string;
  prompt: string;
  coverUrl?: string;
  exampleUrls?: [string, string, string, string];
};

const STYLE_PRESET_BLOCK_START = "[[STYLE_PRESET_START]]";
const STYLE_PRESET_BLOCK_END = "[[STYLE_PRESET_END]]";
const LEGACY_STYLE_PRESET_BLOCK_START = "/* STYLE_PRESET_START */";
const LEGACY_STYLE_PRESET_BLOCK_END = "/* STYLE_PRESET_END */";

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeStylePresetBlock(input: string) {
  let out = input;
  const pairs = [
    { start: STYLE_PRESET_BLOCK_START, end: STYLE_PRESET_BLOCK_END },
    { start: LEGACY_STYLE_PRESET_BLOCK_START, end: LEGACY_STYLE_PRESET_BLOCK_END },
  ];

  for (const { start, end } of pairs) {
    const re = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n*`, "g");
    out = out.replace(re, "");
  }
  return out.trim();
}

function applyStylePresetToPrompt(input: string, presetPrompt: string) {
  const base = removeStylePresetBlock(input).trim();
  const block = `${STYLE_PRESET_BLOCK_START}\n${presetPrompt}\n${STYLE_PRESET_BLOCK_END}\n\n`;
  return `${block}${base}`.trim();
}

const STYLE_PRESETS: StylePreset[] = [
  {
    id: "live_action",
    name: "Live Action",
    coverUrl: "/style-presets/LiveAction/cover.png",
    exampleUrls: [
      "/style-presets/LiveAction/1.png",
      "/style-presets/LiveAction/2.jpeg",
      "/style-presets/LiveAction/3.png",
      "/style-presets/LiveAction/4.jpeg",
    ],
    prompt: `
STYLE: Apply photorealistic materials and cinematic lighting to the provided image using TEXTURE AND MATERIAL
TRANSLATION ONLY.

ABSOLUTE PRESERVATION RULE:
Preserve the original image EXACTLY as-is in design and identity. This is a material/lighting pass only.
Do not reinterpret any described traits from the text prompt. Do not reinterpret any traits shown in reference images.
Even if features are stylized, non-realistic, simplified or exaggerated, they must remain EXACTLY the same.

PRESERVE ORIGINAL CHARACTERS EXACTLY (LOCKED DESIGN):
- identical facial structure and proportions
- identical head shape and stylized geometry
- identical mouth shape and facial expressions
- identical silhouette, body proportions, and overall character identity
- identical hairstyle shape, hairline, hair volume and hair design (only add strand-level texture without changing the shape)
- identical clothing design, seams, patterns, logos, symbols, text, graphics, jewelry, accessories, props (do NOT alter, replace, add, or remove anything)

EYES AND FACIAL EXPRESSIONS ARE ABSOLUTELY LOCKED (HIGHEST PRIORITY):
- do not change eye size, eye shape, iris size, pupil size or eye spacing
- do not add shine, emotion, intensity, wetness, sparkle, reflections or realism to the eyes
- do not modify eyelids, eyebrows, lashes, or facial muscle tension
- do not change gaze direction, head tilt, micro-expression, or “mood”
- eyes and expressions must remain pixel-identical in pose and emotion to the original image
Facial expressions are the HIGHEST PRIORITY and must remain completely unchanged.

FACE PROTECTION (NO BEAUTIFICATION / NO REPAIR):
Do NOT reinterpret, redesign, enhance, beautify, “improve”, or “fix” faces.
Do NOT correct anatomy or add realism to facial features.
Do NOT change facial identity, symmetry, jawline, cheek volume, nose shape, lips shape, or skin contour.
Treat all facial geometry, eyes, and expressions as LOCKED reference design.

ALLOWED CHANGES (ONLY THESE):
Only upgrade:
- fur texture and hair strands (micro-detail only; keep original hair/fur shape and clumps)
- skin material detail (material response only; do NOT change facial features or perceived age)
- material depth (PBR-like roughness/normal depth; subtle, controlled)
- cinematic lighting and shadows applied to the scene/environment, not the face
- improved global shading coherence without altering design or colors

TEXT / LOGO / GRAPHICS LOCK:
If there is ANY text, logo, signage, UI, symbols, or typography:
- keep EXACT content, spelling, font shape, placement, size, and alignment
- do not redraw, restyle, translate, “correct”, or replace text
- do not add new text

COLOR AND LIGHTING DIRECTION (NO NIGHT CONDITION):
- cinematic color grading
- natural, film-like colors
- slightly desaturated palette
- soft highlights, controlled shadows
- NO oversaturation, NO HDR plastic look
- match the original time-of-day and scene intent from the input (day stays day, indoor stays indoor, etc.)
- preserve original light direction and key-to-fill logic; enhance it cinematically without changing mood/emotion
- avoid any dramatic face/eye lighting; keep face lighting consistent with the original

COMPOSITION & CAMERA LOCK:
Maintain original composition, pose, framing, lens feel, perspective, and emotion.
Do not crop, zoom, warp, or change camera angle.
Soft depth of field (subtle, cinematic) while preserving original focus intent.

Negative prompt:
face redesign, eye variation, expression change, emotional enhancement, eye sparkle, wet eyes, added eye reflections,
beautification, symmetry correction, anatomy correction, realistic facial anatomy conversion, new facial identity,
generic lion face, wildlife photography look, realistic lion anatomy, new accessories, removed accessories, added props,
text changes, logo changes, typography changes, oversaturated colors, HDR look, dramatic eye lighting, face relighting,
pose change, framing change, crop, zoom, perspective change
    `.trim(),
  },
  {
    id: "luxury_product",
    name: "Luxury Product",
    coverUrl: "/style-presets/luxury/cover.jpg",
    exampleUrls: ["/style-presets/luxury/1.jpg", "/style-presets/luxury/2.jpg", "/style-presets/luxury/3.jpg", "/style-presets/luxury/4.jpg"],
    prompt: `
STYLE: Luxury product advertising. Clean studio, premium reflections.
Lighting: controlled specular highlights, soft gradients, no harsh glare.
Composition: centered hero shot, elegant negative space, minimal clutter.
Quality: extremely sharp, high contrast micro-detail, commercial polish.
    `.trim(),
  },
  {
    id: "pixar_3d",
    name: "3D Pixar-ish",
    coverUrl: "/style-presets/pixar/cover.jpg",
    exampleUrls: ["/style-presets/pixar/1.jpg", "/style-presets/pixar/2.jpg", "/style-presets/pixar/3.jpg", "/style-presets/pixar/4.jpg"],
    prompt: `
STYLE: High-quality 3D animation look (family-friendly, stylized).
Materials: smooth but detailed shaders, soft bounce light, clean render.
Colors: vibrant but balanced, pleasing tones, gentle bloom.
Rules: no uncanny realism, keep shapes clean, avoid noise/artifacts.
    `.trim(),
  },
];

type Quality = "" | "1K" | "2K" | "4K";
type PanelKey = "reference" | "model" | "params" | "styles";

const TOOL_ID = "image-generator";
const REF_TOOL_ID = "image-generator-ref";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function getStatus(err: any): number | null {
  return typeof err?.status === "number" ? err.status : typeof err?.response?.status === "number" ? err.response.status : null;
}
function getErrMsg(err: any): string {
  return err?.response?.data?.message || err?.response?.data?.error || err?.message || (typeof err === "string" ? err : "Failed to generate image.");
}
function isRetryable(err: any): boolean {
  const s = getStatus(err);
  if (s && [408, 429, 500, 502, 503, 504].includes(s)) return true;
  const m = (getErrMsg(err) || "").toLowerCase();
  return m.includes("timeout") || m.includes("failed to fetch") || m.includes("network");
}
function formatErr(err: any): string {
  const s = getStatus(err);
  const m = getErrMsg(err);
  return s ? `${m} (HTTP ${s})` : m;
}

// ===== Hidden Style Prompt =====
const STYLE_BLOCK_START = STYLE_PRESET_BLOCK_START;
const STYLE_BLOCK_END = STYLE_PRESET_BLOCK_END;

function splitStyleBlock(text: string): { cleaned: string; style: string | null } {
  const pairs = [
    { start: STYLE_BLOCK_START, end: STYLE_BLOCK_END },
    { start: LEGACY_STYLE_PRESET_BLOCK_START, end: LEGACY_STYLE_PRESET_BLOCK_END },
  ];

  for (const { start, end } of pairs) {
    if (!text.includes(start) || !text.includes(end)) continue;
    const s = text.indexOf(start);
    const e = text.indexOf(end);
    if (s === -1 || e === -1 || e < s) continue;

    const before = text.slice(0, s).trimEnd();
    const inside = text.slice(s + start.length, e).trim();
    const after = text.slice(e + end.length).trimStart();

    const cleaned = [before, after].filter(Boolean).join("\n\n").trim();
    return { cleaned, style: inside || null };
  }
  return { cleaned: text, style: null };
}

function stripStyleBlock(text: string): string {
  return splitStyleBlock(text).cleaned;
}

function attachStyleBlock(userPrompt: string, stylePrompt: string | null): string {
  const p = (userPrompt || "").trim();
  const s = (stylePrompt || "").trim();
  if (!s) return p;

  if (
    (p.includes(STYLE_BLOCK_START) && p.includes(STYLE_BLOCK_END)) ||
    (p.includes(LEGACY_STYLE_PRESET_BLOCK_START) && p.includes(LEGACY_STYLE_PRESET_BLOCK_END))
  ) {
    return p;
  }
  return `${STYLE_BLOCK_START}\n${s}\n${STYLE_BLOCK_END}\n\n${p}`.trim();
}

function makeTempAsset(item: { assetId: string; url: string }, prompt: string, ownerId: string): Asset {
  return {
    id: item.assetId,
    url: item.url,
    type: "image",
    name: "Generated",
    prompt,
    createdAt: Date.now(),
    ownerId,
    isPublic: false,
    likes: [],
    comments: [],
  };
}

const BACKGROUND_AUTO_PROMPT = `
BACKGROUND AUTO-RULES (only if a background reference image is provided):
- Preserve the original background reference composition and key elements.
- Apply the selected style/preset consistently to the background.
- Do not introduce new objects or change the scene layout.
`.trim();

type Panel = null | "reference" | "model" | "parameters" | "styles";
type RefSlot = "char1" | "char2" | "char3" | "background";

const SLOT_LABEL: Record<RefSlot, string> = {
  char1: "Character 1",
  char2: "Character 2",
  char3: "Character 3",
  background: "Background",
};

function extractStyleBlock(input: string) {
  const pairs = [
    { start: STYLE_PRESET_BLOCK_START, end: STYLE_PRESET_BLOCK_END },
    { start: LEGACY_STYLE_PRESET_BLOCK_START, end: LEGACY_STYLE_PRESET_BLOCK_END },
  ];

  for (const { start, end } of pairs) {
    const s = input.indexOf(start);
    const e = input.indexOf(end);
    if (s !== -1 && e !== -1 && e > s) {
      const inside = input.slice(s + start.length, e).trim();
      return inside || null;
    }
  }
  return null;
}

function getStyleNameFromPromptOrSelection(opts: {
  prompt: string;
  selectedStyleId: string | null;
}) {
  if (opts.selectedStyleId) {
    const found = STYLE_PRESETS.find((p) => p.id === opts.selectedStyleId);
    return found?.name || "Style";
  }
  const inside = extractStyleBlock(opts.prompt || "");
  return inside ? "Custom" : "None";
}

// Iconitos (SVG inline) — nada externo
function Icon({ name }: { name: "heart" | "share" | "download" | "trash" | "copy" | "reuse" | "close" }) {
  switch (name) {
    case "heart":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 21s-7.2-4.35-9.6-8.55C.3 8.7 2.55 5.7 6 5.7c1.95 0 3.3 1.05 4 2.1.7-1.05 2.05-2.1 4-2.1 3.45 0 5.7 3 3.6 6.75C19.2 16.65 12 21 12 21z"
          />
        </svg>
      );
    case "share":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M18 16a3 3 0 0 0-2.4 1.2l-6.3-3.15a3.1 3.1 0 0 0 0-1.05l6.3-3.15A3 3 0 1 0 15 7a3 3 0 0 0 .1.75L8.8 10.9a3 3 0 1 0 0 2.2l6.3 3.15A3 3 0 1 0 18 16z"
          />
        </svg>
      );
    case "download":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42l2.3 2.3V4a1 1 0 0 1 1-1z"
          />
          <path fill="currentColor" d="M5 19a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1z" />
        </svg>
      );
    case "trash":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M9 3h6l1 2h4a1 1 0 1 1 0 2h-1l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 7H4a1 1 0 1 1 0-2h4l1-2zm0 6a1 1 0 0 1 1 1v9a1 1 0 1 1-2 0v-9a1 1 0 0 1 1-1zm6 0a1 1 0 0 1 1 1v9a1 1 0 1 1-2 0v-9a1 1 0 0 1 1-1z"
          />
        </svg>
      );
    case "copy":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M8 7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V7z"
          />
          <path
            fill="currentColor"
            d="M6 3h9a1 1 0 1 1 0 2H6a1 1 0 0 0-1 1v11a1 1 0 1 1-2 0V6a3 3 0 0 1 3-3z"
          />
        </svg>
      );
    case "reuse":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 6V3l-4 4 4 4V8c2.76 0 5 2.24 5 5a5 5 0 0 1-9.9 1 1 1 0 1 1-1.96.4A7 7 0 0 0 12 20a7 7 0 0 0 0-14z"
          />
        </svg>
      );
    case "close":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12l-4.9 4.89a1 1 0 1 0 1.41 1.42L12 13.41l4.89 4.9a1 1 0 0 0 1.42-1.41L13.41 12l4.9-4.89a1 1 0 0 0-.01-1.4z"
          />
        </svg>
      );
    default:
      return null;
  }
}

const ImageGeneratorTool: React.FC = () => {
  const { user } = useAuth();

  const [history, setHistory] = useState<Asset[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<GeminiModel>("imagen-4.0-generate-preview-06-06");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [count, setCount] = useState(1);
  const [quality, setQuality] = useState<"1K" | "2K" | "4K">("2K");

  // Reference slots (sin STYLE aquí)
  const [refs, setRefs] = useState<Record<RefSlot, Asset | null>>({
    char1: null,
    char2: null,
    char3: null,
    background: null,
  });

  // Styles (solo aquí)
  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null);
  const selectedStylePrompt = useMemo(() => {
    if (!selectedStyleId) return "";
    return STYLE_PRESETS.find((p) => p.id === selectedStyleId)?.prompt?.trim() || "";
  }, [selectedStyleId]);

  // UI states
  const [panel, setPanel] = useState<Panel>(null);
  const [pickerSlot, setPickerSlot] = useState<RefSlot | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");

  const [viewer, setViewer] = useState<Asset | null>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const popoverRef = useRef<HTMLDivElement>(null);

  async function reloadHistory() {
    setIsLoadingHistory(true);
    try {
      const assets = await listMyAssets({ type: "image", limit: 80 });
      const sorted = [...assets].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setHistory(sorted);
    } catch (e: any) {
      setError(e?.message || "No se pudo cargar el historial.");
    } finally {
      setIsLoadingHistory(false);
    }
  }

  useEffect(() => {
    reloadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // cerrar panel al click afuera
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!panel) return;
      const el = popoverRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) {
        setPanel(null);
        setPickerSlot(null);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [panel]);

  // ESC cierra viewer
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setViewer(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filteredPickerAssets = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return history;
    return history.filter((a) => {
      const caption = removeStylePresetBlock(a.prompt || "").toLowerCase();
      return (a.name || "").toLowerCase().includes(q) || caption.includes(q);
    });
  }, [history, pickerQuery]);

  const recipeStyleName = useMemo(() => {
    return getStyleNameFromPromptOrSelection({ prompt, selectedStyleId });
  }, [prompt, selectedStyleId]);

  const recipeChips = useMemo(() => {
    const refCount = Object.values(refs).filter(Boolean).length;
    const hasBg = !!refs.background;
    const chars = [refs.char1, refs.char2, refs.char3].filter(Boolean).length;

    return [
      { label: "Model", value: model },
      { label: "Ratio", value: aspectRatio },
      { label: "Count", value: String(count) },
      { label: "Quality", value: quality },
      { label: "Refs", value: `${chars} char${chars === 1 ? "" : "s"}${hasBg ? " + bg" : ""} (${refCount})` },
      { label: "Style", value: recipeStyleName },
    ];
  }, [model, aspectRatio, count, quality, refs, recipeStyleName]);

  function setRefSlot(slot: RefSlot, asset: Asset | null) {
    setRefs((prev) => ({ ...prev, [slot]: asset }));
  }

  async function handleUploadToSlot(slot: RefSlot, file: File) {
    try {
      const uploaded = await uploadUserAsset(file, "image-generator");
      setRefSlot(slot, uploaded);
      setPanel(null); // auto-close
      setPickerSlot(null);
      setPickerQuery("");
      await reloadHistory();
    } catch (e: any) {
      setError(e?.message || "Upload falló.");
    }
  }

  async function handleGenerate() {
    if (!user) {
      setError("Debes iniciar sesión para generar.");
      return;
    }

    const basePrompt = (prompt || "").trim();
    if (!basePrompt) return;

    setIsGenerating(true);
    setError(null);

    try {
      // IDs para backend
      const characterAssetIds = [refs.char1?.id, refs.char2?.id, refs.char3?.id].filter(Boolean) as string[];
      const backgroundAssetId = refs.background?.id;

      // Prompt final (receta real): base + background rules + style block (si se eligió)
      let finalPrompt = basePrompt;

      if (backgroundAssetId) {
        finalPrompt = `${finalPrompt}\n\n${BACKGROUND_AUTO_PROMPT}`.trim();
      }

      // Solo aplica preset si el usuario eligió uno en Styles.
      // (Si el prompt ya trae un bloque guardado, se respeta tal cual si NO eliges estilo nuevo.)
      if (selectedStylePrompt) {
        finalPrompt = applyStylePresetToPrompt(finalPrompt, selectedStylePrompt);
      }

      await generateImageBatch(finalPrompt, model, {
        aspectRatio,
        count,
        quality,
        tool: "image-generator",
        nameHint: "generated",
        characterAssetIds,
        backgroundAssetId,
      });

      await reloadHistory();
    } catch (e: any) {
      setError(e?.message || "Failed to generate image.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleTogglePublish(asset: Asset) {
    try {
      if (asset.isPublic) {
        const r = await unpublishAsset(asset.id);
        setHistory((prev) => prev.map((a) => (a.id === asset.id ? { ...a, isPublic: r.isPublic } : a)));
        if (viewer?.id === asset.id) setViewer((v) => (v ? { ...v, isPublic: r.isPublic } : v));
      } else {
        const r = await publishAsset(asset.id);
        setHistory((prev) => prev.map((a) => (a.id === asset.id ? { ...a, isPublic: r.isPublic } : a)));
        if (viewer?.id === asset.id) setViewer((v) => (v ? { ...v, isPublic: r.isPublic } : v));
      }
    } catch (e: any) {
      setError(e?.message || "No se pudo cambiar visibilidad.");
    }
  }

  function handleDownload(asset: Asset) {
    const a = document.createElement("a");
    a.href = asset.url;
    a.download = asset.name || "image";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function handleDelete(asset: Asset) {
    const ok = window.confirm("¿Seguro que deseas eliminar esta imagen? Esta acción no se puede deshacer.");
    if (!ok) return;

    try {
      await deleteAsset(asset.id);
      setHistory((prev) => prev.filter((x) => x.id !== asset.id));
      if (viewer?.id === asset.id) setViewer(null);
    } catch (e: any) {
      setError(e?.message || "No se pudo eliminar.");
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  }

  function reusePromptFromAsset(asset: Asset) {
    const raw = asset.prompt || "";
    if (!raw.trim()) return;

    setPrompt(raw);

    // Si el prompt trae un bloque de style, intentamos “reconocer” el preset (solo para UI)
    const inside = extractStyleBlock(raw) || "";
    if (inside) {
      const match = STYLE_PRESETS.find((p) => (p.prompt || "").trim() === inside.trim());
      setSelectedStyleId(match ? match.id : null);
    }

    setPanel(null);
    setViewer(null);
  }

  return (
    <div className={styles.root}>
      {/* HISTORIAL (único contenido visible arriba) */}
      <div className={styles.stage}>
        <div className={styles.historyHeader}>
          <div className={styles.historyTitle}>
            <span className={styles.kicker}>IMAGE GENERATOR</span>
            <span className={styles.subKicker}>{isLoadingHistory ? "Loading history..." : `History · ${history.length}`}</span>
          </div>

          <button className={styles.ghostBtn} onClick={reloadHistory} type="button" disabled={isLoadingHistory}>
            Refresh
          </button>
        </div>

        <div className={styles.historyGrid}>
          {history.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyCode}>NO GENERATIONS</div>
              <div className={styles.emptyText}>Genera tu primera imagen para ver el historial aquí.</div>
            </div>
          ) : (
            <div className={styles.grid}>
              {history.map((asset) => {
                const caption = removeStylePresetBlock(asset.prompt || "") || asset.name || "—";
                return (
                  <button
                    key={asset.id}
                    type="button"
                    className={styles.tile}
                    onClick={() => setViewer(asset)}
                    title="Click para ver detalles"
                  >
                    <img className={styles.tileImg} src={asset.url} alt={asset.name} loading="lazy" decoding="async" />

                    <div className={styles.tileMeta}>
                      <span className={styles.tileCaption}>{caption}</span>
                      {asset.isPublic && <span className={styles.publicTag}>PUBLIC</span>}
                    </div>

                    {/* Hover actions */}
                    <div className={styles.tileActions} onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        title="Favoritos (próximamente)"
                        onClick={() => setError("Favoritos (Like) se habilita en el paso de Mis Creaciones / Favoritos.")}
                      >
                        <Icon name="heart" />
                      </button>

                      <button
                        type="button"
                        className={styles.iconBtn}
                        title={asset.isPublic ? "Quitar de público" : "Publicar"}
                        onClick={() => handleTogglePublish(asset)}
                      >
                        <Icon name="share" />
                      </button>

                      <button
                        type="button"
                        className={styles.iconBtn}
                        title="Descargar"
                        onClick={() => handleDownload(asset)}
                      >
                        <Icon name="download" />
                      </button>

                      <button
                        type="button"
                        className={styles.iconBtnDanger}
                        title="Eliminar"
                        onClick={() => handleDelete(asset)}
                      >
                        <Icon name="trash" />
                      </button>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* DOCK / BARRA DE PROMPT */}
      <div className={styles.dockWrap}>
        <div className={styles.recipeStrip}>
          {recipeChips.map((c) => (
            <div key={c.label} className={styles.recipeChip}>
              <span className={styles.recipeChipLabel}>{c.label}</span>
              <span className={styles.recipeChipValue}>{c.value}</span>
            </div>
          ))}
        </div>

        <div className={styles.dock}>
          <div className={styles.promptRow}>
            <textarea
              className={styles.prompt}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Escribe tu prompt y comienza a crear..."
              rows={2}
            />

            <button
              type="button"
              className={styles.generateBtn}
              disabled={isGenerating || !prompt.trim()}
              onClick={handleGenerate}
            >
              {isGenerating ? (
                <span className={styles.loadingInline}>
                  <span className={styles.loaderDot} />
                  <span className={styles.loaderDot} />
                  <span className={styles.loaderDot} />
                </span>
              ) : (
                "GENERATE"
              )}
            </button>
          </div>

          <div className={styles.controlsRow}>
            <button
              type="button"
              className={`${styles.controlBtn} ${panel === "reference" ? styles.controlBtnActive : ""}`}
              onClick={() => {
                setPanel((p) => (p === "reference" ? null : "reference"));
                setPickerSlot(null);
              }}
            >
              Reference
            </button>

            <button
              type="button"
              className={`${styles.controlBtn} ${panel === "model" ? styles.controlBtnActive : ""}`}
              onClick={() => setPanel((p) => (p === "model" ? null : "model"))}
            >
              Model
            </button>

            <button
              type="button"
              className={`${styles.controlBtn} ${panel === "parameters" ? styles.controlBtnActive : ""}`}
              onClick={() => setPanel((p) => (p === "parameters" ? null : "parameters"))}
            >
              Parameters
            </button>

            <button
              type="button"
              className={`${styles.controlBtn} ${panel === "styles" ? styles.controlBtnActive : ""}`}
              onClick={() => setPanel((p) => (p === "styles" ? null : "styles"))}
            >
              Styles
            </button>

            <div className={styles.creditPill}>Credits Cost: XXXX</div>
          </div>

          {/* POPOVERS */}
          {panel && (
            <div ref={popoverRef} className={styles.popover}>
              {/* Reference */}
              {panel === "reference" && (
                <div className={styles.popoverInner}>
                  <div className={styles.popoverHeader}>
                    <div className={styles.popoverTitle}>Reference</div>
                    <button className={styles.closeBtn} onClick={() => setPanel(null)} type="button">
                      <Icon name="close" />
                    </button>
                  </div>

                  <div className={styles.refSlots}>
                    {(["char1", "char2", "char3", "background"] as RefSlot[]).map((slot) => {
                      const a = refs[slot];
                      return (
                        <div key={slot} className={styles.refSlot}>
                          <div className={styles.refSlotLeft}>
                            <div className={styles.refSlotLabel}>{SLOT_LABEL[slot]}</div>
                            <div className={styles.refSlotThumb}>
                              {a ? <img src={a.url} alt={a.name} /> : <div className={styles.refSlotEmpty}>EMPTY</div>}
                            </div>
                          </div>

                          <div className={styles.refSlotRight}>
                            <button
                              type="button"
                              className={styles.smallBtn}
                              onClick={() => {
                                setPickerSlot(slot);
                                setPickerQuery("");
                              }}
                            >
                              Pick
                            </button>

                            <label className={styles.smallBtn}>
                              Upload
                              <input
                                type="file"
                                accept="image/*"
                                style={{ display: "none" }}
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) handleUploadToSlot(slot, f);
                                  e.currentTarget.value = "";
                                }}
                              />
                            </label>

                            <button
                              type="button"
                              className={styles.smallBtnGhost}
                              onClick={() => setRefSlot(slot, null)}
                              disabled={!a}
                            >
                              Clear
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {pickerSlot && (
                    <div className={styles.pickerArea}>
                      <div className={styles.pickerTop}>
                        <div className={styles.pickerTitle}>Pick for: {SLOT_LABEL[pickerSlot]}</div>
                        <button
                          type="button"
                          className={styles.smallBtnGhost}
                          onClick={() => setPickerSlot(null)}
                        >
                          Close
                        </button>
                      </div>

                      <input
                        className={styles.search}
                        placeholder="Search in history..."
                        value={pickerQuery}
                        onChange={(e) => setPickerQuery(e.target.value)}
                      />

                      <div className={styles.pickerGrid}>
                        {filteredPickerAssets.map((a) => (
                          <button
                            key={a.id}
                            type="button"
                            className={styles.pickerTile}
                            onClick={() => {
                              setRefSlot(pickerSlot, a);
                              setPickerSlot(null);
                              setPanel(null); // auto-close al seleccionar
                            }}
                          >
                            <img src={a.url} alt={a.name} />
                            <div className={styles.pickerTileCap}>
                              {removeStylePresetBlock(a.prompt || "") || a.name}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Model */}
              {panel === "model" && (
                <div className={styles.popoverInner}>
                  <div className={styles.popoverHeader}>
                    <div className={styles.popoverTitle}>Model</div>
                    <button className={styles.closeBtn} onClick={() => setPanel(null)} type="button">
                      <Icon name="close" />
                    </button>
                  </div>

                  <div className={styles.formRow}>
                    <label className={styles.formLabel}>Model</label>
                    <select
                      className={styles.select}
                      value={model}
                      onChange={(e) => {
                        setModel(e.target.value as GeminiModel);
                        setPanel(null); // auto-close
                      }}
                    >
                      <option value="imagen-4.0-generate-preview-06-06">imagen-4.0-generate-preview-06-06</option>
                      <option value="imagen-4.0-ultra-generate-preview-06-06">imagen-4.0-ultra-generate-preview-06-06</option>
                      <option value="imagen-3.0-generate-002">imagen-3.0-generate-002</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Parameters */}
              {panel === "parameters" && (
                <div className={styles.popoverInner}>
                  <div className={styles.popoverHeader}>
                    <div className={styles.popoverTitle}>Parameters</div>
                    <button className={styles.closeBtn} onClick={() => setPanel(null)} type="button">
                      <Icon name="close" />
                    </button>
                  </div>

                  <div className={styles.paramGrid}>
                    <div className={styles.formRow}>
                      <label className={styles.formLabel}>Aspect Ratio</label>
                      <select
                        className={styles.select}
                        value={aspectRatio}
                        onChange={(e) => {
                          setAspectRatio(e.target.value);
                          setPanel(null); // auto-close
                        }}
                      >
                        <option value="1:1">1:1</option>
                        <option value="4:5">4:5</option>
                        <option value="3:4">3:4</option>
                        <option value="16:9">16:9</option>
                        <option value="9:16">9:16</option>
                      </select>
                    </div>

                    <div className={styles.formRow}>
                      <label className={styles.formLabel}>Count</label>
                      <select
                        className={styles.select}
                        value={count}
                        onChange={(e) => {
                          setCount(Number(e.target.value));
                          setPanel(null); // auto-close
                        }}
                      >
                        <option value={1}>1</option>
                        <option value={2}>2</option>
                        <option value={3}>3</option>
                        <option value={4}>4</option>
                      </select>
                    </div>

                    <div className={styles.formRow}>
                      <label className={styles.formLabel}>Quality</label>
                      <select
                        className={styles.select}
                        value={quality}
                        onChange={(e) => {
                          setQuality(e.target.value as any);
                          setPanel(null); // auto-close
                        }}
                      >
                        <option value="1K">1K</option>
                        <option value="2K">2K</option>
                        <option value="4K">4K</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Styles (solo este selector) */}
              {panel === "styles" && (
                <div className={styles.popoverInner}>
                  <div className={styles.popoverHeader}>
                    <div className={styles.popoverTitle}>Styles</div>
                    <div className={styles.headerRight}>
                      <button
                        type="button"
                        className={styles.smallBtnGhost}
                        onClick={() => {
                          setSelectedStyleId(null);
                          setPanel(null);
                        }}
                      >
                        Clear
                      </button>

                      <button className={styles.closeBtn} onClick={() => setPanel(null)} type="button">
                        <Icon name="close" />
                      </button>
                    </div>
                  </div>

                  <div className={styles.presetGrid}>
                    {STYLE_PRESETS.map((p) => {
                      const active = selectedStyleId === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          className={`${styles.presetCard} ${active ? styles.presetCardActive : ""}`}
                          onClick={() => {
                            setSelectedStyleId(p.id);
                            setPanel(null); // auto-close
                          }}
                        >
                          <div className={styles.presetCover}>
                            {p.coverUrl ? <img src={p.coverUrl} alt={p.name} /> : <div className={styles.presetCoverEmpty} />}
                          </div>
                          <div className={styles.presetName}>{p.name}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* VIEWER OVERLAY (al click en imagen) */}
      {viewer && (
        <div className={styles.viewerBackdrop} onClick={() => setViewer(null)}>
          <div className={styles.viewer} onClick={(e) => e.stopPropagation()}>
            <div className={styles.viewerTop}>
              <div className={styles.viewerTitle}>
                <span className={styles.viewerKicker}>GENERATION</span>
                <span className={styles.viewerSub}>{viewer.isPublic ? "PUBLIC" : "PRIVATE"}</span>
              </div>

              <div className={styles.viewerTopActions}>
                <button className={styles.iconBtn} type="button" title="Copiar prompt" onClick={() => copyToClipboard(viewer.prompt || "")}>
                  <Icon name="copy" />
                </button>

                <button className={styles.iconBtn} type="button" title="Reusar prompt" onClick={() => reusePromptFromAsset(viewer)}>
                  <Icon name="reuse" />
                </button>

                <button className={styles.iconBtn} type="button" title={viewer.isPublic ? "Quitar de público" : "Publicar"} onClick={() => handleTogglePublish(viewer)}>
                  <Icon name="share" />
                </button>

                <button className={styles.iconBtn} type="button" title="Descargar" onClick={() => handleDownload(viewer)}>
                  <Icon name="download" />
                </button>

                <button className={styles.iconBtnDanger} type="button" title="Eliminar" onClick={() => handleDelete(viewer)}>
                  <Icon name="trash" />
                </button>

                <button className={styles.closeBtn} type="button" onClick={() => setViewer(null)} title="Cerrar">
                  <Icon name="close" />
                </button>
              </div>
            </div>

            <div className={styles.viewerBody}>
              <div className={styles.viewerImageWrap}>
                <img className={styles.viewerImage} src={viewer.url} alt={viewer.name} />
              </div>

              <div className={styles.viewerRecipe}>
                <div className={styles.viewerRecipeTitle}>RECIPE</div>

                <div className={styles.viewerRecipeRow}>
                  <div className={styles.viewerRecipeChip}>
                    <span className={styles.viewerRecipeLabel}>Prompt</span>
                    <span className={styles.viewerRecipeValue}>
                      {removeStylePresetBlock(viewer.prompt || "") || "—"}
                    </span>
                  </div>
                </div>

                <div className={styles.viewerRecipeRow}>
                  <div className={styles.viewerRecipeChip}>
                    <span className={styles.viewerRecipeLabel}>Full Prompt</span>
                    <textarea className={styles.viewerPrompt} readOnly value={viewer.prompt || ""} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <ErrorModal
          message={error}
          onClose={() => setError(null)}
        />
      )}
    </div>
  );
};

export default ImageGeneratorTool;