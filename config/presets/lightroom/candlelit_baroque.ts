import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "candlelit_baroque",
  name: "CANDLELIT BAROQUE",
  kind: "lightroom",
  coverUrl: "/presets/lightroom/candlelit_baroque/cover.png",
  exampleUrls: [
    "/presets/lightroom/candlelit_baroque/1.png",
    "/presets/lightroom/candlelit_baroque/2.png",
    "/presets/lightroom/candlelit_baroque/3.png",
    "/presets/lightroom/candlelit_baroque/4.png",
  ],
  referenceGridUrl: "/presets/lightroom/candlelit_baroque/reference_grid.jpg",
  prompt: `
CANDLELIT BAROQUE GOLD

PROMPT — LIGHTING EFFECT
PRESERVATION LOCK
Keep the original image identical in character, pose, expression, framing, and scene content. Only relight and recolor the atmosphere.

LIGHTING STYLE
Baroque candlelit chiaroscuro with luxurious golden warmth and deep velvet shadow falloff.

LIGHT SOURCES
Primary illumination comes from a cluster of candle-like warm point sources below-left and slightly forward, producing rich upward gold light across the cheeks, lips, hands, and clothing textures. A very faint secondary bounce from nearby warm surfaces returns soft copper light into the shadows. The background falls into deep brown-black darkness with isolated pockets of warm illumination.

LUT / COLOR GRADING
Painterly tungsten-gold LUT with creamy amber mids, warm highlight bloom, soft shadow tonality, subtle red-brown density in the blacks, and elegant skin response.

COLOR PALETTE
Dominant colors: candle gold, antique amber, copper, burnt sienna, deep walnut brown, velvet black, faint rose warmth in skin mids.
Suggested palette accents: #F2B35E, #C88335, #8E4F2D, #4F2E22, #1E1512, #D9A27A

SURFACE RESPONSE
Skin should feel alive, luminous, tactile, and painterly. Fabrics pick up warm directional richness, especially velvet, silk, leather, or textured cotton. Shadows stay deep but not empty; they carry subtle warm density.

ATMOSPHERE
Very soft candle haze and delicate smoke diffusion near highlights. The air should feel intimate, old-world, sacred, and cinematic.

STYLE REFERENCE
Inspired by Caravaggio chiaroscuro, period dramas, and fine-art editorial portraiture.

TECHNICAL SPECS
No text, no watermark, no logo. 8k resolution, deep cinematic chiaroscuro, rich warm tonal separation, realistic texture preservation, luxurious highlight bloom.
  `.trim(),
};

export default preset;
