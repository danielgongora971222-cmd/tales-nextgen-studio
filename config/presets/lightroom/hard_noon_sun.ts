import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "hard_noon_sun",
  name: "Hard Noon Sun",
  coverUrl: "/presets/lightroom/hard_noon_sun/cover.jpg",
  prompt: `
LIGHTING ONLY: Hard midday sun.
- Preserve identity and composition EXACTLY.
- Strong directional light, crisp shadows, higher contrast; natural colors.
- Avoid overexposure; keep skin and highlights controlled.
Negative: face change, new props, camera change.
  `.trim(),
};

export default preset;
