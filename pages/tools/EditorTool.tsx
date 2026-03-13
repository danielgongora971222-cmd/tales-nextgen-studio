import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./ImageGeneratorTool.module.css";
import { generateImageBatch, type PromptReference, type ImageGenQuality } from "../../services/geminiService";
import { MentionTextarea, type MentionItem } from "../../components/MentionTextarea";
import {
  deleteAsset,
  listMyAssets,
  listPurchasedAssets,
  uploadUserAsset,
  downloadAssetToDisk,
} from "../../services/assetsApi";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../services/supabaseClient";
import { AppRoute, Asset, GeminiModel } from "../../types";
import ErrorModal from "../../components/ErrorModal";
import { STYLE_PRESETS } from "../../config/presets/restyle";
import {
  findPresetById as findStylePresetById,
  findPresetByPrompt as findStylePresetByPrompt,
  getPresetNameFromMetaOrPrompt as getStylePresetNameFromMetaOrPrompt,
  resolvePresetFromMetaOrPrompt as resolveStylePresetFromMetaOrPrompt,
  fetchPresetReferenceGridDataUrl,
} from "../../config/presets/styleRuntime";
import OneNationUpIcon from "@/components/brand/OneNationUpIcon";
import { estimateImageCostCredits } from "../../config/pricing.js";
import {
  DEFAULT_GRID_MODE,
  DEFAULT_IMAGE_GENERATOR_MODEL,
  GOOGLE_IMAGE_MODELS,
  GRID_OPTIONS,
  supportsGoogleSearchGrounding,
} from "../../config/imageGenerationShared.js";
import { usePendingImageToolJobs } from "../../hooks/usePendingImageToolJobs";


type Quality = "" | ImageGenQuality;
type PanelKey = "reference" | "model" | "params";

type ElementItem = {
  id: string;
  name: string;
  createdAt: string | number;
  url: string;
  previewUrl?: string | null;
};

type ElementImageInput =
  | { kind: "dataUrl"; dataUrl: string; previewUrl: string; label: string }
  | { kind: "asset"; assetId: string; previewUrl: string; label: string };


const TOOL_ID = "editor-pro";
const REF_TOOL_ID = "editor-pro-ref";
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
const STYLE_PRESET_BLOCK_START = "[[STYLE_PRESET_START]]";
const STYLE_PRESET_BLOCK_END = "[[STYLE_PRESET_END]]";
const LEGACY_STYLE_PRESET_BLOCK_START = "/* STYLE_PRESET_START */";
const LEGACY_STYLE_PRESET_BLOCK_END = "/* STYLE_PRESET_END */";

// Lightroom usa estos marcadores. Aquí los soportamos SOLO para limpiar el prompt en UI.
const LIGHTING_PRESET_BLOCK_START = "[[LIGHTING_PRESET_START]]";
const LIGHTING_PRESET_BLOCK_END = "[[LIGHTING_PRESET_END]]";

const STYLE_BLOCK_START = STYLE_PRESET_BLOCK_START;
const STYLE_BLOCK_END = STYLE_PRESET_BLOCK_END;

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Para UI: limpia cualquier bloque oculto (STYLE + LIGHTING) para mostrar un prompt “limpio”.
function removeStylePresetBlock(input: string) {
  let out = input;
  const pairs = [
    { start: STYLE_PRESET_BLOCK_START, end: STYLE_PRESET_BLOCK_END },
    { start: LEGACY_STYLE_PRESET_BLOCK_START, end: LEGACY_STYLE_PRESET_BLOCK_END },
    { start: LIGHTING_PRESET_BLOCK_START, end: LIGHTING_PRESET_BLOCK_END },
  ];

  for (const { start, end } of pairs) {
    const re = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n*`, "g");
    out = out.replace(re, "");
  }
  return out.trim();
}

// Para generación: SOLO reemplaza el bloque STYLE (si existía) y deja intacto cualquier bloque LIGHTING.
function removeStyleBlocksOnly(input: string) {
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
  const base = removeStyleBlocksOnly(input).trim();
  const block = `${STYLE_PRESET_BLOCK_START}\n${presetPrompt}\n${STYLE_PRESET_BLOCK_END}\n\n`;
  return `${block}${base}`.trim();
}

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

    // ✅ requeridos por types.ts
    likedByMe: false,
    likesCount: 0,
    commentsCount: 0,

    likes: [],
    comments: [],
  };
}

// Kling tiene un límite duro en el tamaño del prompt.
// Si además usas presets largos (como Live Action), puede romper el límite.
// Por eso forzamos un máximo y usamos una versión “corta” de los estilos.
const KLING_PROMPT_MAX = 2500;
// Kling 3.0 (Fal.ai)
// - O3 (Omni) = image-to-image (requiere >= 1 referencia)
// - V3 = text-to-image (sin referencias)
const KLING_MODEL_O3_OMNI = "fal-ai/kling-image/o3/image-to-image";
const KLING_MODEL_V3_TEXT = "fal-ai/kling-image/v3/text-to-image";

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

type NanoModel =
  | typeof GOOGLE_IMAGE_MODELS.NANO_BANANA
  | typeof GOOGLE_IMAGE_MODELS.NANO_BANANA_2
  | typeof GOOGLE_IMAGE_MODELS.NANO_BANANA_PRO;

const NANO_MODELS: { id: NanoModel; label: string }[] = [
  { id: GOOGLE_IMAGE_MODELS.NANO_BANANA, label: "Nano Banana" },
  { id: GOOGLE_IMAGE_MODELS.NANO_BANANA_2, label: "Nano Banana 2" },
  { id: GOOGLE_IMAGE_MODELS.NANO_BANANA_PRO, label: "Nano Banana Pro" },
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
  [GOOGLE_IMAGE_MODELS.NANO_BANANA]: {
    id: GOOGLE_IMAGE_MODELS.NANO_BANANA,
    label: "Nano Banana",
    supportsRefs: true,
    aspectRatios: [
      { value: "auto", label: "Auto" },
      { value: "1:1", label: "1:1" },
      { value: "1:4", label: "1:4" },
      { value: "1:8", label: "1:8" },
      { value: "2:3", label: "2:3" },
      { value: "3:2", label: "3:2" },
      { value: "4:5", label: "4:5" },
      { value: "5:4", label: "5:4" },
      { value: "3:4", label: "3:4" },
      { value: "4:3", label: "4:3" },
      { value: "16:9", label: "16:9" },
      { value: "9:16", label: "9:16" },
      { value: "21:9", label: "21:9" },
      { value: "4:1", label: "4:1" },
      { value: "8:1", label: "8:1" },
    ],
    qualities: ["1K"],
    countOptions: [1, 2, 3, 4],
  },

  [GOOGLE_IMAGE_MODELS.NANO_BANANA_2]: {
    id: GOOGLE_IMAGE_MODELS.NANO_BANANA_2,
    label: "Nano Banana 2",
    supportsRefs: true,
    aspectRatios: [
      { value: "auto", label: "Auto" },
      { value: "1:1", label: "1:1" },
      { value: "1:4", label: "1:4" },
      { value: "1:8", label: "1:8" },
      { value: "2:3", label: "2:3" },
      { value: "3:2", label: "3:2" },
      { value: "4:5", label: "4:5" },
      { value: "5:4", label: "5:4" },
      { value: "3:4", label: "3:4" },
      { value: "4:3", label: "4:3" },
      { value: "16:9", label: "16:9" },
      { value: "9:16", label: "9:16" },
      { value: "21:9", label: "21:9" },
      { value: "4:1", label: "4:1" },
      { value: "8:1", label: "8:1" },
    ],
    qualities: ["1K", "2K", "4K"],
    countOptions: [1, 2, 3, 4],
  },

  [GOOGLE_IMAGE_MODELS.NANO_BANANA_PRO]: {
    id: GOOGLE_IMAGE_MODELS.NANO_BANANA_PRO,
    label: "Nano Banana Pro",
    supportsRefs: true,
    aspectRatios: [
      { value: "auto", label: "Auto" },
      { value: "1:1", label: "1:1" },
      { value: "2:3", label: "2:3" },
      { value: "3:2", label: "3:2" },
      { value: "4:5", label: "4:5" },
      { value: "5:4", label: "5:4" },
      { value: "3:4", label: "3:4" },
      { value: "4:3", label: "4:3" },
      { value: "16:9", label: "16:9" },
      { value: "9:16", label: "9:16" },
      { value: "21:9", label: "21:9" },
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

    // ✅ Kling 3.0 (Fal.ai)
    // Text-to-image (sin referencias)
    "fal-ai/kling-image/v3/text-to-image": {
      id: "fal-ai/kling-image/v3/text-to-image",
      label: "Kling 3.0 (V3)",
      supportsRefs: false,
      aspectRatios: [
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" },
        { value: "1:1", label: "1:1" },
        { value: "4:3", label: "4:3" },
        { value: "3:4", label: "3:4" },
        { value: "3:2", label: "3:2" },
        { value: "2:3", label: "2:3" },
        { value: "21:9", label: "21:9" },
      ],
      qualities: ["1K", "2K"],
      countOptions: [1, 2, 3, 4],
    },

    // Omni image-to-image (con referencias)
    "fal-ai/kling-image/o3/image-to-image": {
      id: "fal-ai/kling-image/o3/image-to-image",
      label: "Kling 3.0 (Omni O3)",
      supportsRefs: true,
      aspectRatios: [
        { value: "auto", label: "Auto" },
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" },
        { value: "1:1", label: "1:1" },
        { value: "4:3", label: "4:3" },
        { value: "3:4", label: "3:4" },
        { value: "3:2", label: "3:2" },
        { value: "2:3", label: "2:3" },
        { value: "21:9", label: "21:9" },
      ],
      qualities: ["1K", "2K", "4K"],
      countOptions: [1, 2, 3, 4],
    },
  };

  

function getActiveCaps(modelId: string) {
  return MODEL_CAPS[modelId] || MODEL_CAPS[DEFAULT_IMAGE_GENERATOR_MODEL];
}

type Panel = null | "reference" | "model" | "parameters" | "styles";
type RefSlot =
  | "char1" | "char2" | "char3" | "char4" | "char5" | "char6"
  | "char7" | "char8" | "char9" | "char10" | "char11" | "char12";

const SLOT_LABEL: Record<RefSlot, string> = {
  char1: "Reference 1",
  char2: "Reference 2",
  char3: "Reference 3",
  char4: "Reference 4",
  char5: "Reference 5",
  char6: "Reference 6",
  char7: "Reference 7",
  char8: "Reference 8",
  char9: "Reference 9",
  char10: "Reference 10",
  char11: "Reference 11",
  char12: "Reference 12",
};

const REF_SLOTS: RefSlot[] = [
  "char1",
  "char2",
  "char3",
  "char4",
  "char5",
  "char6",
  "char7",
  "char8",
  "char9",
  "char10",
  "char11",
  "char12",
];

function slotIndex(slot: RefSlot): number {
  const n = Number(String(slot).replace("char", ""));
  return Number.isFinite(n) ? n : 1;
}

function imgToken(slot: RefSlot): string {
  return `@img${slotIndex(slot)}`;
}

function legacyRefToken(slot: RefSlot): string {
  return `@reference${slotIndex(slot)}`;
}

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
  meta?: any;
}) {
  return getStylePresetNameFromMetaOrPrompt(STYLE_PRESETS, {
    prompt: opts.prompt,
    meta: opts.meta,
    selectedStyleId: opts.selectedStyleId,
  });
}

function getStyleNameFromPrompt(prompt: string, meta?: any): string {
  return getStylePresetNameFromMetaOrPrompt(STYLE_PRESETS, {
    prompt,
    meta,
  });
}

function maxVisualRefsForModel(modelId: string): number | null {
  if (modelId.startsWith("openai:")) return 4;
  if (modelId.startsWith("fal-ai/flux-2-")) return 1;
  if (modelId.startsWith("kling:")) return 4;
  if (modelId.startsWith("fal-ai/kling-image/")) return 10;
  if (modelId === "fal-ai/qwen-image-edit-2511-multiple-angles") return 1;
  return null;
}

function prettyModelLabel(modelId: string | null): string {
  if (!modelId) return "Unknown";
  const caps = (MODEL_CAPS as Record<string, ModelCaps | undefined>)[modelId];
  if (caps?.label) return caps.label;
  return nanoModelLabel(modelId);
}

function extractStoredRefsFromMeta(
  meta: any,
  charSlots: number
): {
  charIds: string[];
  elementIds: string[];
  backgroundId: string | null;
} {
  type StoredPromptRef = Pick<PromptReference, "assetId" | "role">;

  const promptRefs: StoredPromptRef[] = Array.isArray(meta?.promptReferences)
    ? meta.promptReferences.filter(
        (r: any): r is StoredPromptRef =>
          !!r &&
          typeof r.assetId === "string" &&
          (r.role === "character" || r.role === "background" || r.role === "element")
      )
    : [];

  const charIdsFromPromptRefs: string[] = Array.from(
    new Set<string>(
      promptRefs
        .filter((r) => r.role === "character")
        .map((r) => r.assetId)
    )
  );

  const elementIdsFromPromptRefs: string[] = Array.from(
    new Set<string>(
      promptRefs
        .filter((r) => r.role === "element")
        .map((r) => r.assetId)
    )
  );

  const backgroundIdsFromPromptRefs: string[] = Array.from(
    new Set<string>(
      promptRefs
        .filter((r) => r.role === "background")
        .map((r) => r.assetId)
    )
  );

  const legacyAllIds: string[] = Array.isArray(meta?.characterAssetIds)
    ? meta.characterAssetIds.filter((x: any): x is string => typeof x === "string")
    : [];

  const legacyCharIds: string[] = legacyAllIds.slice(0, charSlots);
  const legacyElementIds: string[] = legacyAllIds.slice(charSlots);

  const klingElementIds: string[] = Array.isArray(meta?.klingElementIds)
    ? meta.klingElementIds.filter((x: any): x is string => typeof x === "string")
    : [];

  return {
    charIds: (charIdsFromPromptRefs.length ? charIdsFromPromptRefs : legacyCharIds).slice(0, charSlots),
    elementIds: (
      elementIdsFromPromptRefs.length
        ? elementIdsFromPromptRefs
        : klingElementIds.length
          ? klingElementIds
          : legacyElementIds
    ).slice(0, 5),
    backgroundId:
      typeof meta?.backgroundAssetId === "string"
        ? meta.backgroundAssetId
        : backgroundIdsFromPromptRefs[0] || null,
  };
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

  // Historial: mostramos 12 al inicio y cargamos de a 9 con botón "Cargar más"
  const HISTORY_INITIAL_COUNT = 12;
  const HISTORY_LOAD_MORE_COUNT = 9;

  const [history, setHistory] = useState<Asset[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyVisibleCount, setHistoryVisibleCount] = useState(HISTORY_INITIAL_COUNT);
  const [visibleHistory, setVisibleHistory] = useState<Asset[]>([]);
  const [isLoadingMoreHistory, setIsLoadingMoreHistory] = useState(false);

  // "library": todas tus imágenes (generadas + subidas) para el picker y recipe
  const [myAssets, setMyAssets] = useState<Asset[]>([]);
  const [purchasedAssets, setPurchasedAssets] = useState<Asset[]>([]);
  const [refLibraryTab, setRefLibraryTab] = useState<"history" | "purchased">("history");
  const [elementLibraryTab, setElementLibraryTab] = useState<"mine" | "purchased">("mine");

  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<string>(DEFAULT_IMAGE_GENERATOR_MODEL);
  const [aspectRatio, setAspectRatio] = useState("auto");
  const [count, setCount] = useState(1);
  const [quality, setQuality] = useState<Quality>("1K");
  const [gridMode, setGridMode] = useState<string>(DEFAULT_GRID_MODE);
  const [googleSearchGrounding, setGoogleSearchGrounding] = useState(false);
  // Helper: ¿modelo actual es Kling?
  const kling = isKlingModel(model);



// Reference slots (sin STYLE aquí) - hasta 12
const [refs, setRefs] = useState<Record<RefSlot, Asset | null>>({
  char1: null,
  char2: null,
  char3: null,
  char4: null,
  char5: null,
  char6: null,
  char7: null,
  char8: null,
  char9: null,
  char10: null,
  char11: null,
  char12: null,
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

// ✅ Kling o1 (API) NO permite aspect_ratio="auto" cuando NO hay imágenes de referencia.
// (Cuando hay imágenes, "auto" sí puede funcionar porque el modelo detecta el ratio desde la imagen.)
const isKlingO1 = model === "kling:kling-image-o1";
const hasAnyReferenceImage =
  Object.values(refs).some(Boolean) || (selectedElementAssetIds?.length || 0) > 0;

// Si el usuario está en Kling o1 y quita todas las referencias, evitamos que se quede en "auto".
useEffect(() => {
  if (isKlingO1 && !hasAnyReferenceImage && aspectRatio === "auto") {
    setAspectRatio("1:1");
  }
}, [isKlingO1, hasAnyReferenceImage, aspectRatio]);


  const elementPickerCandidates = useMemo(() => {
    const q = (elementCreatePickerQuery || "").trim().toLowerCase();
    const source = elementLibraryTab === "purchased" ? purchasedAssets : myAssets;
    const imgs = (source || []).filter((a: any) => a?.type === "image" && a?.url);

    if (!q) return imgs;

    return imgs.filter((a: any) => {
      const n = String(a?.name || "").toLowerCase();
      const p = String(a?.prompt || "").toLowerCase();
      return n.includes(q) || p.includes(q);
    });
  }, [elementLibraryTab, myAssets, purchasedAssets, elementCreatePickerQuery]);

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

  const selectedStylePreset = useMemo(() => {
    return findStylePresetById(STYLE_PRESETS, selectedStyleId);
  }, [selectedStyleId]);

  const selectedStylePrompt = useMemo(() => {
    return selectedStylePreset?.prompt?.trim() || "";
  }, [selectedStylePreset]);

  const activeCaps = useMemo(() => getActiveCaps(model), [model]);
  const modelLabel = activeCaps.label;
  const paramsLabel = `${aspectRatio} • ${quality} • x${count} • Grid ${gridMode}${googleSearchGrounding ? " • Web" : ""}`;
  const estimatedCostCredits = useMemo(() => {
    const refCount =
      (refs?.char1 ? 1 : 0) +
      (refs?.char2 ? 1 : 0) +
      (refs?.char3 ? 1 : 0) +
      (Array.isArray(selectedElementAssetIds) ? selectedElementAssetIds.length : 0);

    const effectiveModel = model === KLING_MODEL_O3_OMNI && refCount === 0 ? KLING_MODEL_V3_TEXT : model;
    const caps = getActiveCaps(effectiveModel);

    const effQuality =
      quality && caps.qualities.includes(quality as any)
        ? String(quality)
        : String(caps.qualities[caps.qualities.length - 1] || caps.qualities[0] || "1K");

    const effCount = caps.countOptions.includes(count) ? count : (caps.countOptions[0] || 1);

    return estimateImageCostCredits({ model: effectiveModel, quality: effQuality, count: effCount, aspectRatio });
  }, [model, quality, count, aspectRatio, refs, selectedElementAssetIds]);
  const styleLabel = selectedStylePreset?.name || "None";

  // Options reales para el selector de Aspect Ratio.
  // Para Kling o1: escondemos "Auto" si no hay referencias (text-to-image puro)
  // porque el backend (Kling) lo rechaza.
  const aspectRatioOptions = useMemo(() => {
    const list = activeCaps.aspectRatios || [];
    if (isKlingO1 && !hasAnyReferenceImage) return list.filter((ar) => ar.value !== "auto");
    return list;
  }, [activeCaps, isKlingO1, hasAnyReferenceImage]);

  const modelGroups = [
    {
      label: "Google NanoBanana",
      options: [
        { value: GOOGLE_IMAGE_MODELS.NANO_BANANA_2, label: "Nano Banana 2" },
        { value: GOOGLE_IMAGE_MODELS.NANO_BANANA_PRO, label: "Nano Banana Pro" },
        { value: GOOGLE_IMAGE_MODELS.NANO_BANANA, label: "Nano Banana" },
      ],
    },
    {
      label: "Kling",
      options: [
        { value: "kling:kling-image-o1", label: "Kling o1 (API)" },
        // Nota: Kling 3.0 (V3) se usa automáticamente cuando eliges Omni O3 pero NO agregas referencias.
        { value: KLING_MODEL_O3_OMNI, label: "Kling 3.0 (Omni O3)" },
      ],
    },
    {
      label: "Flux 2.0",
      options: [
        { value: "fal-ai/flux-2-max", label: "Flux 2.0 Max" },
        { value: "fal-ai/flux-2-pro", label: "Flux 2.0 Pro" },
        { value: "fal-ai/flux-2-flex", label: "Flux 2.0 Flex" },
      ],
    },
    {
      label: "GPT - Image",
      options: [
        { value: "openai:gpt-image-1.5", label: "GPT 1.5" },
        { value: "openai:gpt-image-1.5-high", label: "GPT 1.5 - high" },
      ],
    },
  ];

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
      if (model === GOOGLE_IMAGE_MODELS.NANO_BANANA && quality !== "1K") {
        setQuality("1K");
      }

      if (!supportsGoogleSearchGrounding(model) && googleSearchGrounding) {
        setGoogleSearchGrounding(false);
      }
    }, [activeCaps, aspectRatio, quality, count, model]);

  function handleModelSelect(next: string) {
    const nextCaps = getActiveCaps(next);

    setModel(next);

    // ✅ defaults (por requerimiento)
    setAspectRatio(next === "kling:kling-image-o1" ? "1:1" : "auto");
    setCount(1);

    // Quality válida para el modelo elegido
    if (!nextCaps.qualities.includes(quality)) {
      setQuality(nextCaps.qualities[0] || "1K");
    }

    // IMPORTANTÍSIMO:
    // NanoBanana (flash) solo soporta 1K, si no, el backend lo rechaza.
    if (next === GOOGLE_IMAGE_MODELS.NANO_BANANA) setQuality("1K");
    if (!supportsGoogleSearchGrounding(next)) setGoogleSearchGrounding(false);

    restoreCookFromPanel(); // auto-close
  }

  const refLabel =
    [
      refs.char1 ? "R1" : null,
      refs.char2 ? "R2" : null,
      refs.char3 ? "R3" : null,
    ].filter(Boolean).join(" ") || "None";

  // UI states
  const [panel, setPanel] = useState<Panel>(null);
  const [pickerSlot, setPickerSlot] = useState<RefSlot | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");

  const [viewer, setViewer] = useState<Asset | null>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [pendingSlots, setPendingSlots] = useState<string[]>([]);
    const {
    pendingSlots: persistedPendingSlots,
    startLocalPending,
    clearLocalPending,
    makeAsyncHooks,
    resumePendingJobs,
  } = usePendingImageToolJobs({
    userId: user?.id || null,
    tool: TOOL_ID,
    onCompleted: reloadHistory,
    onError: (error: any) => setError(error?.message || "No se pudo reanudar una generación pendiente."),
  });
  const [error, setError] = useState<string | null>(null);
  const [isCookOpen, setIsCookOpen] = useState(false);
  const isCookSidebarVisible = isCookOpen && !panel;
  const isCookLayerVisible = isCookOpen || !!panel;

  const goHome = useCallback(() => {
    window.dispatchEvent(new CustomEvent("tales:navigate", { detail: { route: AppRoute.HOME } }));
  }, []);
  const refFileInputsRef = useRef<Record<RefSlot, HTMLInputElement | null>>(
    Object.fromEntries(REF_SLOTS.map((slot) => [slot, null])) as Record<RefSlot, HTMLInputElement | null>
  );

  const closeCook = useCallback(() => {
    setIsCookOpen(false);
    setPanel(null);
    setPickerSlot(null);
    setPickerQuery("");
  }, []);

  const restoreCookFromPanel = useCallback(() => {
    setPanel(null);
    setPickerSlot(null);
    setPickerQuery("");
    setIsCookOpen(true);
  }, []);

  const openCook = useCallback(() => {
    setPanel(null);
    setPickerSlot(null);
    setPickerQuery("");
    setIsCookOpen(true);
  }, []);

  const toggleCookPanel = useCallback((next: Panel) => {
    if (!next) {
      restoreCookFromPanel();
      return;
    }
    setPickerSlot(null);
    setPickerQuery("");
    setIsCookOpen(false);
    setPanel((prev) => (prev === next ? null : next));
  }, [restoreCookFromPanel]);

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

  function removePromptToken(token: string) {
    if (!token) return;
    setPrompt((prev) => {
      const text = prev || "";
      const re = new RegExp(`(^|\\s)${escapeRegExp(token)}(?=\\s|$)`, "g");
      const next = text
        .replace(re, " ")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      return next;
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
      const [ownedRes, purchasedRes] = await Promise.allSettled([
        listMyAssets({ type: "image", limit: 300 }),
        listPurchasedAssets({ type: "image", limit: 300, fresh: true }),
      ]);

      if (ownedRes.status !== "fulfilled") {
        throw ownedRes.reason;
      }

      const assets = ownedRes.value;

      const sorted = [...assets].sort((a: any, b: any) => {
        const ta = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      });

      // 1) librería propia (para picker + recipe)
      setMyAssets(sorted);

      if (purchasedRes.status === "fulfilled") {
        const purchasedSorted = [...purchasedRes.value].sort((a: any, b: any) => {
          const ta = Number((a as any)?.acquiredAt || a?.createdAt || 0);
          const tb = Number((b as any)?.acquiredAt || b?.createdAt || 0);
          return tb - ta;
        });
        setPurchasedAssets(purchasedSorted);
      } else {
        console.warn("[purchased-assets] load failed:", purchasedRes.reason);
        setPurchasedAssets([]);
      }

      // 2) historial: SOLO generaciones de esta herramienta
      const onlyGenerated = sorted.filter(isGeneratedHistoryItem);
      setHistory(onlyGenerated);
      setHistoryVisibleCount(HISTORY_INITIAL_COUNT);
      setVisibleHistory(onlyGenerated.slice(0, HISTORY_INITIAL_COUNT));
    } catch (e: any) {
      setError(e?.message || "No se pudo cargar el historial.");
    } finally {
      setIsLoadingHistory(false);
    }
  }

  useEffect(() => {
    reloadHistory();
  }, []);

  useEffect(() => {
    void resumePendingJobs();
  }, [resumePendingJobs]);

  useEffect(() => {
    setPendingSlots(persistedPendingSlots);
    setIsGenerating(persistedPendingSlots.length > 0);
  }, [persistedPendingSlots]);

  const hasMoreHistory = visibleHistory.length < history.length;

  function handleLoadMoreHistory() {
  if (!hasMoreHistory) return;
  if (isLoadingMoreHistory) return;

  setIsLoadingMoreHistory(true);
  // Delay corto solo para feedback visual
  window.setTimeout(() => {
    setHistoryVisibleCount((prev) => {
      const next = Math.min(history.length, prev + HISTORY_LOAD_MORE_COUNT);
      setVisibleHistory(history.slice(0, next));
      return next;
    });
    setIsLoadingMoreHistory(false);
  }, 200);
}

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
        return a?.tool === "element-library" || meta?.tool === "element-library" || meta?.isElement === true;
      })
      .sort((a: any, b: any) => {
        const ta = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      })
      .map((a: any) => {
        const meta = (a as any)?.meta || {};
        return {
          id: a.id,
          name: a.name || "Element",
          createdAt: a.createdAt || "",
          url: a.url,
          previewUrl:
            typeof meta?.elementPreviewDataUrl === "string" && meta.elementPreviewDataUrl.trim()
              ? meta.elementPreviewDataUrl
              : a.url,
        };
      });

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
    return imgToken(slot);
  }

    const elementTokenById = useMemo(() => {
    const reserved = new Set<string>([
      ...Array.from({ length: 12 }, (_, i) => `@img${i + 1}`),
      ...Array.from({ length: 12 }, (_, i) => `@reference${i + 1}`),

      // compat prompts viejos (bg ya se ignora al generar, pero lo reservamos para evitar colisiones)
      "@bg",
      "@background",
    ]);

    const used = new Set<string>();
    const byId = new Map<string, string>();

    const alloc = (raw: string) => {
      let token = String(raw || "").trim();
      if (!token) return "";
      if (!token.startsWith("@")) token = `@${token}`;

      const base = token;
      const isTaken = (t: string) => used.has(t) || reserved.has(t);

      if (isTaken(token)) {
        let n = 2;
        while (isTaken(`${base}_${n}`)) n++;
        token = `${base}_${n}`;
      }

      used.add(token);
      return token;
    };

    for (let i = 0; i < (elements || []).length; i++) {
      const el = elements[i];
      const name = el?.name || `element_${i + 1}`;
      const base = makeElementTag(name) || `@element_${i + 1}`;
      const token = alloc(base);
      if (el?.id && token) byId.set(el.id, token);
    }

    return byId;
  }, [elements]);

  const promptMentionItems: MentionItem[] = useMemo(() => {
    // Reservados (evita colisiones con nombres de elementos)
  const reserved = new Set<string>([
    ...Array.from({ length: 12 }, (_, i) => `@img${i + 1}`),
    ...Array.from({ length: 12 }, (_, i) => `@reference${i + 1}`),

    // compat prompts viejos (bg ya se ignora al generar, pero lo reservamos para evitar colisiones)
    "@bg",
    "@background",
  ]);

    const used = new Set<string>();
    const out: MentionItem[] = [];

    const allocToken = (rawToken: string, disallowReserved: boolean) => {
      let token = String(rawToken || "").trim();
      if (!token) return "";

      const base = token;
      const isTaken = (t: string) => used.has(t) || (disallowReserved && reserved.has(t));

      if (isTaken(token)) {
        let n = 2;
        while (isTaken(`${base}_${n}`)) n++;
        token = `${base}_${n}`;
      }

      used.add(token);
      return token;
    };

    const push = (it: MentionItem, disallowReserved: boolean) => {
      const tok = allocToken(it.token, disallowReserved);
      if (!tok) return;
      out.push({ ...it, token: tok });
    };

    // ---- Refs (si existen) ----
    for (const slot of REF_SLOTS) {
      const a = refs[slot];
      if (!a) continue;

      const n = slotIndex(slot);
      push({ id: a.id, token: `@img${n}`, label: `img${n}`, kind: "ref", previewUrl: a.url }, false);
      push(
        { id: a.id, token: `@reference${n}`, label: `reference${n}`, kind: "ref", previewUrl: a.url, hidden: true },
        false
      );
    }

    // ---- Elements ----
    const selectedSet = new Set((selectedElementAssetIds || []).slice(0, 5));
    const selectedOrdered = (selectedElementAssetIds || [])
      .slice(0, 5)
      .map((id) => elements.find((x) => x.id === id))
      .filter(Boolean) as ElementItem[];

    const rest = (elements || []).filter((x) => !selectedSet.has(x.id));
    const ordered = [...selectedOrdered, ...rest];

    for (let i = 0; i < ordered.length; i++) {
      const el = ordered[i];
      const name = el?.name || `element_${i + 1}`;
      const stableToken = el?.id ? elementTokenById.get(el.id) : null;
      const token = stableToken || makeElementTag(name) || `@element_${i + 1}`;
      push(
        {
          id: el.id,
          token,
          label: name,
          kind: "element",
          previewUrl: el?.previewUrl || el?.url || null,
        },
        true
      );
    }

    return out;
  }, [refs, selectedElementAssetIds, elements, elementTokenById]);

const promptReferences: PromptReference[] = useMemo(() => {
  const tokenRe = /@[a-z0-9_]+/gi;
  const tokensInPrompt: string[] = Array.from(
    new Set<string>(((prompt || "").match(tokenRe) ?? []).map((t) => String(t)))
  );
  const tokensSet = new Set(tokensInPrompt);

  const byToken = new Map<string, MentionItem>();
  const byIdElement = new Map<string, MentionItem>();

  for (const it of promptMentionItems || []) {
    if (it?.token) byToken.set(it.token, it);
    if (it?.kind === "element" && it?.id) byIdElement.set(it.id, it);
  }

  const out: PromptReference[] = [];
  const usedTokens = new Set<string>();
  const add = (token: string) => {
    if (!token || usedTokens.has(token)) return;
    const it = byToken.get(token);
    if (!it) return;
    usedTokens.add(token);
    out.push({
      token,
      assetId: it.id,
      role: it.kind === "element" ? "element" : "character",
    });
  };

  // 1) Refs seleccionadas.
  //    - Si el prompt usa alias viejos (@reference1, @background), vinculamos ese token.
  //    - Si el prompt no menciona el token, vinculamos el token moderno para que la referencia
  //      igualmente se adjunte (influya) cuando promptReferences != [].
  for (const slot of REF_SLOTS) {
    const a = refs[slot];
    if (!a) continue;

    const n = slotIndex(slot);
    const legacy = `@reference${n}`;
    const modern = `@img${n}`;

    if (tokensSet.has(legacy) && !tokensSet.has(modern)) add(legacy);
    else add(modern);
  }
  // 2) Elements seleccionados (hasta 5)
  for (const id of (selectedElementAssetIds || []).slice(0, 5)) {
    const it = byIdElement.get(id);
    if (it?.token) add(it.token);
  }

  // 3) Tokens presentes en el prompt (incluye elements NO seleccionados)
  for (const token of tokensInPrompt) add(token);

  return out;
}, [prompt, promptMentionItems, refs, selectedElementAssetIds]);


  const elementTokenToId = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of promptMentionItems || []) {
      if (it?.kind === "element" && it?.token && it?.id) m.set(it.token, it.id);
    }
    return m;
  }, [promptMentionItems]);

  const prevElementTokensRef = useRef<Set<string>>(new Set());

  // ✅ Sync Elements con el prompt:
  // - Si borras un token de Element del prompt -> se deselecciona.
  // - Si agregas un token de Element al prompt -> se selecciona (hasta 5).
  // - Refs (img1/img2/img3/bg) NO se tocan.
  useEffect(() => {
    const tokenRe = /@[a-z0-9_]+/gi;
    const tokens = (prompt || "").match(tokenRe) ?? [];

    const current = new Set<string>();
    for (const t of tokens) {
      if (elementTokenToId.has(t)) current.add(t);
    }

    const prev = prevElementTokensRef.current;
    const removed: string[] = [];
    const added: string[] = [];

    for (const t of prev) if (!current.has(t)) removed.push(t);
    for (const t of current) if (!prev.has(t)) added.push(t);

    if (removed.length || added.length) {
      setSelectedElementAssetIds((prevIds) => {
        const beforeIds = Array.isArray(prevIds) ? prevIds : [];
        let nextIds = beforeIds;

        if (removed.length) {
          const removedIds = removed.map((t) => elementTokenToId.get(t)).filter(Boolean) as string[];
          if (removedIds.length) nextIds = nextIds.filter((id) => !removedIds.includes(id));
        }

        if (added.length) {
          const temp = [...nextIds];
          for (const t of added) {
            const id = elementTokenToId.get(t);
            if (!id) continue;
            if (temp.includes(id)) continue;
            if (temp.length >= 5) break;
            temp.push(id);
          }
          nextIds = temp;
        }

        if (nextIds.length > 5) nextIds = nextIds.slice(0, 5);

        const same = nextIds.length === beforeIds.length && nextIds.every((id, i) => id === beforeIds[i]);
        return same ? beforeIds : nextIds;
      });
    }

    prevElementTokensRef.current = current;

    if (current.size > 5) {
      setError("No puedes usar más de 5 Elements a la vez. Elimina alguno del prompt.");
    }
  }, [prompt, elementTokenToId]);


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

    async function buildElementPreviewDataUrl(input: ElementImageInput, maxSide = 320): Promise<string> {
    const src = await resolveInputToUrl(input);
    const loaded = await loadImageViaObjectUrl(src);

    try {
      const iw = loaded.img.naturalWidth || (loaded.img as any).width || 1;
      const ih = loaded.img.naturalHeight || (loaded.img as any).height || 1;
      const scale = Math.min(1, maxSide / Math.max(iw, ih));
      const w = Math.max(1, Math.round(iw * scale));
      const h = Math.max(1, Math.round(ih * scale));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No se pudo crear la miniatura del Element.");

      ctx.drawImage(loaded.img, 0, 0, w, h);
      return canvas.toDataURL("image/jpeg", 0.86);
    } finally {
      loaded.revoke?.();
    }
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

  function closeCreateModal(options?: { restoreCook?: boolean }) {
    setIsElementCreateOpen(false);
    setElementCreatePickerSlot(null);
    if (options?.restoreCook ?? true) {
      openCook();
    }
  }

  function closeAllModal(options?: { restoreCook?: boolean }) {
    setIsElementAllOpen(false);
    if (options?.restoreCook ?? true) {
      openCook();
    }
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

      const elementPreviewDataUrl = await buildElementPreviewDataUrl(elementCreateSlots[0]!);

      // 2) nombre bonito para el asset
      const slug = slugifyName(name);
      const fileName = slug ? `${slug}.jpg` : `element_${Date.now()}.jpg`;
      const mosaicFile = new File([base], fileName, { type: base.type || "image/jpeg" });

      // 3) subir como asset normal (global para todos los modelos)
      const uploaded = await uploadUserAsset(mosaicFile, {
        tool: "element-library",
        name,
        category: elementCreateTag,
        type: "image",
        meta: {
          isElement: true,
          elementPreviewDataUrl,
        },
      });

      await reloadHistory();

      setSelectedElementAssetIds((prev) => {
        if (prev.includes(uploaded.id)) return prev;
        const next = [uploaded.id, ...prev];
        return next.slice(0, 5);
      });

      const tag = (uploaded?.id ? elementTokenById.get(uploaded.id) : null) || makeElementTag(name);
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

    const storedRefs = extractStoredRefsFromMeta(meta, 12);
    const charRefIds = storedRefs.charIds;
    const elementRefIds = storedRefs.elementIds;
    const backgroundAssetId = storedRefs.backgroundId;
    const allRefIds = Array.from(new Set([...charRefIds, ...elementRefIds]));
    const styleAssetId = typeof meta.styleAssetId === "string" ? meta.styleAssetId : null;

    const resolvedStylePreset = resolveStylePresetFromMetaOrPrompt(STYLE_PRESETS, {
      meta,
      prompt: viewer.prompt || "",
    });

    const findAsset = (id: string) => myAssets.find((a) => a.id === id) || null;

    return {
      modelId,
      aspectRatio,
      quality,
      gridMode: typeof meta.gridMode === "string" ? meta.gridMode : DEFAULT_GRID_MODE,
      googleSearchGrounding: Boolean(meta.googleSearchGrounding),
      count,
      styleName: resolvedStylePreset?.name || getStyleNameFromPrompt(viewer.prompt || "", meta),
      refs: {
        chars: charRefIds.map(findAsset).filter(Boolean) as Asset[],
        elements: elementRefIds.map(findAsset).filter(Boolean) as Asset[],
        bg: backgroundAssetId ? findAsset(backgroundAssetId) : null,
        style: resolvedStylePreset?.referenceGridUrl
          ? ({ id: `preset:${resolvedStylePreset.id}`, url: resolvedStylePreset.referenceGridUrl } as any)
          : styleAssetId
            ? findAsset(styleAssetId)
            : null,
        raw: {
          characterAssetIds: allRefIds,
          backgroundAssetId,
          styleAssetId,
          stylePresetId: typeof meta.stylePresetId === "string" ? meta.stylePresetId : null,
        },
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
        restoreCookFromPanel();
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [panel, restoreCookFromPanel]);

  // ESC cierra viewer y panel Start Create
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (viewer) {
        setViewer(null);
        return;
      }
      if (panel) {
        restoreCookFromPanel();
        return;
      }
      if (isCookOpen) {
        closeCook();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewer, panel, isCookOpen, closeCook, restoreCookFromPanel]);

  const refLibraryAssets = useMemo(() => {
    return refLibraryTab === "purchased" ? purchasedAssets : myAssets;
  }, [refLibraryTab, purchasedAssets, myAssets]);

  const filteredPickerAssets = useMemo(() => {
    const base = (refLibraryAssets || []).filter((a: any) => a?.type === "image" && a?.url);
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return base;

    return base.filter((a: any) => {
      const caption = removeStylePresetBlock(a.prompt || "").toLowerCase();
      return (a.name || "").toLowerCase().includes(q) || caption.includes(q);
    });
  }, [refLibraryAssets, pickerQuery]);

  const recipeStyleName = useMemo(() => {
    return getStyleNameFromPromptOrSelection({ prompt, selectedStyleId });
  }, [prompt, selectedStyleId]);

  const recipeChips = useMemo(() => {
    const refCount = Object.values(refs).filter(Boolean).length;
    const chars = [refs.char1, refs.char2, refs.char3].filter(Boolean).length;

    return [
      { label: "Model", value: modelLabel },
      { label: "Ratio", value: aspectRatio },
      { label: "Count", value: String(count) },
      { label: "Quality", value: quality },
      { label: "Refs", value: `${chars} char${chars === 1 ? "" : "s"} (${refCount})` },
      { label: "Style", value: recipeStyleName },
    ];
  }, [model, aspectRatio, count, quality, refs, recipeStyleName]);

  function setRefSlot(slot: RefSlot, asset: Asset | null) {
    setRefs((prev) => {
      const idx = REF_SLOTS.indexOf(slot);
      const current = REF_SLOTS.map((s) => prev[s]);

      const next = [...current];
      if (idx >= 0) next[idx] = asset;

      // Compactar: elimina huecos (null) y vuelve a llenar hasta 12 slots
      const packed = next.filter(Boolean) as Asset[];

      const out = {} as Record<RefSlot, Asset | null>;
      for (let i = 0; i < REF_SLOTS.length; i++) {
        out[REF_SLOTS[i]] = packed[i] || null;
      }

      return out;
    });
  }

  async function handleUploadToSlot(slot: RefSlot, file: File) {
    try {
      const uploaded = await uploadUserAsset(file, REF_TOOL_ID);
      setRefSlot(slot, uploaded);
      restoreCookFromPanel();
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

    const requestedCount = Math.max(1, Math.min(4, Number(count) || 1));

    setIsGenerating(true);
    startLocalPending(requestedCount);
    setPendingSlots(Array.from({ length: requestedCount }, (_, i) => `pending-local-${Date.now()}-${i}`));
    setError(null);

    try {
      // IDs para backend
      const characterAssetIds = REF_SLOTS.map((s) => refs[s]?.id).filter(Boolean) as string[];

      // Elements usados (máx 5):
      // - los seleccionados
      // - y/o los insertados via @ en el prompt
      const elementFromPromptRefs = Array.from(
        new Set([
          ...(selectedElementAssetIds || []).slice(0, 5),
          ...((promptReferences || []).filter((r) => r.role === "element").map((r) => r.assetId)),
        ])
      );

      if (elementFromPromptRefs.length > 5) {
        throw new Error("No puedes usar más de 5 Elements a la vez. Quita algunos y vuelve a intentar.");
      }

      const elementAssetIds = elementFromPromptRefs.slice(0, 5);

      // Guardrail total referencias (usa el set real que enviará el backend)
      const effectiveRefIds = Array.from(
        new Set(
          (promptReferences && promptReferences.length)
            ? promptReferences.map((r) => r.assetId)
            : [...characterAssetIds, ...elementAssetIds]
        )
      );

      if (effectiveRefIds.length > 12) {
        throw new Error("Demasiadas referencias: máximo 12 (sumando imágenes + Elements).");
      }

      // Kling: si el prompt trae un bloque de estilo guardado (por “Reuse prompt”),
      // lo limpiamos y re-adjuntamos una versión corta para no romper el límite.
      const split = kling ? splitStyleBlock(basePrompt) : { cleaned: basePrompt, style: null };
      let finalPrompt = kling ? split.cleaned : basePrompt;
      // Compat: background fue eliminado del producto.
      // Si el usuario trae prompts viejos con @bg/@background, los ignoramos para no bloquear la generación.
      finalPrompt = finalPrompt.replace(/@bg\b/gi, "").replace(/@background\b/gi, "");
      {
        const tokenRe = /@[a-z0-9_]+/gi;
        const tokensInPrompt: string[] = Array.from(
          new Set<string>((finalPrompt.match(tokenRe) ?? []).map((t) => String(t)))
        );
        const known = new Set((promptMentionItems || []).map((x) => x.token));
        const unknown = tokensInPrompt.filter((t) => !known.has(t));
        if (unknown.length) {
          throw new Error(
            `Tokens no vinculados: ${unknown.join(", ")}. ` +
              `Selecciona las referencias/Elements primero y luego usa '@' para insertarlos.`
          );
        }
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

    if (kling && finalPrompt.length > KLING_PROMPT_MAX) {
      throw new Error(
        `Kling limita el prompt a ${KLING_PROMPT_MAX} caracteres. Tu prompt final tiene ${finalPrompt.length}. ` +
          `Reduce el texto (o quita Style/Background) y vuelve a intentar.`
      );
    }

    const embeddedStylePreset = split.style
      ? findStylePresetByPrompt(STYLE_PRESETS, split.style)
      : null;

    const effectiveStylePreset = selectedStylePreset || embeddedStylePreset;
    const styleReferenceCount = effectiveStylePreset?.referenceGridUrl ? 1 : 0;

    const totalRefs = effectiveRefIds.length + styleReferenceCount;
    const effectiveModel = model === KLING_MODEL_O3_OMNI && totalRefs === 0 ? KLING_MODEL_V3_TEXT : model;

    const maxRefsForModel = maxVisualRefsForModel(effectiveModel);
    if (maxRefsForModel != null && totalRefs > maxRefsForModel) {
      throw new Error(
        `El modelo ${prettyModelLabel(effectiveModel)} soporta hasta ${maxRefsForModel} referencia(s) visual(es) en este flujo. ` +
          `Ahora intentaste usar ${totalRefs} contando el grid del preset.`
      );
    }

    const styleReferenceDataUrl = effectiveStylePreset
      ? await fetchPresetReferenceGridDataUrl(effectiveStylePreset)
      : null;

    const effCaps = getActiveCaps(effectiveModel);

    let effectiveAspectRatio =
      effCaps.aspectRatios.some((ar) => ar.value === aspectRatio)
        ? aspectRatio
        : (effCaps.aspectRatios.find((ar) => ar.value === "1:1")?.value || effCaps.aspectRatios[0]?.value || "1:1");

    if (effectiveModel === "kling:kling-image-o1" && totalRefs === 0 && effectiveAspectRatio === "auto") {
      effectiveAspectRatio = "1:1";
    }

    const effectiveQuality: ImageGenQuality =
      quality && effCaps.qualities.includes(quality)
        ? (quality as ImageGenQuality)
        : ((effCaps.qualities[effCaps.qualities.length - 1] || effCaps.qualities[0] || "1K") as ImageGenQuality);

    const effectiveCount = effCaps.countOptions.includes(count) ? count : (effCaps.countOptions[0] || 1);

    await generateImageBatch(finalPrompt, effectiveModel, {
      aspectRatio: effectiveAspectRatio,
      count: effectiveCount,
      quality: effectiveQuality,
      gridMode,
      googleSearchGrounding: supportsGoogleSearchGrounding(effectiveModel) ? googleSearchGrounding : false,
      tool: TOOL_ID,
      nameHint: TOOL_ID,
      characterAssetIds,
      stylePresetId: effectiveStylePreset?.id || undefined,
      stylePresetName: effectiveStylePreset?.name || undefined,
      styleReferenceDataUrl: styleReferenceDataUrl || undefined,
      promptReferences,
      asyncHooks: makeAsyncHooks(finalPrompt, effectiveCount),
    });
      await reloadHistory();
    } catch (e: any) {
      setError(e?.message || "Failed to generate image.");
    } finally {
      setIsGenerating(false);
      clearLocalPending();
      if (!persistedPendingSlots.length) {
        setPendingSlots([]);
      }
    }
  }

  function handleTogglePublish(asset: Asset) {
    window.dispatchEvent(new CustomEvent("tales:open-sell", { detail: { asset } }));
  }

  async function handleDownload(asset: Asset) {
    try {
      await downloadAssetToDisk(asset.id, asset.name || "image");
    } catch (e: any) {
      setError(e?.message || "No se pudo descargar.");
    }
  }

  async function handleDelete(asset: Asset) {
    const isPurchased = asset.accessSource === "purchased";

    const ok = window.confirm(
      isPurchased
        ? "¿Ocultar este asset comprado de tu biblioteca?\n\nSolo desaparecerá para tu cuenta. La compra seguirá siendo válida y no se borrará para otros usuarios. Si más adelante quieres volver a usarlo, tendrás que reabrir o reusar la receta o creación que lo contiene."
        : "¿Seguro que deseas eliminar esta imagen? Esta acción no se puede deshacer."
    );
    if (!ok) return;

    try {
      const result = await deleteAsset(asset.id);

      if (isPurchased || result.mode === "hidden") {
        setPurchasedAssets((prev) => prev.filter((x) => x.id !== asset.id));
        if (viewer?.id === asset.id) setViewer(null);
        return;
      }

      setHistory((prev) => {
        const next = prev.filter((x) => x.id !== asset.id);
        const nextCount = Math.min(historyVisibleCount, next.length);
        setHistoryVisibleCount(nextCount);
        setVisibleHistory(next.slice(0, nextCount));
        return next;
      });

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

    // 1) prompt visible (sin bloques ocultos de style)
    setPrompt(removeStylePresetBlock(raw));

    // 2) receta (model/ratio/count/quality + refs)
    const meta = (asset as any).meta || {};

    // model
    const metaModel = typeof meta.model === "string" ? meta.model : null;
    if (metaModel) {
      // Si el asset fue generado con Kling V3 (texto), lo “mapeamos” a Omni O3 en UI.
      // Esto mantiene el selector limpio (solo Omni O3), y el botón Generate seguirá
      // usando V3 automáticamente si no hay referencias.
      const mappedModel = metaModel === KLING_MODEL_V3_TEXT ? KLING_MODEL_O3_OMNI : metaModel;

      setModel(mappedModel as GeminiModel);

      // NanoBanana (flash) solo soporta 1K
      if (mappedModel === GeminiModel.IMAGE) setQuality("1K");
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
    const storedRefs = extractStoredRefsFromMeta(meta, 12);

    // chars (hasta 12) y Elements (compat)
    const charIds = storedRefs.charIds;
    const finalElementIds = storedRefs.elementIds;

    const findAsset = (id: unknown) =>
      typeof id === "string" ? myAssets.find((a) => a.id === id) || null : null;

    const nextRefs: Record<RefSlot, Asset | null> = {
      char1: findAsset(charIds[0]),
      char2: findAsset(charIds[1]),
      char3: findAsset(charIds[2]),
      char4: findAsset(charIds[3]),
      char5: findAsset(charIds[4]),
      char6: findAsset(charIds[5]),
      char7: findAsset(charIds[6]),
      char8: findAsset(charIds[7]),
      char9: findAsset(charIds[8]),
      char10: findAsset(charIds[9]),
      char11: findAsset(charIds[10]),
      char12: findAsset(charIds[11]),
    };

    setRefs(nextRefs);

    // restaurar Elements (global)
    setSelectedElementAssetIds(
      finalElementIds.filter((id): id is string => typeof id === "string").slice(0, 5)
    );

    // 3) UI: si el prompt trae un bloque de style, intentamos “reconocer” el preset
    const metaStyleId = typeof meta.stylePresetId === "string" ? meta.stylePresetId : null;
    const match =
      findStylePresetById(STYLE_PRESETS, metaStyleId) ||
      findStylePresetByPrompt(STYLE_PRESETS, extractStyleBlock(raw) || "");

    setSelectedStyleId(match ? match.id : null);

    setPanel(null);
    setViewer(null);
    openCook();
  }

  return (
    <div
      ref={rootRef}
      className={`${styles.root} ${isCookOpen ? styles.rootCookOpen : ""}`}
      onMouseMove={handleRootMouseMove}
      onMouseLeave={handleRootMouseLeave}
    >
      {/* HISTORIAL (único contenido visible arriba) */}
      <div className={`${styles.stage} ${isCookOpen ? styles.stageCookOpen : ""}`}>
        <div className={`${styles.historyHeader} ${isCookOpen ? styles.historyHeaderCookOpen : ""}`}>
          <div className={styles.historyTitle}>
            <span className={styles.kicker}>EDITOR IA PRO</span>
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

          <div className={styles.historyActions}>
            <button className={styles.ghostBtn} onClick={reloadHistory} type="button" disabled={isLoadingHistory}>
              Refresh
            </button>
            <button className={styles.closeHomeBtn} onClick={goHome} type="button" aria-label="Close tool and go home" title="Close">
              ×
            </button>
          </div>
        </div>

        <div className={`${styles.historyGrid} ${styles.historyGridCook} ${isCookOpen ? styles.historyGridCookOpen : ""}`}>
          {history.length === 0 && pendingSlots.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyAnimator}>
                <div className={styles.emptyGrid} />
                <div className={styles.emptyGlow} />
                <div className={styles.emptyScan} />
                <div className={styles.emptyOrb} />
              </div>
              <div className={styles.emptyCopy}>
                <div className={styles.emptyCode}>NO GENERATIONS</div>
                <div className={styles.emptyText}>Genera tu primera imagen para ver el historial aquí.</div>
              </div>
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

              {visibleHistory.map((asset) => {
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
                        title="1NationUp Store"
                        onClick={() => window.dispatchEvent(new CustomEvent("tales:open-store", { detail: { asset } }))}
                      >
                        <OneNationUpIcon size={18} />
                      </button>

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
                        title="Vender / Administrar listing"
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
          {hasMoreHistory && (
            <div className={styles.historyLoadMoreWrap}>
              <button
                type="button"
                className={styles.loadMoreBtn}
                onClick={handleLoadMoreHistory}
                disabled={isLoadingMoreHistory}
              >
                {isLoadingMoreHistory ? "Cargando..." : "Cargar más"}
              </button>
              <div className={styles.loadMoreHint}>
                Mostrando {visibleHistory.length} de {history.length}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* START CREATE / SIDEBAR DE PROMPT */}
      {panel === null && (
        <button
          type="button"
          className={`${styles.cookToggle} ${isCookSidebarVisible ? styles.cookToggleOpen : styles.cookTogglePulse}`}
          onClick={() => {
            if (isCookSidebarVisible) closeCook();
            else openCook();
          }}
          aria-expanded={isCookSidebarVisible}
          aria-controls="editor-pro-start-create"
          aria-label={isCookSidebarVisible ? "Close Start Create" : "Open Start Create"}
        >
          <span className={styles.cookToggleLabel}>Start Create</span>
          <span className={styles.cookToggleGlyph} aria-hidden="true">{isCookSidebarVisible ? "×" : "+"}</span>
        </button>
      )}

      {isCookLayerVisible && (
        <div
          id="editor-pro-start-create"
          className={`${styles.cookOverlay} ${styles.cookOverlayOpen}`}
          aria-hidden={!isCookLayerVisible}
        >
          <button
            type="button"
            className={styles.cookBackdrop}
            aria-label={panel ? "Back to Start Create" : "Close Start Create"}
            tabIndex={isCookLayerVisible ? 0 : -1}
            onClick={() => {
              if (panel) restoreCookFromPanel();
              else closeCook();
            }}
          />

          {panel && (
            <div className={`${styles.cookPanelShell} ${!isCookSidebarVisible ? styles.cookPanelShellSolo : ""}`}>
              <div ref={popoverRef} className={styles.cookPanel}>
                {panel === "reference" && (
                  <>
                    <div className={styles.popoverHeader}>
                      <div className={styles.popoverTitle}>Reference</div>
                      <div className={styles.headerRight}>
                        <div className={styles.cookSectionMeta}>{refLabel}</div>
                        <button type="button" className={styles.closeBtn} onClick={restoreCookFromPanel} aria-label="Close Reference">
                          ×
                        </button>
                      </div>
                    </div>
                    <div className={`${styles.popoverBody} ${styles.cookPanelBody}`}>
                      <div className={`${styles.refSlots} ${styles.cookPanelScroll}`}>
                        {REF_SLOTS.map((slot) => {
                          const a = (refs as any)[slot] as Asset | null;
                          const isPicking = pickerSlot === slot;
                          return (
                            <div key={slot} className={styles.refSlot}>
                              <div className={styles.refSlotLeft}>
                                <div className={styles.refSlotLabel}>{SLOT_LABEL[slot]}</div>
                                {a ? (
                                  <div className={styles.refSlotThumb}>
                                    <img src={a.url} alt={a.name} />
                                  </div>
                                ) : (
                                  <div className={styles.refSlotThumb}><div className={styles.refSlotEmpty}>+</div></div>
                                )}
                                
                              </div>

                              <div className={styles.refSlotRight}>
                                <input
                                  type="file"
                                  accept="image/*"
                                  className={styles.hiddenFileInput}
                                  ref={(node) => {
                                    refFileInputsRef.current[slot] = node;
                                  }}
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (!file) return;
                                    void handleUploadToSlot(slot, file);
                                    e.currentTarget.value = "";
                                  }}
                                />
                                <button
                                  type="button"
                                  className={styles.smallBtn}
                                  onClick={() => refFileInputsRef.current[slot]?.click()}
                                >
                                  Upload
                                </button>
                                <button
                                  type="button"
                                  className={`${styles.smallBtnGhost} ${isPicking ? styles.smallBtnGhostActive : ""}`}
                                  onClick={() => {
                                    setPickerQuery("");
                                    setPickerSlot((prev) => (prev === slot ? null : slot));
                                  }}
                                >
                                  Pick
                                </button>
                                {a && (
                                  <button type="button" className={styles.smallBtnGhost} onClick={() => setRefSlot(slot, null)}>
                                    Remove
                                  </button>
                                )}
                              </div>

                              {isPicking && (
                                <div className={styles.cookPickerShell}>
                                  <div className={styles.pickerTop}>
                                    <div className={styles.pickerTitle}>Select asset for {SLOT_LABEL[slot]}</div>
                                    <button
                                      type="button"
                                      className={styles.smallBtnGhost}
                                      onClick={() => setPickerSlot(null)}
                                    >
                                      Close
                                    </button>
                                  </div>

                                  <div className={styles.pickerTabs}>
                                    <button
                                      type="button"
                                      className={`${styles.smallBtnGhost} ${refLibraryTab === "history" ? styles.smallBtnGhostActive : ""}`}
                                      onClick={() => setRefLibraryTab("history")}
                                    >
                                      Your library
                                    </button>
                                    <button
                                      type="button"
                                      className={`${styles.smallBtnGhost} ${refLibraryTab === "purchased" ? styles.smallBtnGhostActive : ""}`}
                                      onClick={() => setRefLibraryTab("purchased")}
                                    >
                                      Purchased assets
                                    </button>
                                  </div>

                                  <input
                                    className={styles.search}
                                    placeholder={refLibraryTab === "purchased" ? "Search in purchased assets..." : "Search in your library..."}
                                    value={pickerQuery}
                                    onChange={(e) => setPickerQuery(e.target.value)}
                                  />

                                  <div className={styles.pickerGrid}>
                                    {filteredPickerAssets.map((asset) => (
                                      <button
                                        key={asset.id}
                                        type="button"
                                        className={styles.pickerTile}
                                        onClick={() => {
                                          setRefSlot(slot, asset);
                                          restoreCookFromPanel();
                                        }}
                                      >
                                        <img src={asset.url} alt={asset.name} />
                                        <div className={styles.pickerTileMeta}>
                                          <div className={styles.pickerTileCap}>
                                            {removeStylePresetBlock(asset.prompt || "") || asset.name}
                                          </div>
                                          {asset.accessSource === "purchased" ? (
                                            <span className={styles.pickerTileBadge}>Purchased</span>
                                          ) : null}
                                        </div>
                                      </button>
                                    ))}

                                    {filteredPickerAssets.length === 0 ? (
                                      <div className={styles.pickerEmpty}>
                                        {refLibraryTab === "purchased"
                                          ? "Aún no tienes assets comprados en Community Store."
                                          : "No images found in your library."}
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}

                {panel === "model" && (
                  <>
                    <div className={styles.popoverHeader}>
                      <div className={styles.popoverTitle}>Model</div>
                      <div className={styles.headerRight}>
                        <div className={styles.cookSectionMeta}>{modelLabel}</div>
                        <button type="button" className={styles.closeBtn} onClick={restoreCookFromPanel} aria-label="Close Model">
                          ×
                        </button>
                      </div>
                    </div>
                    <div className={`${styles.popoverBody} ${styles.cookPanelBody} ${styles.cookPanelScroll}`}>
                      <div className={styles.modelGrid}>
                        {modelGroups.map((group) => (
                          <div key={group.label} className={styles.modelGroup}>
                            <div className={styles.modelGroupLabel}>{group.label}</div>
                            <div className={styles.modelGroupOptions}>
                              {group.options.map((opt) => (
                                <button
                                  key={opt.value}
                                  type="button"
                                  className={`${styles.modelOption} ${model === opt.value ? styles.modelOptionActive : ""}`}
                                  onClick={() => handleModelSelect(opt.value)}
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {panel === "parameters" && (
                  <>
                    <div className={styles.popoverHeader}>
                      <div className={styles.popoverTitle}>Parameters</div>
                      <div className={styles.headerRight}>
                        <div className={styles.cookSectionMeta}>{paramsLabel}</div>
                        <button type="button" className={styles.closeBtn} onClick={restoreCookFromPanel} aria-label="Close Parameters">
                          ×
                        </button>
                      </div>
                    </div>
                    <div className={`${styles.popoverBody} ${styles.cookPanelBody} ${styles.cookPanelScroll}`}>
                      <div className={styles.paramGrid}>
                        <div className={styles.formRow}>
                          <label className={styles.formLabel}>Aspect Ratio</label>
                          <select
                            className={styles.select}
                            value={aspectRatio}
                            onChange={(e) => {
                              setAspectRatio(e.target.value);
                              restoreCookFromPanel();
                            }}
                          >
                            {aspectRatioOptions.map((ar) => (
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
                              restoreCookFromPanel();
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
                          <label className={styles.formLabel}>Grid</label>
                          <select
                            className={styles.select}
                            value={gridMode}
                            onChange={(e) => {
                              setGridMode(e.target.value);
                              restoreCookFromPanel();
                            }}
                          >
                            {GRID_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
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
                              restoreCookFromPanel();
                            }}
                          >
                            {getActiveCaps(model).qualities.map((q) => (
                              <option key={q} value={q}>
                                {q}
                              </option>
                            ))}
                          </select>
                        </div>

                        {supportsGoogleSearchGrounding(model) && (
                          <div className={styles.formRow}>
                            <label className={styles.formLabel}>Web Grounding</label>
                            <button
                              type="button"
                              className={`${styles.modelOption} ${googleSearchGrounding ? styles.modelOptionActive : ""}`}
                              onClick={() => {
                                setGoogleSearchGrounding((prev) => !prev);
                                restoreCookFromPanel();
                              }}
                            >
                              {googleSearchGrounding ? "Enabled" : "Disabled"}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {panel === "styles" && (
                  <>
                    <div className={styles.popoverHeader}>
                      <div className={styles.popoverTitle}>Styles</div>
                      <div className={styles.headerRight}>
                        <div className={styles.cookSectionMeta}>{styleLabel}</div>
                        <button
                          type="button"
                          className={styles.smallBtnGhost}
                          onClick={() => {
                            setSelectedStyleId(null);
                            restoreCookFromPanel();
                          }}
                        >
                          Clear
                        </button>
                        <button type="button" className={styles.closeBtn} onClick={restoreCookFromPanel} aria-label="Close Styles">
                          ×
                        </button>
                      </div>
                    </div>
                    <div className={`${styles.popoverBody} ${styles.cookPanelBody} ${styles.cookPanelScroll}`}>
                      <div className={styles.presetGrid}>
                        {STYLE_PRESETS.map((preset) => {
                          const active = selectedStyleId === preset.id;
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              className={`${styles.presetCard} ${active ? styles.presetCardActive : ""}`}
                              onClick={() => {
                                setSelectedStyleId(preset.id);
                                restoreCookFromPanel();
                              }}
                            >
                              <div className={styles.presetCover}>
                                {preset.coverUrl ? <img src={preset.coverUrl} alt={preset.name} /> : <div className={styles.presetCoverEmpty} />}

                                {Array.isArray(preset.exampleUrls) && preset.exampleUrls.length > 0 ? (
                                  <div className={styles.presetHoverExamples}>
                                    {preset.exampleUrls.slice(0, 4).map((url, idx) => (
                                      <div key={`${preset.id}_${idx}_${url}`} className={styles.presetHoverExample}>
                                        <img src={url} alt={`${preset.name} example ${idx + 1}`} />
                                        <span className={styles.presetHoverBadge}>{idx + 1}</span>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                              <div className={styles.presetName}>{preset.name}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {isCookSidebarVisible && (
            <div className={styles.cookSidebarShell}>
              <div className={styles.cookSidebar}>
                <div className={`${styles.cookSectionCard} ${styles.cookPromptCard}`}>
                  <div className={`${styles.promptRow} ${styles.cookPromptRow}`}>
                    <div className={`${styles.promptInputWrap} ${styles.cookPromptInputWrap}`}>
                      <div className={`${styles.klingDock} ${styles.cookKlingDock}`}>
                        <button
                          type="button"
                          className={`${styles.klingElementBtn} ${elementCtaActive ? styles.klingElementBtnCta : ""}`}
                          onClick={() => {
                            setElementCtaActive(false);
                            setIsCookOpen(false);
                            setPanel(null);
                            setPickerSlot(null);
                            setPickerQuery("");
                            setIsElementAllOpen(true);
                          }}
                          title="Element/Person"
                          aria-label="Element/Person"
                        >
                          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                            <path
                              fill="currentColor"
                              d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4.4 0-8 2.24-8 5v2h16v-2c0-2.76-3.6-5-8-5z"
                            />
                          </svg>

                          {selectedElementAssetIds.length > 0 && (
                            <span className={styles.klingBadge}>{selectedElementAssetIds.length}</span>
                          )}
                        </button>
                      </div>

                      <div className={`${styles.promptEditor} ${styles.cookPromptEditor}`}>
                        <MentionTextarea
                          value={prompt}
                          onChange={setPrompt}
                          placeholder="Escribe tu prompt y comienza a crear..."
                          rows={4}
                          textareaClassName={`${styles.prompt} ${styles.cookPrompt}`}
                          items={promptMentionItems}
                          onSelectItem={(it) => {
                            if (it?.kind !== "element") return;

                            const already = (selectedElementAssetIds || []).includes(it.id);
                            if (already) return;

                            if ((selectedElementAssetIds || []).length >= 5) {
                              setError("No puedes usar más de 5 Elements a la vez. Quita uno y vuelve a intentar.");
                              return false;
                            }

                            setSelectedElementAssetIds((prev) => [...(prev || []), it.id].slice(0, 5));
                          }}
                        />
                      </div>
                    </div>

                    <div className={`${styles.generateCol} ${styles.cookGenerateCol}`}>
                      <button
                        type="button"
                        className={`${styles.generateBtn} ${styles.cookGenerateBtn}`}
                        disabled={isGenerating || !prompt.trim()}
                        onClick={() => {
                          void handleGenerate();
                        }}
                        data-loading={isGenerating ? "true" : "false"}
                      >
                        <span className={styles.generateLabel}>{isGenerating ? "GENERATING" : "GENERATE"}</span>
                        {isGenerating && <span className={styles.generateSpinner} aria-hidden="true" />}
                      </button>
                    </div>

                    <div className={styles.cookControlsRow}>
                      <button
                        type="button"
                        className={`${styles.controlBtn} ${styles.cookControlBtn} ${panel === "reference" ? styles.controlBtnActive : ""}`}
                        onClick={() => toggleCookPanel("reference")}
                        aria-expanded={panel === "reference"}
                      >
                        <span className={styles.controlBtnLabel}>Reference</span>
                        <span className={styles.controlBtnMeta}>{refLabel}</span>
                      </button>

                      <button
                        type="button"
                        className={`${styles.controlBtn} ${styles.cookControlBtn} ${panel === "model" ? styles.controlBtnActive : ""}`}
                        onClick={() => toggleCookPanel("model")}
                        aria-expanded={panel === "model"}
                      >
                        <span className={styles.controlBtnLabel}>Model</span>
                        <span className={styles.controlBtnMeta}>{modelLabel}</span>
                      </button>

                      <button
                        type="button"
                        className={`${styles.controlBtn} ${styles.cookControlBtn} ${panel === "parameters" ? styles.controlBtnActive : ""}`}
                        onClick={() => toggleCookPanel("parameters")}
                        aria-expanded={panel === "parameters"}
                      >
                        <span className={styles.controlBtnLabel}>Parameters</span>
                        <span className={styles.controlBtnMeta}>{paramsLabel}</span>
                      </button>

                      <button
                        type="button"
                        className={`${styles.controlBtn} ${styles.cookControlBtn} ${panel === "styles" ? styles.controlBtnActive : ""}`}
                        onClick={() => toggleCookPanel("styles")}
                        aria-expanded={panel === "styles"}
                      >
                        <span className={styles.controlBtnLabel}>Styles</span>
                        <span className={styles.controlBtnMeta}>{styleLabel}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

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

                <button className={styles.iconBtn} type="button" title="Vender / Administrar listing" onClick={() => handleTogglePublish(viewer)}>
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

                  <div className={styles.recipeItem}>
                    <div className={styles.recipeLabel}>Grid</div>
                    <div className={styles.recipeValue}>{viewerRecipeInfo?.gridMode || "none"}</div>
                  </div>

                  <div className={styles.recipeItem}>
                    <div className={styles.recipeLabel}>Web</div>
                    <div className={styles.recipeValue}>{viewerRecipeInfo?.googleSearchGrounding ? "On" : "Off"}</div>
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
                    <div className={styles.elementPickerTitle}>Pick from library</div>
                    <button type="button" className={styles.smallBtnGhost} onClick={() => setElementCreatePickerSlot(null)}>
                      Close
                    </button>
                  </div>

                  <div className={styles.pickerTabs}>
                    <button
                      type="button"
                      className={`${styles.smallBtnGhost} ${elementLibraryTab === "mine" ? styles.smallBtnGhostActive : ""}`}
                      onClick={() => setElementLibraryTab("mine")}
                    >
                      Your library
                    </button>
                    <button
                      type="button"
                      className={`${styles.smallBtnGhost} ${elementLibraryTab === "purchased" ? styles.smallBtnGhostActive : ""}`}
                      onClick={() => setElementLibraryTab("purchased")}
                    >
                      Purchased assets
                    </button>
                  </div>

                  <input
                    className={styles.search}
                    value={elementCreatePickerQuery}
                    onChange={(e) => setElementCreatePickerQuery(e.target.value)}
                    placeholder={elementLibraryTab === "purchased" ? "Search purchased assets..." : "Search images..."}
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
                          <div className={styles.pickerTileMeta}>
                            <div className={styles.pickerTileCap}>{a.name || "Untitled"}</div>
                            {a.accessSource === "purchased" ? (
                              <span className={styles.pickerTileBadge}>Purchased</span>
                            ) : null}
                          </div>
                        </button>
                      ))}

                      {elementPickerCandidates.length === 0 && (
                        <div className={styles.pickerEmpty}>
                          {elementLibraryTab === "purchased"
                            ? "Aún no tienes assets comprados en Community Store."
                            : "No images found."}
                        </div>
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
                    const src = el.previewUrl || el.url || "";
                    return (
                      <div key={el.id} className={`${styles.elementAllCard} ${active ? styles.elementAllCardActive : ""}`}>
                        <button
                          type="button"
                          className={styles.elementAllThumb}
                          onClick={() => {
                            setSelectedElementAssetIds((prev) => {
                              const has = prev.includes(el.id);
                              if (has) {
                                const tag = (el?.id ? elementTokenById.get(el.id) : null) || makeElementTag(el.name);
                                if (tag) appendPromptTag(tag);
                                return prev;
                              }
                              if (prev.length >= 5) {
                                setError("Kling permite seleccionar máximo 5 Elements a la vez.");
                                return prev;
                              }
                              const tag = (el?.id ? elementTokenById.get(el.id) : null) || makeElementTag(el.name);
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
                                  const tag = (el?.id ? elementTokenById.get(el.id) : null) || makeElementTag(el.name);
                                  if (tag) appendPromptTag(tag);
                                  return prev;
                                }
                                if (prev.length >= 5) {
                                  setError("Kling permite seleccionar máximo 5 Elements a la vez.");
                                  return prev;
                                }
                                const tag = (el?.id ? elementTokenById.get(el.id) : null) || makeElementTag(el.name);
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
                <button
                  type="button"
                  className={styles.smallBtnGhost}
                  onClick={() => {
                    closeAllModal({ restoreCook: false });
                    setIsElementCreateOpen(true);
                  }}
                >
                  Create new
                </button>

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
