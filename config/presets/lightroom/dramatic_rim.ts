import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "dramatic_rim",
  name: "Dramatic Rim Light",
  coverUrl: "/presets/lightroom/dramatic_rim/cover.jpg",
  prompt: `
LIGHTING ONLY: Strong rim/back light with cinematic separation.
- Preserve subject and environment EXACTLY.
- Add rim highlight on edges; keep face lighting natural (no harsh relight).
- Increase depth with controlled shadows; avoid crushed blacks.
Negative: face/eye changes, new objects, pose/camera changes.
  `.trim(),
};

export default preset;
