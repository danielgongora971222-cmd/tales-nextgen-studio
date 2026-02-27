import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "golden_hour",
  name: "Golden Hour",
  coverUrl: "/presets/lightroom/golden_hour/cover.jpg",
  prompt: `
LIGHTING ONLY: Warm golden-hour sun.
- Preserve the subject identity, pose, composition, and style EXACTLY.
- Do NOT change clothing, props, background layout, or add/remove objects.
- Change ONLY lighting/exposure: warm highlights, soft shadows, gentle glow.
- Color grade: warm temperature, slightly desaturated, natural film look.
Negative: face redesign, eye change, new objects, pose change, crop, zoom.
  `.trim(),
};

export default preset;
