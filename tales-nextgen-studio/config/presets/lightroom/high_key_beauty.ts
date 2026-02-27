import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "high_key_beauty",
  name: "High-Key Beauty",
  coverUrl: "/presets/lightroom/high_key_beauty/cover.jpg",
  prompt: `
LIGHTING ONLY: High-key bright beauty lighting.
- Preserve identity and composition EXACTLY.
- Even illumination, soft shadows, clean whites; minimal contrast.
- Keep textures natural; no plastic HDR look.
Negative: face reshape, new props, background change.
  `.trim(),
};

export default preset;
