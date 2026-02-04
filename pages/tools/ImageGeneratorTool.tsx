import React, { useEffect, useMemo, useState } from "react";
import { generateImageBatch } from "../../services/geminiService";
import { listMyAssets, publishAsset, unpublishAsset, uploadUserAsset } from "../../services/assetsApi";
import { useAuth } from "../../contexts/AuthContext";
import { Asset, GeminiModel } from "../../types";
import GenerationHistory from "../../components/GenerationHistory";
import ErrorModal from "../../components/ErrorModal";

type StylePreset = {
  id: string;
  name: string;
  prompt: string;
  coverUrl?: string; // imagen principal del estilo
  exampleUrls?: [string, string, string, string]; // 4 imágenes para el collage 2x2
};

const STYLE_PRESET_BLOCK_START = "[[STYLE_PRESET_START]]";
const STYLE_PRESET_BLOCK_END = "[[STYLE_PRESET_END]]";

// soporte para prompts viejos ya guardados en historial
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

// ✅ ESTILOS (puedes cambiar prompts e imágenes cuando quieras)
const STYLE_PRESETS: StylePreset[] = [
  {
    id: "live_action",
    name: "Live Action",
    coverUrl: "/style-presets/LiveAction/cover.png",
    exampleUrls: [
      "/style-presets/LiveAction/1.png",
      "/style-presets/LiveAction/2.jpg",
      "/style-presets/LiveAction/3.png",
      "/style-presets/LiveAction/4.jpg",
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
    exampleUrls: [
      "/style-presets/luxury/1.jpg",
      "/style-presets/luxury/2.jpg",
      "/style-presets/luxury/3.jpg",
      "/style-presets/luxury/4.jpg",
    ],
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
    exampleUrls: [
      "/style-presets/pixar/1.jpg",
      "/style-presets/pixar/2.jpg",
      "/style-presets/pixar/3.jpg",
      "/style-presets/pixar/4.jpg",
    ],
    prompt: `
STYLE: High-quality 3D animation look (family-friendly, stylized).
Materials: smooth but detailed shaders, soft bounce light, clean render.
Colors: vibrant but balanced, pleasing tones, gentle bloom.
Rules: no uncanny realism, keep shapes clean, avoid noise/artifacts.
    `.trim(),
  },
];

type Quality = "" | "1K" | "2K" | "4K";
type RefSlot = "char1" | "char2" | "char3" | "style" | "background";

const TOOL_ID = "image-generator";
const REF_TOOL_ID = "image-generator-ref";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    (typeof err === "string" ? err : "Failed to generate image.")
  );
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

// ===== Hidden Style Prompt (never show to user) =====
const STYLE_BLOCK_START = STYLE_PRESET_BLOCK_START;
const STYLE_BLOCK_END = STYLE_PRESET_BLOCK_END;

function splitStyleBlock(text: string): { cleaned: string; style: string | null } {
  const pairs = [
    { start: STYLE_BLOCK_START, end: STYLE_BLOCK_END }, // nuevo
    { start: LEGACY_STYLE_PRESET_BLOCK_START, end: LEGACY_STYLE_PRESET_BLOCK_END }, // legacy
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

  // Evitar duplicarlo si ya existiera
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

const ImageGeneratorTool: React.FC = () => {
  const { user } = useAuth();

  // Prompt + config
  const [prompt, setPrompt] = useState("");
  // Aquí se guarda el prompt del estilo, pero NUNCA se muestra al usuario
  const [hiddenStylePrompt, setHiddenStylePrompt] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState<string>(GeminiModel.IMAGE);
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [count, setCount] = useState<number>(1);
  const [quality, setQuality] = useState<Quality>("1K");
  const isNanoBanana = model === GeminiModel.IMAGE;
  const isNanoBananaPro = model === GeminiModel.IMAGE_PRO;

  useEffect(() => {
    if (isNanoBananaPro) setCount(1);
  }, [isNanoBananaPro]);

  useEffect(() => {
    if (isNanoBanana) setQuality("1K");
  }, [isNanoBanana]);

  // Errors
  const [error, setError] = useState<string | null>(null);

  // History
  const [history, setHistory] = useState<Asset[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);

  // Latest batch (variations)
  const [latestBatch, setLatestBatch] = useState<Array<{ assetId: string; url: string }>>([]);

  // Refs
  const [refs, setRefs] = useState<Record<RefSlot, Asset | null>>({
    char1: null,
    char2: null,
    char3: null,
    style: null,
    background: null,
  });

  // Picker modal state
  const [pickerSlot, setPickerSlot] = useState<RefSlot | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");

  // Style selector state
  const [styleModalOpen, setStyleModalOpen] = useState(false);
  const [stylePresetId, setStylePresetId] = useState<string | null>(null);

  const selectedStylePreset = useMemo(() => {
    return STYLE_PRESETS.find((s) => s.id === stylePresetId) || null;
  }, [stylePresetId]);

  const imageHistory = useMemo(() => history.filter((a) => a.type === "image" && a.url), [history]);

  const filteredPickerAssets = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return imageHistory;
    return imageHistory.filter((a) => (a.prompt || a.name || "").toLowerCase().includes(q));
  }, [imageHistory, pickerQuery]);

  // Si por cualquier razón el prompt tiene un bloque de estilo dentro,
  // lo extraemos y lo ocultamos para que el usuario NUNCA lo vea.
  useEffect(() => {
    if (!prompt.includes(STYLE_BLOCK_START)) return;

    const { cleaned, style } = splitStyleBlock(prompt);

    if (style) setHiddenStylePrompt(style);
    if (cleaned !== prompt) setPrompt(cleaned);
  }, [prompt]);

  // Load user's history on mount
  useEffect(() => {
    if (!user) return;

    (async () => {
      try {
        const images = await listMyAssets({ type: "image", limit: 80 });

        const cleanImages = images.map((a) => ({
          ...a,
          prompt: stripStyleBlock(a.prompt || ""),
        }));

        setHistory(cleanImages);
        setSelectedAsset(cleanImages.length > 0 ? cleanImages[0] : null);
      } catch (err: any) {
        setError(err?.message || "No se pudo cargar el historial.");
      }
    })();
  }, [user]);

  const setRefSlot = (slot: RefSlot, asset: Asset | null) => {
    setRefs((prev) => ({ ...prev, [slot]: asset }));
  };

  const handleUploadRef = async (slot: RefSlot, file: File) => {
    if (!user) return;
    setError(null);

    try {
      const asset = await uploadUserAsset(file, REF_TOOL_ID);
      setRefSlot(slot, asset);

      // UX rápido
      setHistory((prev) => [asset, ...prev]);
    } catch (err: any) {
      setError(err?.message || "No se pudo subir la referencia.");
    }
  };

  const handleGenerate = async () => {
    const safePrompt = String(prompt ?? "").trim();
    if (!safePrompt) return;

    const safeModel =
      model === GeminiModel.IMAGE || model === GeminiModel.IMAGE_PRO ? model : GeminiModel.IMAGE;

    setLoading(true);
    setError(null);

    const characterAssetIds = [refs.char1, refs.char2, refs.char3]
      .filter(Boolean)
      .map((a) => (a as Asset).id);

    const effectiveQuality = isNanoBanana ? ("1K" as Quality) : quality;
    const effectiveCount = isNanoBananaPro ? 1 : count;

    const backgroundAutoPrompt = refs.background
      ? `
  [BACKGROUND AUTO-RULES]
  - Use the Background reference image as the scene/environment/backdrop.
  - Match its lighting direction, color temperature, contrast, shadows, and overall mood so the subject looks naturally integrated.
  - Keep the scene geometry/perspective consistent with the background reference.
  - If my text prompt explicitly asks for a different background or lighting, follow my text prompt.
  - If a Style reference is provided, prioritize the Style for the artistic look, but keep the environment/lighting grounded in the Background reference unless my text says otherwise.
  `.trim()
      : "";

    // ✅ Solo aplica preset si realmente hay uno seleccionado
    const presetStyle = stylePresetId ? hiddenStylePrompt : "";

    const basePrompt = `${safePrompt}${backgroundAutoPrompt}`.trim();
    const styleText = stylePresetId ? hiddenStylePrompt : "";
    const finalPrompt = attachStyleBlock(basePrompt, styleText || null);

    const run = () =>
      generateImageBatch(finalPrompt, safeModel, {
        aspectRatio,
        count: effectiveCount,
        quality: effectiveQuality || undefined,
        tool: TOOL_ID,
        nameHint: "generated",
        characterAssetIds,
        styleAssetId: refs.style?.id,
        backgroundAssetId: refs.background?.id,
      });

    try {
      let res: any;

      // ✅ retry 1 vez si es temporal (429/timeout/network)
      try {
        res = await run();
      } catch (e1: any) {
        if (isRetryable(e1)) {
          await sleep(900);
          res = await run();
        } else {
          throw e1;
        }
      }

      setLatestBatch(res.items);

      // preview inmediata aunque falle el historial
      if (res.items?.[0] && user) {
        setSelectedAsset(makeTempAsset(res.items[0], safePrompt, user.id));
      }

      // ✅ refresco historial en try separado: si falla NO debe parecer “falló generar”
      try {
        const images = await listMyAssets({ type: "image", limit: 80 });

        const cleanImages = images.map((a) => ({
          ...a,
          prompt: stripStyleBlock(a.prompt || ""),
        }));

        setHistory(cleanImages);

        const firstId = res.items?.[0]?.assetId;
        const found = firstId ? images.find((a) => a.id === firstId) : null;
        setSelectedAsset(found || (images.length > 0 ? images[0] : null));
      } catch (histErr: any) {
        console.warn("History refresh failed:", histErr);
        setError(formatErr(histErr) || "La imagen se generó, pero falló el refresco del historial.");
      }
    } catch (err: any) {
      console.error("Generate failed:", err);
      setError(formatErr(err));
    } finally {
      setLoading(false);
    }
  };

  const handleTogglePublic = async () => {
    if (!selectedAsset) return;

    try {
      const makePublic = !selectedAsset.isPublic;
      const result = makePublic ? await publishAsset(selectedAsset.id) : await unpublishAsset(selectedAsset.id);

      setSelectedAsset({ ...selectedAsset, isPublic: result.isPublic });
      setHistory((prev) => prev.map((a) => (a.id === selectedAsset.id ? { ...a, isPublic: result.isPublic } : a)));
    } catch (err: any) {
      setError(err?.message || "No se pudo cambiar la visibilidad.");
    }
  };

  const handleDownload = () => {
    if (!selectedAsset?.url) return;
    const a = document.createElement("a");
    a.href = selectedAsset.url;
    a.download = `${selectedAsset.name || "image"}.png`;
    a.rel = "noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handlePickFromBatch = (item: { assetId: string; url: string }) => {
    const found = history.find((a) => a.id === item.assetId);
    if (found) {
      setSelectedAsset(found);
      return;
    }
    if (user) setSelectedAsset(makeTempAsset(item, prompt, user.id));
  };

  const StyleCard = () => {
  return (
    <div className="bg-black/30 border border-white/10 rounded-2xl p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Style</span>

        {stylePresetId ? (
          <button
            type="button"
            onClick={() => {
              setStylePresetId(null);
              setHiddenStylePrompt(""); // ✅ IMPORTANTE: si no limpias esto, el estilo se sigue aplicando oculto
              setPrompt((prev) => removeStylePresetBlock(prev).trim());
            }}
            className="text-[10px] font-bold text-gray-300 hover:text-white"
          >
            CLEAR
          </button>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => setStyleModalOpen(true)}
        className="w-full aspect-video rounded-xl overflow-hidden border border-white/10 bg-black/40 hover:bg-white/5 transition relative"
      >
        {selectedStylePreset?.coverUrl ? (
          <img
            src={encodeURI(selectedStylePreset.coverUrl)}
            alt={selectedStylePreset.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-white/30">Click to choose a style</div>
        )}

        {selectedStylePreset ? (
          <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
            <div className="text-[11px] font-bold text-white">{selectedStylePreset.name}</div>
          </div>
        ) : null}
      </button>

      <button
        type="button"
        onClick={() => setStyleModalOpen(true)}
        className="mt-2 w-full text-[10px] font-bold py-2 rounded-xl bg-white text-black hover:scale-[1.02] transition"
      >
        CHOOSE
      </button>
    </div>
  );
};

  const RefCard = ({ slot, label, asset }: { slot: RefSlot; label: string; asset: Asset | null }) => {
    return (
      <div className="bg-black/30 border border-white/10 rounded-2xl p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</span>
          {asset ? (
            <button onClick={() => setRefSlot(slot, null)} className="text-[10px] font-bold text-gray-300 hover:text-white" type="button">
              CLEAR
            </button>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => setPickerSlot(slot)}
          className="w-full aspect-video rounded-xl overflow-hidden border border-white/10 bg-black/40 hover:bg-white/5 transition relative"
        >
          {asset ? (
            <img src={asset.url} alt={asset.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xs text-white/30">Click to pick from history</div>
          )}
        </button>

        <div className="mt-2 flex items-center gap-2">
          <label className="flex-1">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUploadRef(slot, f);
                e.currentTarget.value = "";
              }}
            />
            <span className="block text-center text-[10px] font-bold py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 cursor-pointer">
              UPLOAD
            </span>
          </label>

          <button
            type="button"
            onClick={() => setPickerSlot(slot)}
            className="flex-1 text-[10px] font-bold py-2 rounded-xl bg-white text-black hover:scale-[1.02] transition"
          >
            PICK
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col lg:flex-row gap-6 animate-in fade-in zoom-in duration-500 min-h-[650px]">
      <ErrorModal error={error} onClose={() => setError(null)} />

      {/* History Sidebar */}
      <div className="w-full lg:w-48 lg:flex-shrink-0 order-3 lg:order-1 h-32 lg:h-auto">
        <GenerationHistory assets={history} onSelect={setSelectedAsset} selectedId={selectedAsset?.id} title="History" />
      </div>

      {/* Controls */}
      <div className="w-full lg:w-1/3 space-y-6 order-2">
        <div className="glass-panel p-6 rounded-3xl border border-white/10">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-white/10 rounded-lg">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
                <path d="M9 18h6" />
                <path d="M10 22h4" />
              </svg>
            </div>
            <h2 className="text-xl font-bold">Image Generator</h2>
          </div>

          {/* References */}
          <div className="space-y-3 mb-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">References</h3>
              <span className="text-[10px] text-white/30">optional</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <RefCard slot="char1" label="Character 1" asset={refs.char1} />
              <RefCard slot="char2" label="Character 2" asset={refs.char2} />
              <RefCard slot="char3" label="Character 3" asset={refs.char3} />
              <div className="col-span-2">
                <StyleCard />
              </div>
              <div className="col-span-2">
                <RefCard slot="background" label="Background" asset={refs.background} />
              </div>
            </div>
          </div>

          {/* Config */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Model</label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full bg-black/50 border border-white/20 rounded-xl px-2 py-2 text-xs focus:border-white focus:outline-none"
                >
                  <option value={GeminiModel.IMAGE}>NanoBanana</option>
                  <option value={GeminiModel.IMAGE_PRO}>NanoBanana Pro</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Ratio</label>
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value)}
                  className="w-full bg-black/50 border border-white/20 rounded-xl px-2 py-2 text-xs focus:border-white focus:outline-none"
                >
                  <option value="1:1">1:1 (Square)</option>
                  <option value="3:2">3:2 (Landscape)</option>
                  <option value="2:3">2:3 (Portrait)</option>
                  <option value="3:4">3:4 (Portrait)</option>
                  <option value="4:3">4:3 (Landscape)</option>
                  <option value="4:5">4:5 (Portrait)</option>
                  <option value="5:4">5:4 (Landscape)</option>
                  <option value="9:16">9:16 (Vertical)</option>
                  <option value="16:9">16:9 (Widescreen)</option>
                  <option value="21:9">21:9 (Cinematic)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Count</label>
                <select
                  value={count}
                  onChange={(e) => setCount(parseInt(e.target.value, 10))}
                  disabled={isNanoBananaPro}
                  className="w-full bg-black/50 border border-white/20 rounded-xl px-2 py-2 text-xs focus:border-white focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                  <option value={4}>4</option>
                </select>
              </div>

              {isNanoBananaPro && (
                <div className="mt-1 text-xs text-white/60">
                  NanoBanana Pro genera 1 imagen por request.
                </div>
              )}

              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Quality</label>
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value as Quality)}
                  disabled={isNanoBanana}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">Auto</option>
                  <option value="1K">1K</option>
                  <option value="2K">2K</option>
                  <option value="4K">4K</option>
                </select>
              </div>
            </div>

            {isNanoBanana && (
              <div className="mt-1 text-xs text-white/60">
                NanoBanana genera en 1K fijo.
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Prompt</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe what you want to generate..."
                className="w-full h-32 bg-black/50 border border-white/20 rounded-xl px-4 py-3 focus:outline-none focus:border-white resize-none text-sm"
              />
            </div>

            <button
              onClick={handleGenerate}
              disabled={loading || !prompt.trim()}
              className={`w-full py-4 rounded-xl font-bold text-black transition-all ${
                loading ? "bg-gray-600" : "bg-white hover:scale-[1.02] shadow-[0_0_20px_white]"
              }`}
            >
              {loading ? "GENERATING..." : "GENERATE"}
            </button>
          </div>
        </div>
      </div>

      {/* Main Preview Area */}
      <div className="flex-1 glass-panel rounded-3xl border border-white/10 flex flex-col relative overflow-hidden min-h-[400px] order-1 lg:order-3">
        {selectedAsset ? (
          <>
            <div className="flex-1 flex flex-col items-center justify-center p-4 gap-4">
              <img src={selectedAsset.url} alt="Generated" className="max-w-full max-h-[70%] object-contain shadow-2xl rounded-lg animate-in fade-in" />

              {latestBatch.length > 0 && (
                <div className="w-full max-w-4xl">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Variations</span>
                    <button type="button" onClick={() => setLatestBatch([])} className="text-[10px] font-bold text-gray-300 hover:text-white">
                      CLEAR
                    </button>
                  </div>

                  <div className="flex gap-3 overflow-x-auto custom-scrollbar pb-2">
                    {latestBatch.map((it) => (
                      <button
                        key={it.assetId}
                        type="button"
                        onClick={() => handlePickFromBatch(it)}
                        className={`relative flex-shrink-0 w-28 h-28 rounded-xl overflow-hidden border-2 transition ${
                          selectedAsset.id === it.assetId ? "border-white" : "border-white/10 hover:border-white/40"
                        }`}
                      >
                        <img src={it.url} alt="variation" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-white/10 bg-black/40 backdrop-blur-md flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400 font-mono">{new Date(selectedAsset.createdAt).toLocaleString()}</p>
                {selectedAsset.isPublic && <span className="text-[10px] text-green-400 font-bold">PUBLISHED TO COMMUNITY</span>}
              </div>

              <div className="flex gap-3 items-center">
                <button onClick={handleDownload} className="text-xs font-bold text-white hover:text-gray-300">
                  Download
                </button>
                <button onClick={handleTogglePublic} className="text-xs font-bold text-white hover:text-gray-300">
                  {selectedAsset.isPublic ? "Privatizar" : "Publicar"}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-center text-white/20">
            <div>
              <p className="font-mono text-sm mb-2">NO IMAGE SELECTED</p>
              <p className="text-xs">Generate a new image or select from history.</p>
            </div>
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
            <div className="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-sm font-mono tracking-widest animate-pulse">CREATING...</p>
          </div>
        )}
      </div>

      {/* Style Modal */}
      {styleModalOpen && (
        <div className="fixed inset-0 z-[999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel w-full max-w-3xl rounded-3xl border border-white/10 overflow-hidden">
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold">Choose a style</p>
                <p className="text-[10px] text-white/40">Pick one preset and it will be added to your prompt automatically.</p>
              </div>
              <button
                type="button"
                onClick={() => setStyleModalOpen(false)}
                className="text-xs font-bold text-white/70 hover:text-white"
              >
                CLOSE
              </button>
            </div>

            <div className="p-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto custom-scrollbar pr-1">
                {STYLE_PRESETS.map((s) => {
                  const isSelected = s.id === stylePresetId;

                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setStylePresetId(s.id);
                        setPrompt((prev) => applyStylePresetToPrompt(prev, s.prompt));
                        setStyleModalOpen(false);
                      }}
                      className={[
                        "group relative aspect-square rounded-2xl overflow-hidden border transition",
                        isSelected ? "border-white/70" : "border-white/10 hover:border-white/40",
                      ].join(" ")}
                    >
                      {/* Cover */}
                      {s.coverUrl ? (
                        <img src={encodeURI(s.coverUrl)} alt={s.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-white/30 bg-black/40">{s.name}</div>
                      )}

                      {/* Collage 2x2 (aparece al hover) */}
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="grid grid-cols-2 grid-rows-2 w-full h-full">
                          {(s.exampleUrls ? Array.from(s.exampleUrls) : [null, null, null, null]).map((url, idx) => (
                            <div key={idx} className="relative w-full h-full">
                              {url ? (
                                <img src={encodeURI(url)} alt={`${s.name} example ${idx + 1}`} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full bg-white/5" />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Name label */}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-2">
                        <div className="text-[10px] font-bold text-white text-left">{s.name}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Picker Modal */}
      {pickerSlot && (
        <div className="fixed inset-0 z-[999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel w-full max-w-3xl rounded-3xl border border-white/10 overflow-hidden">
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold">Pick reference</p>
                <p className="text-[10px] text-white/40">Slot: {pickerSlot}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPickerSlot(null);
                  setPickerQuery("");
                }}
                className="text-xs font-bold text-white/70 hover:text-white"
              >
                CLOSE
              </button>
            </div>

            <div className="p-4">
              <input
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                placeholder="Search by prompt/name..."
                className="w-full mb-4 bg-black/50 border border-white/20 rounded-xl px-4 py-3 focus:outline-none focus:border-white text-sm"
              />

              {filteredPickerAssets.length === 0 ? (
                <div className="text-center text-white/30 py-10">No images in history. Generate or upload an image first.</div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[60vh] overflow-y-auto custom-scrollbar pr-1">
                  {filteredPickerAssets.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => {
                        setRefSlot(pickerSlot, a);
                        setPickerSlot(null);
                        setPickerQuery("");
                      }}
                      className="group relative aspect-square rounded-2xl overflow-hidden border border-white/10 hover:border-white/40 transition"
                    >
                      <img src={a.url} alt={a.name} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                        <span className="text-[10px] text-white truncate w-full text-left">{a.prompt || a.name}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImageGeneratorTool;
