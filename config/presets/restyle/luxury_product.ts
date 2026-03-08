import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "luxury_product",
  name: "Luxury Product",
  kind: "restyle",
  coverUrl: "/presets/restyle/luxury_product/cover.jpg",
  exampleUrls: [
    "/presets/restyle/luxury_product/1.jpg",
    "/presets/restyle/luxury_product/2.jpg",
    "/presets/restyle/luxury_product/3.jpg",
    "/presets/restyle/luxury_product/4.jpg",
  ],
  referenceGridUrl: "/presets/restyle/luxury_product/reference_grid.jpg",
  prompt: `
STYLE: Luxury product advertising. Clean studio, premium reflections.

STYLE REFERENCE HANDLING:
A style reference image may be provided as a 2x2 grid or mosaic of example images.
Use that grid ONLY to infer product photography finish, lighting behavior, reflections, material treatment, premium commercial polish, and aesthetic direction.
Do NOT reproduce the grid, panel layout, collage composition, contact sheet structure, or multiple-image arrangement in the final result.
The final output must always be a single cohesive image unless the user's own prompt explicitly asks for a grid, collage, diptych, triptych, or multi-panel composition.

Lighting: controlled specular highlights, soft gradients, no harsh glare.
Composition: centered hero shot, elegant negative space, minimal clutter.
Quality: extremely sharp, high contrast micro-detail, commercial polish.
  `.trim(),
};

export default preset;