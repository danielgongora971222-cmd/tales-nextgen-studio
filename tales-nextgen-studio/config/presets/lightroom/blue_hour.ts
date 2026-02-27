import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "blue_hour",
  name: "Blue Hour",
  coverUrl: "/presets/lightroom/blue_hour/cover.jpg",
  prompt: `
LIGHTING ONLY: Cool blue-hour ambient light.
- Preserve the scene and subject EXACTLY; no design/style changes.
- Change ONLY lighting: cool shadows, subtle cyan/blue cast, soft contrast.
- Keep readability; avoid underexposure and heavy noise.
Negative: face change, new props, background swap, crop/zoom.
  `.trim(),
};

export default preset;
