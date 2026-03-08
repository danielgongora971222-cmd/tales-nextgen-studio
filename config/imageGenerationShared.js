export const GOOGLE_IMAGE_MODELS = Object.freeze({
  NANO_BANANA: "gemini-2.5-flash-image",
  NANO_BANANA_2: "gemini-3.1-flash-image-preview",
  NANO_BANANA_PRO: "gemini-3-pro-image-preview",
});

export const DEFAULT_IMAGE_GENERATOR_MODEL = GOOGLE_IMAGE_MODELS.NANO_BANANA_2;
export const DEFAULT_GRID_MODE = "none";

export const GRID_OPTIONS = Object.freeze([
  { value: "none", label: "None" },
  { value: "2x2", label: "2x2" },
  { value: "2x3", label: "2x3" },
  { value: "3x3", label: "3x3" },
  { value: "4x4", label: "4x4" },
  { value: "3x4", label: "3x4" },
]);

const GRID_INSTRUCTIONS = Object.freeze({
  none: [
    "Output exactly one final image as a single, unified composition.",
    "Never create a grid, collage, contact sheet, tiled layout, comparison sheet, film strip, storyboard, comic page, diptych, triptych, or any multi-panel arrangement.",
    "Do not split the canvas into multiple frames, cells, thumbnails, variations, or repeated views.",
    "Do not add borders, separators, gutters, dividers, panel lines, or framing that suggests multiple images.",
    "Return one complete image only, filling the requested aspect ratio with a single coherent scene.",
  ].join(" "),
  "2x2": [
    "Create a clean 2 by 2 image grid with exactly four distinct panels.",
    "Keep all four cells clearly visible inside one canvas, evenly aligned with consistent spacing.",
    "This should read as a deliberate multi-panel layout, not as a single scene.",
  ].join(" "),
  "2x3": [
    "Create a clean 2 by 3 image grid with exactly six distinct panels.",
    "Keep all six cells clearly visible inside one canvas, evenly aligned with consistent spacing.",
    "This should read as a deliberate multi-panel layout, not as a single scene.",
  ].join(" "),
  "3x3": [
    "Create a clean 3 by 3 image grid with exactly nine distinct panels.",
    "Keep all nine cells clearly visible inside one canvas, evenly aligned with consistent spacing.",
    "This should read as a deliberate multi-panel layout, not as a single scene.",
  ].join(" "),
  "4x4": [
    "Create a clean 4 by 4 image grid with exactly sixteen distinct panels.",
    "Keep all sixteen cells clearly visible inside one canvas, evenly aligned with consistent spacing.",
    "This should read as a deliberate multi-panel layout, not as a single scene.",
  ].join(" "),
  "3x4": [
    "Create a clean 3 by 4 image grid with exactly twelve distinct panels.",
    "Keep all twelve cells clearly visible inside one canvas, evenly aligned with consistent spacing.",
    "This should read as a deliberate multi-panel layout, not as a single scene.",
  ].join(" "),
});

export function buildGridPromptInstruction(gridMode = DEFAULT_GRID_MODE) {
  return GRID_INSTRUCTIONS[gridMode] || GRID_INSTRUCTIONS.none;
}

export function supportsGoogleSearchGrounding(modelId) {
  const id = String(modelId || "");
  return id === GOOGLE_IMAGE_MODELS.NANO_BANANA_2 || id === GOOGLE_IMAGE_MODELS.NANO_BANANA_PRO;
}