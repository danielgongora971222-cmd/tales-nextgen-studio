import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "candlelight",
  name: "Candlelight",
  coverUrl: "/presets/lightroom/candlelight/cover.jpg",
  prompt: `
LIGHTING ONLY: Warm candlelight.
- Preserve identity and composition EXACTLY.
- Warm, localized highlights; soft falloff; gentle shadow movement feel.
- Avoid smoky noise; keep details clean.
Negative: redesign, new objects, crop/zoom.
  `.trim(),
};

export default preset;
