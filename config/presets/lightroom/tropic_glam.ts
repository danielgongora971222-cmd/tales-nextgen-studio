import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "tropic_glam",
  name: "TROPIC GLAM",
  kind: "lightroom",
  coverUrl: "/presets/lightroom/tropic_glam/cover.png",
  exampleUrls: [
    "/presets/lightroom/tropic_glam/1.png",
    "/presets/lightroom/tropic_glam/2.png",
    "/presets/lightroom/tropic_glam/3.png",
    "/presets/lightroom/tropic_glam/4.png",
  ],
  referenceGridUrl: "/presets/lightroom/tropic_glam/reference_grid.jpg",
  prompt: `
Apply premium analog image science, soft halation around practical highlights, authentic film grain, subtle gate-weave stability, slight lens breathing, gentle chromatic aberration, faded print warmth, tactile atmospheric diffusion, and a cohesive vintage-fashion finish that feels photographed on real film rather than digitally overprocessed.

PROMPT — LIGHTING EFFECT
PRESERVATION LOCK
Preserve the exact subject, expression, pose, framing, and original environment. Only reimagine the lighting and color atmosphere.

LIGHTING STYLE
High-saturation vintage fashion print lighting with glossy tropical heat and vivid chromatic luxury.

LIGHT SOURCES
A blazing warm coral-orange key from frame-left lights the skin with bold sun-kissed intensity. A vivid aqua fill from below-right adds glossy contrast and luxurious print-era stylization. A hot pink edge glow from behind injects lush fashion energy into the silhouette.

LUT / COLOR GRADING
Cibachrome-inspired print grading with extremely rich chroma, dense reds, polished cyans, crisp highlight brilliance, and deep but colorful shadows. The grade should feel like a premium analog fashion print, not cheap digital oversaturation.

FILM / TEXTURE TREATMENT
Fine chromogenic grain, glossy print sheen, warm highlight bloom, subtle color density in saturated areas, and controlled analog sharpness.

COLOR PALETTE
Dominant colors: coral orange, tropical pink, aqua blue, sunlit gold, hot magenta, dense marine teal.
Suggested palette accents: #F76C4B, #F53E92, #4DD6D8, #F3C56A, #116C70, #FFD8C7

SURFACE RESPONSE
Skin should glow in a glamorous, sun-charged way while remaining detailed and believable. Reflective surfaces become vivid and lush; matte materials absorb color elegantly.

ATMOSPHERE
A warm humid haze makes the colors feel thick, sensual, and expensive. The frame should feel like heat, perfume, fashion, and excess.

STYLE REFERENCE
Inspired by 80s color-rich fashion print photography, luxury resort editorials, and ultra-saturated analog publishing aesthetics.

TECHNICAL SPECS
No text, no watermark, no logo. 8k, vivid print-style color density, premium tropical saturation, elegant grain, glossy editorial contrast.
  `.trim(),
};

export default preset;
