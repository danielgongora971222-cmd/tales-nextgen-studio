import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "overcast_soft",
  name: "Overcast Soft",
  coverUrl: "/presets/lightroom/overcast_soft/cover.jpg",
  prompt: `
LIGHTING ONLY: Overcast daylight (soft, shadowless).
- Preserve the subject and scene EXACTLY.
- Soft diffuse light, low contrast, neutral tones; gentle lift in shadows.
Negative: redesign, new objects, crop, zoom.
  `.trim(),
};

export default preset;
