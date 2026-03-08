import type { ImagePreset } from "./presetTypes";

const STYLE_PRESET_BLOCK_START = "[[STYLE_PRESET_START]]";
const STYLE_PRESET_BLOCK_END = "[[STYLE_PRESET_END]]";
const LEGACY_STYLE_PRESET_BLOCK_START = "/* STYLE_PRESET_START */";
const LEGACY_STYLE_PRESET_BLOCK_END = "/* STYLE_PRESET_END */";

function normalizeText(value: string | null | undefined): string {
  return String(value || "").trim();
}

export function extractEmbeddedStyleBlock(input: string | null | undefined): string | null {
  const text = String(input || "");
  const pairs = [
    { start: STYLE_PRESET_BLOCK_START, end: STYLE_PRESET_BLOCK_END },
    { start: LEGACY_STYLE_PRESET_BLOCK_START, end: LEGACY_STYLE_PRESET_BLOCK_END },
  ];

  for (const { start, end } of pairs) {
    const s = text.indexOf(start);
    const e = text.indexOf(end);
    if (s !== -1 && e !== -1 && e > s) {
      const inside = text.slice(s + start.length, e).trim();
      return inside || null;
    }
  }

  return null;
}

export function findPresetById(
  presets: ImagePreset[],
  id: string | null | undefined
): ImagePreset | null {
  const safeId = normalizeText(id);
  if (!safeId) return null;
  return presets.find((p) => normalizeText(p.id) === safeId) || null;
}

export function findPresetByPrompt(
  presets: ImagePreset[],
  prompt: string | null | undefined
): ImagePreset | null {
  const safePrompt = normalizeText(prompt);
  if (!safePrompt) return null;

  return (
    presets.find((p) => normalizeText(p.prompt) === safePrompt) ||
    null
  );
}

export function resolvePresetFromMetaOrPrompt(
  presets: ImagePreset[],
  opts: {
    prompt?: string | null;
    meta?: any;
    selectedStyleId?: string | null;
  }
): ImagePreset | null {
  const selected = findPresetById(presets, opts.selectedStyleId);
  if (selected) return selected;

  const metaStyleId =
    typeof opts?.meta?.stylePresetId === "string" ? opts.meta.stylePresetId : null;
  const fromMeta = findPresetById(presets, metaStyleId);
  if (fromMeta) return fromMeta;

  const inside = extractEmbeddedStyleBlock(opts.prompt || "");
  const fromPrompt = findPresetByPrompt(presets, inside);
  if (fromPrompt) return fromPrompt;

  return null;
}

export function getPresetNameFromMetaOrPrompt(
  presets: ImagePreset[],
  opts: {
    prompt?: string | null;
    meta?: any;
    selectedStyleId?: string | null;
    noneLabel?: string;
    customLabel?: string;
  }
): string {
  const preset = resolvePresetFromMetaOrPrompt(presets, opts);
  if (preset?.name) return preset.name;

  const inside = extractEmbeddedStyleBlock(opts.prompt || "");
  if (inside) return opts.customLabel || "Custom";

  return opts.noneLabel || "None";
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const out = typeof reader.result === "string" ? reader.result : "";
      if (!out) {
        reject(new Error("No se pudo convertir el grid del preset a data URL."));
        return;
      }
      resolve(out);
    };

    reader.onerror = () => reject(new Error("No se pudo leer el grid del preset."));
    reader.readAsDataURL(blob);
  });
}

export async function fetchPresetReferenceGridDataUrl(
  preset: ImagePreset | null | undefined
): Promise<string | null> {
  if (!preset) return null;

  const refUrl = typeof preset.referenceGridUrl === "string" ? preset.referenceGridUrl.trim() : "";
  if (!refUrl) {
    throw new Error(
      `El preset "${preset.name}" no tiene referenceGridUrl. Ábrelo en el preset manager, genera el grid 2x2 y guárdalo.`
    );
  }

  const resp = await fetch(refUrl);
  if (!resp.ok) {
    throw new Error(
      `No se pudo cargar el grid de referencia del preset "${preset.name}" (${resp.status}). ` +
        `Verifica que exista el archivo y que la ruta sea correcta.`
    );
  }

  const blob = await resp.blob();
  return blobToDataUrl(blob);
}