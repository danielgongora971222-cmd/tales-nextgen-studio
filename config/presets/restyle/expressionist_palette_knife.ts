import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "expressionist_palette_knife",
  name: "Expressionist Palette-Knife",
  kind: "restyle",
  coverUrl: "/presets/restyle/expressionist_palette_knife/cover.png",
  exampleUrls: [
    "/presets/restyle/expressionist_palette_knife/1.png",
    "/presets/restyle/expressionist_palette_knife/2.png",
    "/presets/restyle/expressionist_palette_knife/3.png",
    "/presets/restyle/expressionist_palette_knife/4.png",
  ],
  referenceGridUrl: "/presets/restyle/expressionist_palette_knife/reference_grid.jpg",
  prompt: `
STRUCTURAL FIDELITY LOCK:
Preserve the source image with absolute structural fidelity, including identical composition, framing, crop, perspective, camera angle, spatial relationships, scale, proportions, silhouette, pose, viewpoint, facial expression, and all original content. Do not add, remove, replace, distort, reinterpret, or rearrange any element. Translate only the visual surface, materials, finish, and rendering language into the requested style. Maintain identity, gesture, and scene construction with zero drift. The final output must be one single standalone image only. No duplicated subject, no alternate poses, no extra props, no added text unless it already exists in the source, no border, no collage sheet, no split panel, no contact sheet, no multi-frame layout.

Expressionist Palette-Knife Riot
Transform the image into an explosive expressionist painting built from aggressive palette-knife slabs, jagged pigment ridges, crushed color blocks, and emotionally charged brush violence. Use bold saturated color contrasts, thick scraped paint, accidental mixing, exposed underlayers, and rough impasto peaks that catch light across the surface. Replace precise detail with forceful paint architecture while keeping the original composition fully legible. Skin should be broken into expressive color planes; clothing should feel slashed and smeared into motion; the background should erupt into painterly tension rather than passive scenery. The entire piece should feel raw, contemporary, and gallery-scale—half emotional detonation, half high-end fine art object, with every surface visibly sculpted by the act of painting.

STYLE REFERENCE HANDLING:
A style reference image may be provided as a 2x2 grid or mosaic of example images.
Use that grid ONLY to infer style, lighting, rendering, materials, finish, and overall aesthetic direction.
Do NOT reproduce the grid, panel layout, collage composition, contact sheet structure, or multiple-image arrangement in the final result.
The final output must always be a single cohesive image unless the user's own prompt explicitly asks for a grid, collage, diptych, triptych, or multi-panel composition.
  `.trim(),
};

export default preset;
