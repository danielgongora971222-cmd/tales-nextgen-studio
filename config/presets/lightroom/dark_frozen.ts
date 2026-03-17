import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "dark_frozen",
  name: "Dark Frozen",
  kind: "lightroom",
  coverUrl: "/presets/lightroom/dark_frozen/cover.png",
  exampleUrls: [
    "/presets/lightroom/dark_frozen/1.png",
    "/presets/lightroom/dark_frozen/2.png",
    "/presets/lightroom/dark_frozen/3.png",
    "/presets/lightroom/dark_frozen/4.png",
  ],
  referenceGridUrl: "/presets/lightroom/dark_frozen/reference_grid.jpg",
  prompt: `
PROMPT — LIGHTING EFFECT
PRESERVATION LOCK
The original image transformed into a cold moonlit night scene. Same character and pose preserved. Same framing and composition.
LIGHTING STYLE
Ethereal silver moonlight lighting style.
LIGHT SOURCES
Single soft overhead moonlight casting delicate cool silver illumination from above. Gentle blue-silver shadows with soft edges. Faint luminous glow on skin highlights. Ambient darkness surrounding the subject with the moon as sole light source.
COLOR PALETTE
Dominant colors: cold silver white, deep midnight blue, pale ice blue on highlights, dark navy in shadows, subtle lavender undertones on skin.
SURFACE RESPONSE
Natural skin texture bathed in silver light, visible pores catching faint moonlight.
ATMOSPHERE
Subtle ground mist diffusing at lower frame, breath vapor visible in cold air.
STYLE REFERENCE
Inspired by moonlit scenes from The Revenant and Moonlight (film cinematography).
TECHNICAL SPECS
No text, no watermark, no logo. Crisp 8k resolution, delicate high dynamic range, controlled cool contrast. Medium depth of field.
  `.trim(),
};

export default preset;
