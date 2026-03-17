import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "acrylic_neo_expressionist",
  name: "Acrylic neo-expressionist",
  kind: "restyle",
  coverUrl: "/presets/restyle/acrylic_neo_expressionist/cover.png",
  exampleUrls: [
    "/presets/restyle/acrylic_neo_expressionist/1.png",
    "/presets/restyle/acrylic_neo_expressionist/2.png",
    "/presets/restyle/acrylic_neo_expressionist/3.png",
    "/presets/restyle/acrylic_neo_expressionist/4.png",
  ],
  referenceGridUrl: "/presets/restyle/acrylic_neo_expressionist/reference_grid.jpg",
  prompt: `
Transform the provided image into a bold neo-expressionist acrylic painting with thick brush energy, electric color blocking, raw texture, visible overpainting, semi-dry bristle marks, scraped passages, and emotionally charged surface rhythm. Preserve the exact source structure, but make every plane feel painted with conviction and intensity. The result should be vibrant, artistic, and gallery-scale—contemporary, fearless, and materially alive, with the confidence of a statement canvas rather than a decorative filter.

STYLE REFERENCE HANDLING:
A style reference image may be provided as a 2x2 grid or mosaic of example images.
Use that grid ONLY to infer style, lighting, rendering, materials, finish, and overall aesthetic direction.
Do NOT reproduce the grid, panel layout, collage composition, contact sheet structure, or multiple-image arrangement in the final result.
The final output must always be a single cohesive image unless the user's own prompt explicitly asks for a grid, collage, diptych, triptych, or multi-panel composition.
  `.trim(),
};

export default preset;
