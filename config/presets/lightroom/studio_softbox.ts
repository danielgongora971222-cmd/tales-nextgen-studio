import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "studio_softbox",
  name: "Studio Softbox",
  coverUrl: "/presets/lightroom/studio_softbox/cover.jpg",
  prompt: `
LIGHTING ONLY: Clean studio softbox lighting.
- Preserve identity and composition EXACTLY.
- Smooth, flattering soft key + gentle fill; controlled specular highlights.
- Neutral color temp, minimal color shift, premium product-grade polish.
Negative: redesign, texture/style change, extra objects, crop.
  `.trim(),
};

export default preset;
