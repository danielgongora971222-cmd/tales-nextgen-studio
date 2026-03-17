import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "crazy_pencil",
  name: "crazy pencil",
  kind: "restyle",
  coverUrl: "/presets/restyle/crazy_pencil/cover.png",
  exampleUrls: [
    "/presets/restyle/crazy_pencil/1.png",
    "/presets/restyle/crazy_pencil/2.png",
    "/presets/restyle/crazy_pencil/3.png",
    "/presets/restyle/crazy_pencil/4.png",
  ],
  referenceGridUrl: "/presets/restyle/crazy_pencil/reference_grid.jpg",
  prompt: `
Coretan Prompt
Redraw the provided image into a raw, chaotic ink poster style dominated by dense, curved black scribble strokes. Use the original only as a guide for proportions, silhouette, and overall structure. Rebuild forms, shadows, and depth using overlapping uneven lines, rough cross-hatching, and tangled strokes. Keep flat beige accents minimal and only where absolutely needed. No realism, no gradients, no smooth shading—only line work. Allow slight asymmetry and add irregular chaotic ink aura surrounding the subject. Use a solid flat orange background. High contrast. No 3D, no polish, no glossy effects—pure expressive ink energy

STYLE REFERENCE HANDLING:
A style reference image may be provided as a 2x2 grid or mosaic of example images.
Use that grid ONLY to infer style, lighting, rendering, materials, finish, and overall aesthetic direction.
Do NOT reproduce the grid, panel layout, collage composition, contact sheet structure, or multiple-image arrangement in the final result.
The final output must always be a single cohesive image unless the user's own prompt explicitly asks for a grid, collage, diptych, triptych, or multi-panel composition.
  `.trim(),
};

export default preset;
