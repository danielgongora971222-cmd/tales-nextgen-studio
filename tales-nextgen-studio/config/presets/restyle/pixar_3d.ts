import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "pixar_3d",
  name: "3D Pixar-ish",
  coverUrl: "/presets/restyle/pixar_3d/cover.jpg",
  exampleUrls: [
    "/presets/restyle/pixar_3d/1.jpg",
    "/presets/restyle/pixar_3d/2.jpg",
    "/presets/restyle/pixar_3d/3.jpg",
    "/presets/restyle/pixar_3d/4.jpg",
  ],
  prompt: `
STYLE: High-quality 3D animation look (family-friendly, stylized).
Materials: smooth but detailed shaders, soft bounce light, clean render.
Colors: vibrant but balanced, pleasing tones, gentle bloom.
Rules: no uncanny realism, keep shapes clean, avoid noise/artifacts.
  `.trim(),
};

export default preset;
