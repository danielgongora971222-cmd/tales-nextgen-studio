import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "moody_low_key",
  name: "Moody Low-Key",
  coverUrl: "/presets/lightroom/moody_low_key/cover.jpg",
  prompt: `
LIGHTING ONLY: Low-key moody lighting.
- Preserve identity and composition EXACTLY.
- Deeper shadows, selective highlights, subtle film grain, rich blacks.
- Keep important details readable; avoid extreme darkness.
Negative: face redesign, scene change, crop/zoom.
  `.trim(),
};

export default preset;
