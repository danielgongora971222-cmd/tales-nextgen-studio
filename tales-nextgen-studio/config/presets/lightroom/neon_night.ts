import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "neon_night",
  name: "Neon Night",
  coverUrl: "/presets/lightroom/neon_night/cover.jpg",
  prompt: `
LIGHTING ONLY: Night neon signage glow.
- Preserve identity and composition EXACTLY.
- Add colored neon bounce (magenta/cyan), reflective highlights, soft haze.
- Do NOT change scene layout; only lighting + grading.
Negative: new objects, face/eye change, pose change.
  `.trim(),
};

export default preset;
