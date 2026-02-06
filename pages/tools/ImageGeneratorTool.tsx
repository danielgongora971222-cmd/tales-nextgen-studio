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
// Kling tiene un límite duro en el tamaño del prompt.
// Si además usas presets largos (como Live Action), puede romper el límite.
// Por eso forzamos un máximo y usamos una versión “corta” de los estilos.
const KLING_PROMPT_MAX = 2500;

function isKlingModel(modelId: string) {
  return (modelId || "").startsWith("kling:");
}


function makeKlingSafeStyle(styleId: string | null, stylePrompt: string): string {
  const p = (stylePrompt || "").trim();
  if (!p) return "";

  switch (styleId) {
    case "live_action":
      return [
        "STYLE: Cinematic live-action photorealism.",
        "Lighting: film lighting, natural soft shadows, realistic materials and textures.",
        "Color: natural/balanced, subtle depth of field, no oversaturation.",
        "Rules: keep identity and composition consistent with references; do not add new objects.",
      ].join("\n");

    case "luxury_product":
      return [
        "STYLE: Luxury product advertising in a clean studio.",
        "Lighting: controlled specular highlights, soft gradients, premium reflections; no harsh glare.",
        "Composition: centered hero shot, elegant negative space, minimal clutter.",
        "Quality: sharp micro-detail, commercial polish.",
      ].join("\n");

    case "pixar_3d":
      return [
        "STYLE: High-quality 3D animated look (Pixar-ish, family-friendly, stylized).",
        "Lighting: soft bounce light, clean render, gentle bloom.",
        "Materials: smooth but detailed shaders; vibrant but balanced colors.",
        "Rules: avoid uncanny realism and noisy artifacts; keep shapes clean.",
      ].join("\n");

    default:
      // Fallback: si el estilo viene “custom” o es muy largo, lo recortamos.
      return p.length <= 700 ? p : p.slice(0, 700);
  }
}

type NanoModel = "imagen-4.0-generate-preview-06-06" | "imagen-4.0-ultra-generate-preview-06-06";

const NANO_MODELS: { id: NanoModel; label: string }[] = [
  { id: "imagen-4.0-generate-preview-06-06", label: "NanoBanana" },
  { id: "imagen-4.0-ultra-generate-preview-06-06", label: "NanoBanana Pro" },
];

function nanoModelLabel(id: string): string {
  return NANO_MODELS.find((m) => m.id === id)?.label ?? id;
}

type ModelCaps = {
  id: string;
  label: string;
  supportsRefs: boolean;
  aspectRatios: { value: string; label: string }[];
  qualities: Quality[];
  countOptions: number[];
};

const MODEL_CAPS: Record<string, ModelCaps> = {
  [GeminiModel.IMAGE]: {
    id: GeminiModel.IMAGE,
    label: "NanoBanana",
    supportsRefs: true,
    aspectRatios: [
      { value: "auto", label: "Auto" },
      { value: "1:1", label: "1:1" },
      { value: "4:5", label: "4:5" },
      { value: "3:4", label: "3:4" },
      { value: "16:9", label: "16:9" },
      { value: "9:16", label: "9:16" },
    ],
    qualities: ["1K"],
    countOptions: [1, 2, 3, 4],
  },

  [GeminiModel.IMAGE_PRO]: {
    id: GeminiModel.IMAGE_PRO,
    label: "NanoBanana Pro",
    supportsRefs: true,
    aspectRatios: [
      { value: "auto", label: "Auto" },
      { value: "1:1", label: "1:1" },
      { value: "4:5", label: "4:5" },
      { value: "3:4", label: "3:4" },
      { value: "16:9", label: "16:9" },
      { value: "9:16", label: "9:16" },
    ],
    qualities: ["1K", "2K", "4K"],
    countOptions: [1],
  },

  "openai:gpt-image-1.5": {
    id: "openai:gpt-image-1.5",
    label: "GPT 1.5",
    supportsRefs: true,
    aspectRatios: [
      { value: "auto", label: "Auto" },
      { value: "1:1", label: "1:1" },
      { value: "3:2", label: "3:2" },
      { value: "2:3", label: "2:3" },
    ],
    qualities: ["1K"],
    countOptions: [1],
  },

  "openai:gpt-image-1.5-high": {
    id: "openai:gpt-image-1.5-high",
    label: "GPT 1.5 - high",
    supportsRefs: true,
    aspectRatios: [
      { value: "auto", label: "Auto" },
      { value: "1:1", label: "1:1" },
      { value: "3:2", label: "3:2" },
      { value: "2:3", label: "2:3" },
    ],
    qualities: ["1K"],
    countOptions: [1],
  },

  "fal-ai/flux-2-max": {
    id: "fal-ai/flux-2-max",
    label: "Flux 2.0 Max",
    supportsRefs: true,
    aspectRatios: [
      { value: "auto", label: "Auto" },
      { value: "1:1", label: "1:1" },
      { value: "4:5", label: "4:5" },
      { value: "3:4", label: "3:4" },
      { value: "16:9", label: "16:9" },
      { value: "9:16", label: "9:16" },
    ],
    qualities: ["1K", "2K", "4K"],
    countOptions: [1],
  },

  "fal-ai/flux-2-pro": {
    id: "fal-ai/flux-2-pro",
    label: "Flux 2.0 Pro",
    supportsRefs: true,
    aspectRatios: [
      { value: "auto", label: "Auto" },
      { value: "1:1", label: "1:1" },
      { value: "4:5", label: "4:5" },
      { value: "3:4", label: "3:4" },
      { value: "16:9", label: "16:9" },
      { value: "9:16", label: "9:16" },
    ],
    qualities: ["1K", "2K", "4K"],
    countOptions: [1, 2],
  },

  "fal-ai/flux-2-flex": {
    id: "fal-ai/flux-2-flex",
    label: "Flux 2.0 Flex",
    supportsRefs: true,
    aspectRatios: [
      { value: "auto", label: "Auto" },
      { value: "1:1", label: "1:1" },
      { value: "4:5", label: "4:5" },
      { value: "3:4", label: "3:4" },
      { value: "16:9", label: "16:9" },
      { value: "9:16", label: "9:16" },
    ],
    qualities: ["1K", "2K", "4K"],
    countOptions: [1, 2, 3, 4],
  },

    "kling:kling-image-o1": {
      id: "kling:kling-image-o1",
      label: "Kling o1",
      supportsRefs: true,
      aspectRatios: [
        { value: "auto", label: "Auto" },
        { value: "1:1", label: "1:1" },
        { value: "4:3", label: "4:3" },
        { value: "3:4", label: "3:4" },
        { value: "3:2", label: "3:2" },
        { value: "2:3", label: "2:3" },
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" },
        { value: "21:9", label: "21:9" },
      ],
      qualities: ["1K", "2K"],
      countOptions: [1],
    },
  };

function getActiveCaps(modelId: string) {
  return MODEL_CAPS[modelId] || MODEL_CAPS[GeminiModel.IMAGE];
}

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

function getStyleNameFromPrompt(prompt: string): string {
  const inside = extractStyleBlock(prompt || "");
  if (!inside) return "None";
  const match = STYLE_PRESETS.find((p) => (p.prompt || "").trim() === inside.trim());
  return match?.name || "Custom";
}

function prettyModelLabel(modelId: string | null): string {
  if (!modelId) return "Unknown";
  const caps = (MODEL_CAPS as Record<string, ModelCaps | undefined>)[modelId];
  if (caps?.label) return caps.label;
  return nanoModelLabel(modelId);
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

  // "library": todas tus imágenes (generadas + subidas) para el picker y recipe
  const [myAssets, setMyAssets] = useState<Asset[]>([]);

  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<string>(GeminiModel.IMAGE);
  const [aspectRatio, setAspectRatio] = useState("auto");
  const [count, setCount] = useState(1);
  const [quality, setQuality] = useState<Quality>("1K");


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

  const activeCaps = useMemo(() => getActiveCaps(model), [model]);
  const modelLabel = activeCaps.label;
  const paramsLabel = `${aspectRatio} • ${quality} • x${count}`;
  const styleLabel = selectedStyleId
    ? (STYLE_PRESETS.find((p) => p.id === selectedStyleId)?.name || "Selected")
    : "None";

    // Mantener aspect ratio / quality / count válidos según el modelo
    useEffect(() => {
      // Aspect ratio
      if (!activeCaps.aspectRatios.some((ar) => ar.value === aspectRatio)) {
        setAspectRatio(activeCaps.aspectRatios[0]?.value || "auto");
      }

      // Quality
      if (!activeCaps.qualities.includes(quality)) {
        setQuality(activeCaps.qualities[0] || "1K");
      }

      // Count
      if (!activeCaps.countOptions.includes(count)) {
        setCount(activeCaps.countOptions[0] || 1);
      }

      // Regla dura: NanoBanana (flash) solo soporta 1K (el backend lo rechaza si no)
      if (model === GeminiModel.IMAGE && quality !== "1K") {
        setQuality("1K");
      }
    }, [activeCaps, aspectRatio, quality, count, model]);

  const refLabel =
    [
      refs.char1 ? "C1" : null,
      refs.char2 ? "C2" : null,
      refs.char3 ? "C3" : null,
      refs.background ? "BG" : null,
    ].filter(Boolean).join(" ") || "None";

  // UI states
  const [panel, setPanel] = useState<Panel>(null);
  const [pickerSlot, setPickerSlot] = useState<RefSlot | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");

  const [viewer, setViewer] = useState<Asset | null>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [pendingSlots, setPendingSlots] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
    // Cache de dimensiones por imagen (para layout del historial y viewer responsive)
  const [imgDims, setImgDims] = useState<Record<string, { w: number; h: number }>>({});

  function rememberImgDims(assetId: string, img: HTMLImageElement) {
    const w = img.naturalWidth || 0;
    const h = img.naturalHeight || 0;
    if (!w || !h) return;
    setImgDims((prev) => (prev[assetId] ? prev : { ...prev, [assetId]: { w, h } }));
  }

  const popoverRef = useRef<HTMLDivElement>(null);

  const rootRef = useRef<HTMLDivElement>(null);

  function setRootGlow(xPct: number, yPct: number) {
    const el = rootRef.current;
    if (!el) return;
    el.style.setProperty("--mx", `${xPct}%`);
    el.style.setProperty("--my", `${yPct}%`);
  }

  function handleRootMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setRootGlow(x, y);
  }

  function handleRootMouseLeave() {
    setRootGlow(50, 20);
  }

  function isGeneratedHistoryItem(a: Asset): boolean {
    const meta = (a as any).meta || {};
    const metaTool = typeof meta.tool === "string" ? meta.tool : null;
    const source = typeof meta.source === "string" ? meta.source : null;
    const model = typeof meta.model === "string" ? meta.model : null;

    const hasPrompt = typeof a.prompt === "string" && a.prompt.trim().length > 0;

    // ✅ Regla dura: el historial SOLO muestra generaciones reales
    // - nunca uploads
    // - solo tool = image-generator
    // - y debe tener model (los uploads no lo tienen)
    if (source === "upload") return false;
    if (metaTool !== TOOL_ID) return false;
    if (!model) return false;
    if (!hasPrompt) return false;

    return true;
  }

  async function reloadHistory() {
    setIsLoadingHistory(true);
    try {
      // Importante:
      // - myAssets se usa como "biblioteca" para el picker y para reconstruir la receta (refs).
      // - NO filtramos las imágenes subidas como referencia aquí, porque si no, la receta no puede
      //   encontrar las miniaturas (characterAssetIds/backgroundAssetId) al abrir el viewer.
      const assets = await listMyAssets({ type: "image", limit: 300 });

      const sorted = [...assets].sort((a: any, b: any) => {
        const ta = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      });

      // 1) librería completa (para picker + recipe)
      setMyAssets(sorted);

      // 2) historial: SOLO generaciones de esta herramienta
      const onlyGenerated = sorted.filter(isGeneratedHistoryItem);
      setHistory(onlyGenerated);
    } catch (e: any) {
      setError(e?.message || "No se pudo cargar el historial.");
    } finally {
      setIsLoadingHistory(false);
    }
  }


  useEffect(() => {
    setRootGlow(50, 20);
    reloadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const viewerPortrait = useMemo(() => {
    if (!viewer) return false;
    const d = imgDims[viewer.id];
    if (!d) return false;
    return d.w / d.h < 0.85; // 9:16 y similares => apilar la receta abajo
  }, [viewer, imgDims]);

  const viewerRecipeInfo = useMemo(() => {
    if (!viewer) return null;

    const meta = (viewer as any).meta || {};
    const modelId = typeof meta.model === "string" ? meta.model : null;

    const aspectRatio = typeof meta.aspectRatio === "string" ? meta.aspectRatio : null;
    const quality = typeof meta.quality === "string" ? meta.quality : null;

    const count =
      typeof meta.count === "number"
        ? meta.count
        : typeof meta.count === "string"
          ? parseInt(meta.count, 10)
          : null;

    const characterAssetIds = Array.isArray(meta.characterAssetIds) ? meta.characterAssetIds : [];
    const backgroundAssetId = typeof meta.backgroundAssetId === "string" ? meta.backgroundAssetId : null;
    const styleAssetId = typeof meta.styleAssetId === "string" ? meta.styleAssetId : null;

    const findAsset = (id: string) => myAssets.find((a) => a.id === id) || null;

    return {
      modelId,
      aspectRatio,
      quality,
      count,
      styleName: getStyleNameFromPrompt(viewer.prompt || ""),
      refs: {
        chars: characterAssetIds.map(findAsset).filter(Boolean) as Asset[],
        bg: backgroundAssetId ? findAsset(backgroundAssetId) : null,
        style: styleAssetId ? findAsset(styleAssetId) : null,
        raw: { characterAssetIds, backgroundAssetId, styleAssetId },
      },
    };
  }, [viewer, myAssets]);

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
    if (!q) return myAssets;
    return myAssets.filter((a) => {
      const caption = removeStylePresetBlock(a.prompt || "").toLowerCase();
      return (a.name || "").toLowerCase().includes(q) || caption.includes(q);
    });
  }, [myAssets, pickerQuery]);

  const recipeStyleName = useMemo(() => {
    return getStyleNameFromPromptOrSelection({ prompt, selectedStyleId });
  }, [prompt, selectedStyleId]);

  const recipeChips = useMemo(() => {
    const refCount = Object.values(refs).filter(Boolean).length;
    const hasBg = !!refs.background;
    const chars = [refs.char1, refs.char2, refs.char3].filter(Boolean).length;

    return [
      { label: "Model", value: modelLabel },
      { label: "Ratio", value: aspectRatio },
      { label: "Count", value: String(count) },
      { label: "Quality", value: quality },
      { label: "Refs", value: `${chars} char${chars === 1 ? "" : "s"}${hasBg ? " + bg" : ""} (${refCount})` },
      { label: "Style", value: recipeStyleName },
    ];
  }, [model, aspectRatio, count, quality, refs, recipeStyleName]);

  function setRefSlot(slot: RefSlot, asset: Asset | null) {
    setRefs((prev) => {
      // Background es independiente
      if (slot === "background") {
        return { ...prev, background: asset };
      }

      // Character slots: siempre compactamos a la izquierda (char1 -> char2 -> char3)
      const current: (Asset | null)[] = [prev.char1, prev.char2, prev.char3];
      const idx = slot === "char1" ? 0 : slot === "char2" ? 1 : 2;

      const next = [...current];
      next[idx] = asset;

      // Compactar: elimina huecos (null) y vuelve a llenar 3 slots
      const packed = next.filter(Boolean) as Asset[];

      return {
        ...prev,
        char1: packed[0] || null,
        char2: packed[1] || null,
        char3: packed[2] || null,
      };
    });
  }

  async function handleUploadToSlot(slot: RefSlot, file: File) {
    try {
      const uploaded = await uploadUserAsset(file, REF_TOOL_ID);
      setRefSlot(slot, uploaded);
      setPanel(null); // auto-close
      setPickerSlot(null);
      setPickerQuery("");
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
    // crea "slots" temporales en el historial (uno por imagen a generar)
    {
      const n = Math.max(1, Math.min(4, Number(count) || 1));
      const stamp = Date.now();
      setPendingSlots(Array.from({ length: n }, (_, i) => `pending-${stamp}-${i}`));
    }
    setError(null);

    try {
      // IDs para backend
      const characterAssetIds = [refs.char1?.id, refs.char2?.id, refs.char3?.id].filter(Boolean) as string[];
      const backgroundAssetId = refs.background?.id;

      // Prompt final (receta real): base + background rules + style block
      const kling = isKlingModel(model);

      // Kling: si el prompt trae un bloque de estilo guardado (por “Reuse prompt”),
      // lo limpiamos y re-adjuntamos una versión corta para no romper el límite.
      const split = kling ? splitStyleBlock(basePrompt) : { cleaned: basePrompt, style: null };
      let finalPrompt = kling ? split.cleaned : basePrompt;

      if (backgroundAssetId) {
        finalPrompt = `${finalPrompt}\n\n${BACKGROUND_AUTO_PROMPT}`.trim();
      }

      // Solo aplica preset si el usuario eligió uno en Styles.
      // Si NO eliges estilo nuevo, para Kling reusamos el estilo embebido (pero “corto”).
      if (selectedStylePrompt) {
        const styleForModel = kling ? makeKlingSafeStyle(selectedStyleId, selectedStylePrompt) : selectedStylePrompt;
        finalPrompt = applyStylePresetToPrompt(finalPrompt, styleForModel);
      } else if (kling && split.style) {
        const embeddedId =
          STYLE_PRESETS.find((p) => (p.prompt || "").trim() === (split.style || "").trim())?.id || null;
        const styleForModel = makeKlingSafeStyle(embeddedId, split.style);
        finalPrompt = applyStylePresetToPrompt(finalPrompt, styleForModel);
      }

      // Guardrail: Kling limita el prompt completo a 2500 caracteres.
      if (kling && finalPrompt.length > KLING_PROMPT_MAX) {
        throw new Error(
          `Kling limita el prompt a ${KLING_PROMPT_MAX} caracteres. Tu prompt final tiene ${finalPrompt.length}. ` +
            `Reduce el texto (o quita Style/Background) y vuelve a intentar.`
        );
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
      setPendingSlots([]);
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

    // 1) prompt (incluye bloque de style si venía guardado)
    setPrompt(raw);

    // 2) receta (model/ratio/count/quality + refs)
    const meta = (asset as any).meta || {};

    // model
    const metaModel = typeof meta.model === "string" ? meta.model : null;
    if (metaModel) {
      setModel(metaModel as GeminiModel);

      // NanoBanana (flash) solo soporta 1K
      if (metaModel === GeminiModel.IMAGE) setQuality("1K");
    }

    // aspect ratio
    if (typeof meta.aspectRatio === "string") {
      setAspectRatio(meta.aspectRatio);
    }

    // count
    const metaCount =
      typeof meta.count === "number"
        ? meta.count
        : typeof meta.count === "string"
          ? parseInt(meta.count, 10)
          : null;
    if (metaCount != null && !Number.isNaN(metaCount)) {
      setCount(Math.max(1, Math.min(4, metaCount)));
    }

    // quality
    if (typeof meta.quality === "string") {
      const q = meta.quality.toUpperCase();
      if (q === "1K" || q === "2K" || q === "4K") {
        if (metaModel === GeminiModel.IMAGE) setQuality("1K");
        else setQuality(q as any);
      }
    }

    // refs (ids -> assets)
    const charIds: string[] = Array.isArray(meta.characterAssetIds)
      ? meta.characterAssetIds.filter((x: any) => typeof x === "string")
      : [];
    const bgId = typeof meta.backgroundAssetId === "string" ? meta.backgroundAssetId : null;

    const findAsset = (id: string) => myAssets.find((a) => a.id === id) || null;

    const c1 = charIds[0] ? findAsset(charIds[0]) : null;
    const c2 = charIds[1] ? findAsset(charIds[1]) : null;
    const c3 = charIds[2] ? findAsset(charIds[2]) : null;
    const bg = bgId ? findAsset(bgId) : null;

    setRefs({ char1: c1, char2: c2, char3: c3, background: bg });

    // 3) UI: si el prompt trae un bloque de style, intentamos “reconocer” el preset
    const inside = extractStyleBlock(raw) || "";
    if (inside) {
      const match = STYLE_PRESETS.find((p) => (p.prompt || "").trim() === inside.trim());
      setSelectedStyleId(match ? match.id : null);
    } else {
      setSelectedStyleId(null);
    }

    setPanel(null);
    setViewer(null);
  }

  return (
    <div
      ref={rootRef}
      className={styles.root}
      onMouseMove={handleRootMouseMove}
      onMouseLeave={handleRootMouseLeave}
    >
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
          {history.length === 0 && pendingSlots.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyCode}>NO GENERATIONS</div>
              <div className={styles.emptyText}>Genera tu primera imagen para ver el historial aquí.</div>
            </div>
          ) : (
            <div className={styles.grid}>
              {pendingSlots.map((id) => (
                <div key={id} className={`${styles.tile} ${styles.tilePending}`} aria-label="Generating...">
                  <div className={styles.pendingFrame}>
                    <div className={styles.pendingShimmer} />
                    <div className={styles.pendingSpinner} />
                    <div className={styles.pendingLabel}>GENERATING</div>
                  </div>
                </div>
              ))}

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
                    <img
                      className={styles.tileImg}
                      src={asset.url}
                      alt={asset.name}
                      loading="lazy"
                      decoding="async"
                      onLoad={(e) => rememberImgDims(asset.id, e.currentTarget)}
                    />

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
        <div className={styles.dock}>
          {(refs.char1 || refs.char2 || refs.char3 || refs.background) && (
            <div className={styles.refThumbStrip}>
              {refs.char1 && (
                <div className={styles.refMini} title="Character 1">
                  <img src={refs.char1.url} alt="char1" />
                  <span className={styles.refMiniIcon}>C1</span>
                  <button
                    type="button"
                    className={styles.refMiniRemove}
                    aria-label="Remove Character 1"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRefSlot("char1", null);
                    }}
                  >
                    ×
                  </button>
                </div>
              )}

              {refs.char2 && (
                <div className={styles.refMini} title="Character 2">
                  <img src={refs.char2.url} alt="char2" />
                  <span className={styles.refMiniIcon}>C2</span>
                  <button
                    type="button"
                    className={styles.refMiniRemove}
                    aria-label="Remove Character 2"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRefSlot("char2", null);
                    }}
                  >
                    ×
                  </button>
                </div>
              )}

              {refs.char3 && (
                <div className={styles.refMini} title="Character 3">
                  <img src={refs.char3.url} alt="char3" />
                  <span className={styles.refMiniIcon}>C3</span>
                  <button
                    type="button"
                    className={styles.refMiniRemove}
                    aria-label="Remove Character 3"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRefSlot("char3", null);
                    }}
                  >
                    ×
                  </button>
                </div>
              )}

              {refs.background && (
                <div className={styles.refMini} title="Background">
                  <img src={refs.background.url} alt="background" />
                  <span className={styles.refMiniIcon}>BG</span>
                  <button
                    type="button"
                    className={styles.refMiniRemove}
                    aria-label="Remove Background"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRefSlot("background", null);
                    }}
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          )}
          <div className={styles.promptRow}>
            <textarea
              className={styles.prompt}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Escribe tu prompt y comienza a crear..."
              rows={2}
            />

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

          <div className={styles.controlsRow}>
            <button
              type="button"
              className={`${styles.controlBtn} ${panel === "reference" ? styles.controlBtnActive : ""}`}
              onClick={() => {
                setPanel((p) => (p === "reference" ? null : "reference"));
                setPickerSlot(null);
              }}
            >
              <span>Reference</span>
              <span className={styles.controlBtnMeta}>{refLabel}</span>
            </button>

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
              className={`${styles.controlBtn} ${panel === "styles" ? styles.controlBtnActive : ""}`}
              onClick={() => setPanel((p) => (p === "styles" ? null : "styles"))}
            >
              <span>styles</span>
              <span className={styles.controlBtnMeta}>{styleLabel}</span>
            </button>
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
                    {(() => {
                      const visible: RefSlot[] = ["char1"];
                      if (refs.char1) visible.push("char2");
                      if (refs.char2) visible.push("char3");
                      visible.push("background");
                      return visible;
                    })().map((slot) => {
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
                        const next = e.target.value;
                        const nextCaps = getActiveCaps(next);

                        setModel(next);

                        // ✅ defaults (por requerimiento)
                        setAspectRatio("auto");
                        setCount(1);

                        // Quality válida para el modelo elegido
                        if (!nextCaps.qualities.includes(quality)) {
                          setQuality(nextCaps.qualities[0] || "1K");
                        }

                        // IMPORTANTÍSIMO:
                        // NanoBanana (flash) solo soporta 1K, si no, el backend lo rechaza.
                        if (next === GeminiModel.IMAGE) setQuality("1K");

                        setPanel(null); // auto-close
                      }}
                    >
                      <optgroup label="Google NanoBanana">
                        <option value={GeminiModel.IMAGE}>NanoBanana</option>
                        <option value={GeminiModel.IMAGE_PRO}>NanoBanana Pro</option>
                      </optgroup>

                      <optgroup label="Kling">
                        <option value="kling:kling-image-o1">Kling o1</option>
                      </optgroup>

                      <optgroup label="Flux 2.0">
                        <option value="fal-ai/flux-2-max">Flux 2.0 Max</option>
                        <option value="fal-ai/flux-2-pro">Flux 2.0 Pro</option>
                        <option value="fal-ai/flux-2-flex">Flux 2.0 Flex</option>
                      </optgroup>

                      <optgroup label="GPT - Image">
                        <option value="openai:gpt-image-1.5">GPT 1.5</option>
                        <option value="openai:gpt-image-1.5-high">GPT 1.5 - high</option>
                      </optgroup>
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
                        {getActiveCaps(model).aspectRatios.map((ar) => (
                          <option key={ar.value} value={ar.value}>
                            {ar.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className={styles.formRow}>
                      <label className={styles.formLabel}>Count</label>
                      <select
                        className={styles.select}
                        value={count}
                        disabled={activeCaps.countOptions.length === 1}
                        onChange={(e) => {
                          setCount(Number(e.target.value));
                          setPanel(null); // auto-close
                        }}
                      >
                        {activeCaps.countOptions.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className={styles.formRow}>
                      <label className={styles.formLabel}>Quality</label>
                      <select
                        className={styles.select}
                        value={quality}
                        onChange={(e) => {
                          setQuality(e.target.value as Quality);
                          setPanel(null); // auto-close
                        }}
                      >
                        {getActiveCaps(model).qualities.map((q) => (
                          <option key={q} value={q}>
                            {q}
                          </option>
                        ))}
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

                <div className={styles.recipeGrid}>
                  <div className={styles.recipeItem}>
                    <div className={styles.recipeLabel}>Model</div>
                    <div className={styles.recipeValue}>
                      {prettyModelLabel(viewerRecipeInfo?.modelId || null)}
                    </div>
                  </div>

                  <div className={styles.recipeItem}>
                    <div className={styles.recipeLabel}>Aspect</div>
                    <div className={styles.recipeValue}>{viewerRecipeInfo?.aspectRatio || "—"}</div>
                  </div>

                  <div className={styles.recipeItem}>
                    <div className={styles.recipeLabel}>Quality</div>
                    <div className={styles.recipeValue}>{viewerRecipeInfo?.quality || "—"}</div>
                  </div>

                  <div className={styles.recipeItem}>
                    <div className={styles.recipeLabel}>Count</div>
                    <div className={styles.recipeValue}>
                      {viewerRecipeInfo?.count != null ? String(viewerRecipeInfo.count) : "—"}
                    </div>
                  </div>

                  <div className={styles.recipeItemWide}>
                    <div className={styles.recipeLabel}>Style</div>
                    <div className={styles.recipeValue}>{viewerRecipeInfo?.styleName || "None"}</div>
                  </div>
                </div>

                <div className={styles.recipeRefs}>
                  <div className={styles.recipeLabel}>References</div>

                  <div className={styles.recipeRefStrip}>
                    {(viewerRecipeInfo?.refs?.chars?.length || 0) > 0 ? (
                      viewerRecipeInfo!.refs.chars.map((a, i) => (
                        <div key={a.id} className={styles.recipeRefThumb} title={`Character ${i + 1}`}>
                          <img src={a.url} alt={`Character ${i + 1}`} />
                          <span className={styles.recipeRefTag}>C{i + 1}</span>
                        </div>
                      ))
                    ) : (
                      <div className={styles.recipeEmpty}>No saved refs (legacy)</div>
                    )}

                    {viewerRecipeInfo?.refs?.bg ? (
                      <div className={styles.recipeRefThumb} title="Background">
                        <img src={viewerRecipeInfo.refs.bg.url} alt="Background" />
                        <span className={styles.recipeRefTag}>BG</span>
                      </div>
                    ) : null}

                    {viewerRecipeInfo?.refs?.style ? (
                      <div className={styles.recipeRefThumb} title="Style reference">
                        <img src={viewerRecipeInfo.refs.style.url} alt="Style reference" />
                        <span className={styles.recipeRefTag}>STYLE</span>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className={styles.recipeBlock}>
                  <div className={styles.recipeLabel}>Prompt</div>
                  <div className={styles.recipeValue}>
                    {removeStylePresetBlock(viewer.prompt || "") || "—"}
                  </div>
                </div>

                
              </div>
            </div>
          </div>
        </div>
      )}

      <ErrorModal error={error} onClose={() => setError(null)} /> 
    </div>
  );
};

export default ImageGeneratorTool;