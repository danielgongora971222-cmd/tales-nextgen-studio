import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./ImageGeneratorTool.module.css";
import { generateImageBatch } from "../../services/geminiService";
import { deleteAsset, listMyAssets, publishAsset, unpublishAsset, uploadUserAsset } from "../../services/assetsApi";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../services/supabaseClient";
import { Asset, GeminiModel } from "../../types";
import ErrorModal from "../../components/ErrorModal";

type StylePreset = {
  id: string;
  name: string;
  prompt: string;
  coverUrl?: string;
  exampleUrls?: [string, string, string, string];
};

type ElementItem = {
  // Guardamos como Asset (upload normal), no depende de ninguna IA.
  // id === assetId
  id: string;
  name: string;
  createdAt: string;
  url: string; // mosaico 2x2 (también lo usamos como thumbnail, recortando el cuadrante 1)
};

type ElementImageInput =
  | { kind: "asset"; assetId: string; previewUrl: string; label: string }
  | { kind: "dataUrl"; dataUrl: string; previewUrl: string; label: string };

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

function isKlingModel(model: any): boolean {
  // Soporta: string ("kling:kling-image-o1") o objeto ({ id, value, name, provider })
  const provider = (model?.provider ?? "").toString().toLowerCase();

  const id =
    typeof model === "string"
      ? model
      : (model?.id ?? model?.value ?? model?.key ?? model?.name ?? "").toString();

  const s = `${provider} ${id}`.toLowerCase();

  if (provider === "kling") return true;
  if (s.includes("kling")) return true;
  if (s.includes("omni-image")) return true;

  return false;
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
  char1: "Reference 1",
  char2: "Reference 2",
  char3: "Reference 3",
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
  // Helper: ¿modelo actual es Kling?
  const kling = isKlingModel(model);



  // Reference slots (sin STYLE aquí)
  const [refs, setRefs] = useState<Record<RefSlot, Asset | null>>({
    char1: null,
    char2: null,
    char3: null,
    background: null,
  });

  // ===============================
  // Kling-only: Element/Person Library
  // (solo se usa cuando isKlingModel(model) === true)
  // ===============================
  const [elements, setElements] = useState<ElementItem[]>([]);
  const [selectedElementAssetIds, setSelectedElementAssetIds] = useState<string[]>([]);
  const [isElementCreateOpen, setIsElementCreateOpen] = useState(false);
  const [isElementAllOpen, setIsElementAllOpen] = useState(false);
  const [elementCtaActive, setElementCtaActive] = useState(false);
  const [isElementHovering, setIsElementHovering] = useState(false);
  const elementHoverTimeoutRef = useRef<number | null>(null);
    // ===============================
  // Kling Elements: modales (Create / All)
  // ===============================
  const [elementCreateName, setElementCreateName] = useState("");
  const [elementCreateTag, setElementCreateTag] = useState("character");
  const [elementCreateSlots, setElementCreateSlots] = useState<Array<ElementImageInput | null>>([null, null, null, null]);
  const [elementCreatePickerSlot, setElementCreatePickerSlot] = useState<number | null>(null);
  const [elementCreatePickerQuery, setElementCreatePickerQuery] = useState("");
  const elementFileInputsRef = useRef<Array<HTMLInputElement | null>>([]);
  const [isCreatingElement, setIsCreatingElement] = useState(false);
  const elementPickerRef = useRef<HTMLDivElement | null>(null);
  const elementPickerAreaRef = useRef<HTMLDivElement | null>(null);

  const [elementAllQuery, setElementAllQuery] = useState("");
  const [deletingElementId, setDeletingElementId] = useState<string | null>(null);

  const elementPickerCandidates = useMemo(() => {
    const q = (elementCreatePickerQuery || "").trim().toLowerCase();
    const imgs = (myAssets || []).filter((a: any) => a?.type === "image" && a?.url);
    if (!q) return imgs;
    return imgs.filter((a: any) => {
      const n = String(a?.name || "").toLowerCase();
      const p = String(a?.prompt || "").toLowerCase();
      return n.includes(q) || p.includes(q);
    });
  }, [myAssets, elementCreatePickerQuery]);

  // Al abrir el picker de Library dentro de "Create Element":
  // hacemos scroll suave hasta el panel y reiniciamos el scroll interno arriba.
  useEffect(() => {
    if (elementCreatePickerSlot === null) return;

    requestAnimationFrame(() => {
      elementPickerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      elementPickerAreaRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    });
  }, [elementCreatePickerSlot]);

  useEffect(() => {
    // CTA suave: 60s después de cambiar de modelo (cualquiera).
    // Se apaga también al hacer click en el botón.
    setElementCtaActive(true);
    const t = setTimeout(() => setElementCtaActive(false), 60_000);
    return () => clearTimeout(t);
  }, [model]);

  useEffect(() => {
    return () => {
      if (elementHoverTimeoutRef.current) {
        window.clearTimeout(elementHoverTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    // @ts-ignore
    console.log("[KLING DEBUG] model =", model, "isKling =", isKlingModel(model));
  }, [model]);

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
      refs.char1 ? "R1" : null,
      refs.char2 ? "R2" : null,
      refs.char3 ? "R3" : null,
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

  function appendPromptTag(tag: string) {
    if (!tag) return;
    setPrompt((prev) => {
      const next = prev || "";
      const trimmed = next.replace(/\s+$/g, "");
      return trimmed.length > 0 ? `${trimmed} ${tag}` : tag;
    });
  }

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

  function handleElementHoverStart() {
    if (elementHoverTimeoutRef.current) {
      window.clearTimeout(elementHoverTimeoutRef.current);
      elementHoverTimeoutRef.current = null;
    }
    setIsElementHovering(true);
  }

  function handleElementHoverEnd() {
    if (elementHoverTimeoutRef.current) {
      window.clearTimeout(elementHoverTimeoutRef.current);
    }
    elementHoverTimeoutRef.current = window.setTimeout(() => {
      setIsElementHovering(false);
      elementHoverTimeoutRef.current = null;
    }, 700);
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
    reloadHistory();
  }, []);


  // ===============================
  // Element/Person Library (GLOBAL):
  // - No depende de Kling ni de IA.
  // - Se construye desde tus uploads guardados como assets con meta.tool = "element-library".
  // ===============================
  useEffect(() => {
    const items: ElementItem[] = (myAssets || [])
      .filter((a: any) => {
        if (a?.type && a.type !== "image") return false;
        const meta = (a as any)?.meta || {};
        return meta?.tool === "element-library" || meta?.isElement === true;
      })
      .sort((a: any, b: any) => {
        const ta = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      })
      .map((a: any) => ({
        id: a.id,
        name: a.name || "Element",
        createdAt: a.createdAt || "",
        url: a.url,
      }));

    setElements(items);

    // Limpia selección si borraste elementos
    setSelectedElementAssetIds((prev) => prev.filter((id) => items.some((x) => x.id === id)));
  }, [myAssets]);


    // ===============================
  // Kling Elements: helpers (Create / Delete)
  // ===============================
  function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
      reader.readAsDataURL(file);
    });
  }

  // ===============================
  // Element/Person: crear mosaico 2x2 (sin IA)
  // - Slot1: arriba-izquierda (y define el aspect ratio / tamaño de celda)
  // - Slot2: arriba-derecha
  // - Slot3: abajo-izquierda
  // - Slot4: abajo-derecha
  // ===============================

  function slugifyName(s: string): string {
    return (s || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s_-]/g, "")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 60);
  }

  function makeElementTag(name: string): string | null {
    const slug = slugifyName(name || "");
    if (!slug) return null;
    return `@${slug}`;
  }

  function getRefTag(slot: RefSlot): string {
    if (slot === "background") return "@background";
    if (slot === "char1") return "@reference1";
    if (slot === "char2") return "@reference2";
    return "@reference3";
  }

  async function resolveInputToUrl(input: ElementImageInput): Promise<string> {
    if (input.kind === "dataUrl") return input.dataUrl;

    // kind === "asset"
    const a = myAssets.find((x) => x.id === input.assetId);
    return a?.url || input.previewUrl;
  }

  async function loadImageViaObjectUrl(src: string): Promise<{ img: HTMLImageElement; revoke?: () => void }> {
    // Para evitar canvas tainted por CORS, convertimos http(s) -> blob -> objectURL
    const isDataUrl = src.startsWith("data:");
    const img = new Image();

    if (isDataUrl) {
      img.src = src;
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("No se pudo cargar la imagen."));
      });
      return { img };
    }

    const resp = await fetch(src);
    if (!resp.ok) throw new Error(`No se pudo descargar una imagen (${resp.status}).`);
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);

    img.src = url;
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("No se pudo cargar la imagen."));
    });

    return { img, revoke: () => URL.revokeObjectURL(url) };
  }

  function drawContain(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
    const iw = img.naturalWidth || (img as any).width || 1;
    const ih = img.naturalHeight || (img as any).height || 1;

    const scale = Math.min(w / iw, h / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const dx = x + (w - dw) / 2;
    const dy = y + (h - dh) / 2;

    ctx.drawImage(img, dx, dy, dw, dh);
  }

  async function buildMosaic2x2(inputs: (ElementImageInput | null)[]): Promise<File> {
    // Slot 1 obligatorio (define aspect ratio)
    const s1 = inputs[0];
    if (!s1) throw new Error("Slot 1 es obligatorio (define el aspecto del mosaico).");

    const url1 = await resolveInputToUrl(s1);
    const loaded1 = await loadImageViaObjectUrl(url1);

    // Tamaño base de la celda según Slot1, con límite (para no explotar memoria)
    const w1 = loaded1.img.naturalWidth || 1024;
    const h1 = loaded1.img.naturalHeight || 1024;

    const MAX_CELL = 1280; // ajustable
    const down = Math.min(1, MAX_CELL / Math.max(w1, h1));
    const cellW = Math.max(1, Math.round(w1 * down));
    const cellH = Math.max(1, Math.round(h1 * down));

    const canvas = document.createElement("canvas");
    canvas.width = cellW * 2;
    canvas.height = cellH * 2;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No se pudo crear el canvas.");

    // Fondo negro
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Dibuja slot1
    drawContain(ctx, loaded1.img, 0, 0, cellW, cellH);
    loaded1.revoke?.();

    const coords = [
      { x: 0, y: 0 },
      { x: cellW, y: 0 },
      { x: 0, y: cellH },
      { x: cellW, y: cellH },
    ];

    for (let i = 1; i < 4; i++) {
      const input = inputs[i];
      if (!input) continue;

      const url = await resolveInputToUrl(input);
      const loaded = await loadImageViaObjectUrl(url);
      drawContain(ctx, loaded.img, coords[i].x, coords[i].y, cellW, cellH);
      loaded.revoke?.();
    }

    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo exportar el mosaico."))), "image/jpeg", 0.92);
    });

    return new File([blob], `element_${Date.now()}.jpg`, { type: "image/jpeg" });
  }

  async function buildSingleElementFile(input: ElementImageInput): Promise<File> {
    if (input.kind === "dataUrl") {
      const resp = await fetch(input.dataUrl);
      const blob = await resp.blob();
      return new File([blob], `element_${Date.now()}.jpg`, { type: blob.type || "image/jpeg" });
    }

    const src = await resolveInputToUrl(input);
    const resp = await fetch(src);
    if (!resp.ok) throw new Error(`No se pudo descargar la imagen (${resp.status}).`);
    const blob = await resp.blob();
    return new File([blob], `element_${Date.now()}.jpg`, { type: blob.type || "image/jpeg" });
  }

  async function klingAuthHeadersJson(): Promise<Record<string, string>> {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return headers;
  }

  async function klingAuthHeaders(): Promise<Record<string, string>> {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return headers;
  }

  function setCreateSlot(index: number, value: ElementImageInput | null) {
    setElementCreateSlots((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  function resetCreateModal() {
    setElementCreateName("");
    setElementCreateTag("character");
    setElementCreateSlots([null, null, null, null]);
    setElementCreatePickerSlot(null);
    setElementCreatePickerQuery("");
  }

  function closeCreateModal() {
    setIsElementCreateOpen(false);
    setElementCreatePickerSlot(null);
  }

  function closeAllModal() {
    setIsElementAllOpen(false);
  }

  async function handleCreateElement() {
    const name = (elementCreateName || "").trim();

    // Slot 1 define el aspecto => obligatorio
    if (!elementCreateSlots[0]) {
      setError("Para crear un Element/Person, el Slot 1 es obligatorio (define el aspecto del mosaico).");
      return;
    }

    const imagesCount = elementCreateSlots.filter(Boolean).length;

    if (!name) {
      setError("Ponle un nombre al Element/Person (obligatorio).");
      return;
    }
    if (imagesCount < 1) {
      setError("Selecciona o sube al menos 1 imagen (máximo 4).");
      return;
    }

    setIsCreatingElement(true);
    try {
      // 1) generar archivo (mosaico 2x2 o imagen única)
      const base =
        imagesCount === 1 && elementCreateSlots[0]
          ? await buildSingleElementFile(elementCreateSlots[0])
          : await buildMosaic2x2(elementCreateSlots);

      // 2) nombre bonito para el asset
      const slug = slugifyName(name);
      const fileName = slug ? `${slug}.jpg` : `element_${Date.now()}.jpg`;
      const mosaicFile = new File([base], fileName, { type: base.type || "image/jpeg" });

      // 3) subir como asset normal (global para todos los modelos)
      const uploaded = await uploadUserAsset(mosaicFile, "element-library");

      // 4) refrescar + seleccionar
      await reloadHistory();

      setSelectedElementAssetIds((prev) => {
        if (prev.includes(uploaded.id)) return prev;
        const next = [uploaded.id, ...prev];
        return next.slice(0, 5);
      });
      const tag = makeElementTag(name);
      if (tag) appendPromptTag(tag);

      closeCreateModal();
      resetCreateModal();
    } catch (e: any) {
      setError(e?.message || "No se pudo crear el Element/Person (mosaico 2x2).");
    } finally {
      setIsCreatingElement(false);
    }
  }

  async function handleDeleteElement(id: string) {
    const ok = window.confirm("¿Borrar este Element/Person? (No se puede deshacer)");
    if (!ok) return;

    setDeletingElementId(id);
    try {
      await deleteAsset(id);

      // UI instantánea
      setMyAssets((prev) => prev.filter((a) => a.id !== id));
      setElements((prev) => prev.filter((x) => x.id !== id));
      setSelectedElementAssetIds((prev) => prev.filter((x) => x !== id));
    } catch (e: any) {
      setError(e?.message || "No se pudo borrar el Element/Person.");
    } finally {
      setDeletingElementId(null);
    }
  }

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

    const allRefIds: string[] = Array.isArray(meta.characterAssetIds)
      ? meta.characterAssetIds.filter((x: any) => typeof x === "string")
      : [];

    const charRefIds = allRefIds.slice(0, 3);
    const elementRefIds = allRefIds.slice(3);
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
        chars: charRefIds.map(findAsset).filter(Boolean) as Asset[],
        elements: elementRefIds.map(findAsset).filter(Boolean) as Asset[],
        bg: backgroundAssetId ? findAsset(backgroundAssetId) : null,
        style: styleAssetId ? findAsset(styleAssetId) : null,
        raw: { characterAssetIds: allRefIds, backgroundAssetId, styleAssetId },
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
      if (asset) {
        appendPromptTag(getRefTag(slot));
      }
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

      // Elements (GLOBAL): mosaicos seleccionados (máx 5)
      const elementAssetIds = selectedElementAssetIds.slice(0, 5);

      // Se anexan detrás de los "character slots"
      const mergedCharacterAssetIds = [...characterAssetIds, ...elementAssetIds];

      // Guardrail total referencias
      if (mergedCharacterAssetIds.length + (backgroundAssetId ? 1 : 0) > 10) {
        throw new Error("Demasiadas referencias: usa menos Elements o menos imágenes de personaje/fondo.");
      }

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
        characterAssetIds: mergedCharacterAssetIds,
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

  async function handleDownload(asset: Asset) {
    try {
      const resp = await fetch(asset.url);
      if (!resp.ok) throw new Error("No se pudo descargar la imagen.");
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = asset.name || "image";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message || "No se pudo descargar la imagen.");
    }
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

    // refs (ids -> assets) + Elements (compat)
    // meta.characterAssetIds ahora puede traer:
    // [char1, char2, char3, element1, element2, ...]
    const allIds: string[] = Array.isArray(meta.characterAssetIds)
      ? meta.characterAssetIds.filter((x: any) => typeof x === "string")
      : [];

    const charIds = allIds.slice(0, 3);
    const elementIdsFromCharArray = allIds.slice(3);

    // legacy fallback (por si tienes assets viejos que guardaban meta.klingElementIds)
    const legacyElementIds: string[] = Array.isArray(meta.klingElementIds)
      ? meta.klingElementIds.filter((x: any) => typeof x === "string")
      : [];

    const finalElementIds = elementIdsFromCharArray.length > 0 ? elementIdsFromCharArray : legacyElementIds;

    const bgId = typeof meta.backgroundAssetId === "string" ? meta.backgroundAssetId : null;

    const findAsset = (id: string) => myAssets.find((a) => a.id === id) || null;

    const c1 = charIds[0] ? findAsset(charIds[0]) : null;
    const c2 = charIds[1] ? findAsset(charIds[1]) : null;
    const c3 = charIds[2] ? findAsset(charIds[2]) : null;
    const bg = bgId ? findAsset(bgId) : null;

    setRefs({ char1: c1, char2: c2, char3: c3, background: bg });

    // restaurar Elements (global)
    setSelectedElementAssetIds(finalElementIds.slice(0, 5));

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
            <div className={styles.historyMeta}>
              {isLoadingHistory ? (
                <span className={styles.subKicker}>Loading history...</span>
              ) : (
                <>
                  <span className={styles.subKicker}>History</span>
                  <span className={styles.historyCount}>{history.length}</span>
                </>
              )}
            </div>
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
                <div className={styles.refMini} title="Reference 1">
                  <img src={refs.char1.url} alt="char1" />
                  <span className={styles.refMiniIcon}>R1</span>
                  <button
                    type="button"
                    className={styles.refMiniRemove}
                    aria-label="Remove Reference 1"
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
                <div className={styles.refMini} title="Reference 2">
                  <img src={refs.char2.url} alt="char2" />
                  <span className={styles.refMiniIcon}>R2</span>
                  <button
                    type="button"
                    className={styles.refMiniRemove}
                    aria-label="Remove Reference 2"
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
                <div className={styles.refMini} title="Reference 3">
                  <img src={refs.char3.url} alt="char3" />
                  <span className={styles.refMiniIcon}>R3</span>
                  <button
                    type="button"
                    className={styles.refMiniRemove}
                    aria-label="Remove Reference 3"
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
            <div className={styles.promptInputWrap}>
              <div className={styles.klingDock} onMouseEnter={handleElementHoverStart} onMouseLeave={handleElementHoverEnd}>
                <div className={`${styles.klingTooltip} ${isElementHovering ? styles.klingTooltipVisible : ""}`}>
                  Crear Elemento Consistente
                </div>
                {/* Botón 1x1 */}
                <button
                  type="button"
                  className={`${styles.klingElementBtn} ${elementCtaActive ? styles.klingElementBtnCta : ""}`}
                  onClick={() => {
                    setElementCtaActive(false); // apaga CTA al click
                    setIsElementCreateOpen(true);
                  }}
                  title="Element/Person"
                  aria-label="Element/Person"
                >
                  {/* ícono persona */}
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4.4 0-8 2.24-8 5v2h16v-2c0-2.76-3.6-5-8-5z"
                    />
                  </svg>

                  {/* badge con número si hay selección */}
                  {selectedElementAssetIds.length > 0 && (
                    <span className={styles.klingBadge}>{selectedElementAssetIds.length}</span>
                  )}
                </button>

                {/* Popover al hover */}
                <div className={`${styles.klingPopover} ${isElementHovering ? styles.klingPopoverVisible : ""}`}>
                  <div className={styles.klingPopoverTop}>
                    <button
                      type="button"
                      className={styles.klingAllBtn}
                      onClick={() => setIsElementAllOpen(true)}
                      title="Ver todos tus Elements"
                    >
                      All
                    </button>

                    {elements.length > 0 ? (
                      <div className={styles.klingPopoverThumbRow}>
                        {elements.slice(0, 6).map((el) => {
                          const active = selectedElementAssetIds.includes(el.id);
                          const src = el.url || "";
                          return (
                            <div key={el.id} className={styles.klingThumbWrap}>
                              <button
                                type="button"
                                className={`${styles.klingThumbBtn} ${active ? styles.klingThumbBtnActive : ""}`}
                                onClick={() => {
                                  setSelectedElementAssetIds((prev) => {
                                    const has = prev.includes(el.id);
                                    if (has) {
                                      const tag = makeElementTag(el.name);
                                      if (tag) appendPromptTag(tag);
                                      return prev;
                                    }
                                    if (prev.length >= 5) {
                                      setError("Máximo 5 Elements a la vez.");
                                      return prev;
                                    }
                                    const tag = makeElementTag(el.name);
                                    if (tag) appendPromptTag(tag);
                                    return [el.id, ...prev];
                                  });
                                }}
                                title={el.name}
                                aria-label={el.name}
                              >
                                {src ? <img src={src} alt={el.name} className={styles.klingThumbImg} /> : null}
                              </button>
                              {active && (
                                <button
                                  type="button"
                                  className={styles.klingThumbRemove}
                                  onClick={() => setSelectedElementAssetIds((prev) => prev.filter((x) => x !== el.id))}
                                  aria-label={`Deselect ${el.name}`}
                                >
                                  ×
                                </button>
                              )}
                            </div>
                          );
                        })}
                    </div>
                    ) : (
                      <div className={styles.klingEmpty}>No elements yet</div>
                    )}
                  </div>
                </div>
              </div>           

              <div className={styles.promptEditor}>
                <textarea
                  className={styles.prompt}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Escribe tu prompt y comienza a crear..."
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

                    {(viewerRecipeInfo?.refs?.elements?.length || 0) > 0
                      ? viewerRecipeInfo!.refs.elements.map((a, i) => (
                          <div key={a.id} className={styles.recipeRefThumb} title={`Element ${i + 1}`}>
                            <img src={a.url} alt={`Element ${i + 1}`} />
                            <span className={styles.recipeRefTag}>E{i + 1}</span>
                          </div>
                        ))
                      : null}

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

            {/* =============================== */}
      {/* KLING: Create Element modal */}
      {/* =============================== */}
      {isElementCreateOpen && (
        <div
          className={styles.elementBackdrop}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeCreateModal();
          }}
        >
          <div className={styles.elementModal} onMouseDown={(e) => e.stopPropagation()}>
            <div className={styles.elementHeader}>
              <div className={styles.elementTitle}>Create Element/Person</div>
              <button type="button" className={styles.iconBtn} onClick={closeCreateModal} title="Close">
                <Icon name="close" />
              </button>
            </div>

            <div className={styles.elementBody}>
              <div className={styles.elementFormRow}>
                <div className={styles.elementField}>
                  <div className={styles.elementLabel}>Name *</div>
                  <input
                    className={styles.search}
                    value={elementCreateName}
                    onChange={(e) => setElementCreateName(e.target.value)}
                    placeholder='Ej: "Wow Poppy"'
                  />
                </div>

                <div className={styles.elementField}>
                  <div className={styles.elementLabel}>Tag (optional)</div>
                  <select className={styles.select} value={elementCreateTag} onChange={(e) => setElementCreateTag(e.target.value)}>
                    <option value="character">character</option>
                    <option value="object">object</option>
                    <option value="product">product</option>
                    <option value="style">style</option>
                    <option value="other">other</option>
                  </select>
                </div>
              </div>

              <div className={styles.elementLabel}>Images (1–4)</div>

              <div className={styles.elementSlots}>
                {elementCreateSlots.map((slot, idx) => (
                  <div key={idx} className={styles.elementSlotCard}>
                    <div className={styles.elementSlotThumb} data-empty={slot ? "false" : "true"}>
                      {slot ? (
                        <img src={slot.previewUrl} alt={slot.label} />
                      ) : (
                        <div className={styles.elementSlotEmpty}>Slot {idx + 1}</div>
                      )}
                    </div>

                    <div className={styles.elementSlotActions}>
                      <button
                        type="button"
                        className={styles.smallBtn}
                        onClick={() => setElementCreatePickerSlot(idx)}
                        title="Elegir desde tu librería"
                      >
                        Library
                      </button>

                      <button
                        type="button"
                        className={styles.smallBtn}
                        onClick={() => elementFileInputsRef.current[idx]?.click()}
                        title="Subir desde tu PC"
                      >
                        Upload
                      </button>

                      {slot && (
                        <button type="button" className={styles.smallBtnGhost} onClick={() => setCreateSlot(idx, null)}>
                          Clear
                        </button>
                      )}
                    </div>

                    <input
                      ref={(el) => {
                        elementFileInputsRef.current[idx] = el;
                      }}
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={async (e) => {
                        const f = e.currentTarget.files?.[0];
                        if (!f) return;
                        try {
                          const dataUrl = await readFileAsDataUrl(f);
                          setCreateSlot(idx, { kind: "dataUrl", dataUrl, previewUrl: dataUrl, label: f.name });
                        } catch (err: any) {
                          setError(err?.message || "No se pudo leer la imagen.");
                        } finally {
                          e.currentTarget.value = "";
                        }
                      }}
                    />
                  </div>
                ))}
              </div>

              {elementCreatePickerSlot !== null && (
                <div ref={elementPickerRef} className={styles.elementPicker}>
                  <div className={styles.elementPickerTop}>
                    <div className={styles.elementPickerTitle}>Pick from your library</div>
                    <button type="button" className={styles.smallBtnGhost} onClick={() => setElementCreatePickerSlot(null)}>
                      Close
                    </button>
                  </div>

                  <input
                    className={styles.search}
                    value={elementCreatePickerQuery}
                    onChange={(e) => setElementCreatePickerQuery(e.target.value)}
                    placeholder="Search images..."
                  />

                  <div ref={elementPickerAreaRef} className={styles.pickerArea}>
                    <div className={styles.pickerGrid}>
                      {elementPickerCandidates.slice(0, 60).map((a: any) => (
                        <button
                          key={a.id}
                          type="button"
                          className={styles.pickerTile}
                          onClick={() => {
                            const i = elementCreatePickerSlot;
                            if (i == null) return;
                            setCreateSlot(i, { kind: "asset", assetId: a.id, previewUrl: a.url, label: a.name || a.id });
                            setElementCreatePickerSlot(null);
                          }}
                        >
                          <img src={a.url} alt={a.name || "asset"} />
                          <div className={styles.pickerTileCap}>{a.name || "Untitled"}</div>
                        </button>
                      ))}

                      {elementPickerCandidates.length === 0 && (
                        <div className={styles.elementPickerEmpty}>No images found</div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className={styles.elementFooter}>
                <button type="button" className={styles.smallBtnGhost} onClick={closeCreateModal} disabled={isCreatingElement}>
                  Cancel
                </button>

                <button type="button" className={styles.elementPrimaryBtn} onClick={handleCreateElement} disabled={isCreatingElement}>
                  {isCreatingElement ? "Creating..." : "Create"}
                </button>
              </div>

              <div className={styles.elementHint}>
                Tip: puedes mezclar <b>Library</b> y <b>Upload</b>. Kling acepta 1–4 imágenes.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =============================== */}
      {/* KLING: All Elements modal */}
      {/* =============================== */}
      {isElementAllOpen && (
        <div
          className={styles.elementBackdrop}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeAllModal();
          }}
        >
          <div className={styles.elementModal} onMouseDown={(e) => e.stopPropagation()}>
            <div className={styles.elementHeader}>
              <div className={styles.elementTitle}>All Elements</div>
              <button type="button" className={styles.iconBtn} onClick={closeAllModal} title="Close">
                <Icon name="close" />
              </button>
            </div>

            <div className={styles.elementBody}>
              <div className={styles.elementAllTop}>
                <div className={styles.elementAllMeta}>
                  Selected: <b>{selectedElementAssetIds.length}</b>/5
                </div>

                <input
                  className={styles.search}
                  value={elementAllQuery}
                  onChange={(e) => setElementAllQuery(e.target.value)}
                  placeholder="Search elements..."
                />
              </div>

              <div className={styles.elementAllGrid}>
                {elements
                  .filter((el) => {
                    const q = (elementAllQuery || "").trim().toLowerCase();
                    if (!q) return true;
                    return String(el?.name || "").toLowerCase().includes(q);
                  })
                  .map((el) => {
                    const active = selectedElementAssetIds.includes(el.id);
                    const src = el.url || "";
                    return (
                      <div key={el.id} className={`${styles.elementAllCard} ${active ? styles.elementAllCardActive : ""}`}>
                        <button
                          type="button"
                          className={styles.elementAllThumb}
                          onClick={() => {
                            setSelectedElementAssetIds((prev) => {
                              const has = prev.includes(el.id);
                              if (has) {
                                const tag = makeElementTag(el.name);
                                if (tag) appendPromptTag(tag);
                                return prev;
                              }
                              if (prev.length >= 5) {
                                setError("Kling permite seleccionar máximo 5 Elements a la vez.");
                                return prev;
                              }
                              const tag = makeElementTag(el.name);
                              if (tag) appendPromptTag(tag);
                              return [el.id, ...prev];
                            });
                          }}
                          title={el.name}
                        >
                          {src ? <img src={src} alt={el.name} /> : null}
                          <span className={styles.elementAllBadge}>{active ? "SELECTED" : "SELECT"}</span>
                        </button>
                        {active && (
                          <button
                            type="button"
                            className={styles.elementAllDeselect}
                            onClick={() => setSelectedElementAssetIds((prev) => prev.filter((x) => x !== el.id))}
                            aria-label={`Deselect ${el.name}`}
                          >
                            ×
                          </button>
                        )}

                        <div className={styles.elementAllName}>{el.name}</div>

                        <div className={styles.elementAllActions}>
                          <button
                            type="button"
                            className={styles.smallBtn}
                            onClick={() => {
                              setSelectedElementAssetIds((prev) => {
                                const has = prev.includes(el.id);
                                if (has) {
                                  const tag = makeElementTag(el.name);
                                  if (tag) appendPromptTag(tag);
                                  return prev;
                                }
                                if (prev.length >= 5) {
                                  setError("Kling permite seleccionar máximo 5 Elements a la vez.");
                                  return prev;
                                }
                                const tag = makeElementTag(el.name);
                                if (tag) appendPromptTag(tag);
                                return [el.id, ...prev];
                              });
                            }}
                          >
                            {active ? "Insert tag" : "Select"}
                          </button>

                          <button
                            type="button"
                            className={styles.smallBtnGhost}
                            onClick={() => handleDeleteElement(el.id)}
                            disabled={deletingElementId === el.id}
                            title="Borrar este Element"
                          >
                            {deletingElementId === el.id ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>

              {elements.length === 0 && <div className={styles.elementPickerEmpty}>No elements yet</div>}

              <div className={styles.elementFooter}>
                <button type="button" className={styles.elementPrimaryBtn} onClick={closeAllModal}>
                  Done
                </button>
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
