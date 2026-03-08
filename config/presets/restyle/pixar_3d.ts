import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "pixar_3d",
  name: "3D Pixar-ish",
  kind: "restyle",
  coverUrl: "/presets/restyle/pixar_3d/cover.jpg",
  exampleUrls: [
    "/presets/restyle/pixar_3d/1.jpg",
    "/presets/restyle/pixar_3d/2.jpg",
    "/presets/restyle/pixar_3d/3.jpg",
    "/presets/restyle/pixar_3d/4.jpg",
  ],
  referenceGridUrl: "/presets/restyle/pixar_3d/reference_grid.jpg",
  prompt: `
STYLE: High-quality 3D animation look (family-friendly, stylized).

STYLE REFERENCE HANDLING:
A style reference image may be provided as a 2x2 grid or mosaic of example images.
Use that grid ONLY to infer stylization language, rendering approach, shaders, lighting softness, material finish, color harmony, and overall aesthetic direction.
Do NOT reproduce the grid, panel layout, collage composition, contact sheet structure, or multiple-image arrangement in the final result.
The final output must always be a single cohesive image unless the user's own prompt explicitly asks for a grid, collage, diptych, triptych, or multi-panel composition.

Materials: smooth but detailed shaders, soft bounce light, clean render.
Colors: vibrant but balanced, pleasing tones, gentle bloom.
Rules: no uncanny realism, keep shapes clean, avoid noise/artifacts.
  `.trim(),
};

export default preset;