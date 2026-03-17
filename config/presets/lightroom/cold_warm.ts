import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "cold_warm",
  name: "Cold Warm",
  kind: "lightroom",
  coverUrl: "/presets/lightroom/cold_warm/cover.png",
  exampleUrls: [
    "/presets/lightroom/cold_warm/1.png",
    "/presets/lightroom/cold_warm/2.png",
    "/presets/lightroom/cold_warm/3.png",
    "/presets/lightroom/cold_warm/4.png",
  ],
  referenceGridUrl: "/presets/lightroom/cold_warm/reference_grid.jpg",
  prompt: `
PROMPT — LIGHTING EFFECT
PRESERVATION LOCK
The original image relit with two opposing colored directional lights while preserving the existing environment. Same character and pose preserved. Same background scene completely intact.
LIGHTING STYLE
Cinematic split color gel lighting style.
LIGHT SOURCES
Strong warm amber-orange directional light hitting the subject from the left side with visible hard rays and defined light direction, opposing cool electric blue directional light hitting from the right side. The two colors meet and blend on the center of the subject creating a subtle neutral transition zone. Each colored light casts its own tinted shadow on the opposite side. Existing environment absorbs and reflects both color temperatures naturally.
COLOR PALETTE
Dominant colors: rich warm amber-orange on left side, deep electric blue on right side, neutral skin tone where both merge at center, shadows carrying mixed violet-purple undertones where both colors overlap, original background tinted by color spill.
SURFACE RESPONSE
Natural skin texture reacting differently to each colored light — warm side showing golden pore highlights, cool side showing blue-silver texture detail.
ATMOSPHERE
Faint atmospheric particles catching both colors in the air, original environment visible with dual color spill.
STYLE REFERENCE
Inspired by Nicolas Winding Refn neon cinematography and modern music video color design.
TECHNICAL SPECS
No text, no watermark, no logo. Vivid 8k resolution, punchy contrast between warm and cool sides, rich chromatic separation. Medium depth of field.
  `.trim(),
};

export default preset;
