import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "noir_studio",
  name: "Noir Studio",
  kind: "lightroom",
  coverUrl: "/presets/lightroom/noir_studio/cover.png",
  exampleUrls: [
    "/presets/lightroom/noir_studio/1.png",
    "/presets/lightroom/noir_studio/2.png",
    "/presets/lightroom/noir_studio/3.png",
    "/presets/lightroom/noir_studio/4.png",
  ],
  referenceGridUrl: "/presets/lightroom/noir_studio/reference_grid.jpg",
  prompt: `
PROMPT — LIGHTING EFFECT
PRESERVATION LOCK
The original image transformed into a classic film noir atmosphere. Same character and pose preserved. Same framing and composition.
LIGHTING STYLE
Hard black and white noir lighting style.
LIGHT SOURCES
Single hard key light from above-right casting sharp angular shadows across the face and body. Deep impenetrable blacks dominating the frame. Venetian blind shadow pattern falling across the scene. Strong side light cutting through darkness.
COLOR PALETTE
Dominant colors: near monochrome silver, deep charcoal blacks, cold steel gray highlights, faint warm amber on light source edge.
SURFACE RESPONSE
Natural skin texture sculpted by hard shadows, visible pores catching harsh highlight.
ATMOSPHERE
—
STYLE REFERENCE
Inspired by 1940s film noir cinematography — Double Indemnity and The Third Man.
TECHNICAL SPECS
No text, no watermark, no logo. Ultra sharp 8k resolution, extreme high contrast, crushed blacks. Deep depth of field
  `.trim(),
};

export default preset;
