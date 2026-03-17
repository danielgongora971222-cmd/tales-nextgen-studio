import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "gouache_poster",
  name: "Gouache Poster",
  kind: "restyle",
  coverUrl: "/presets/restyle/gouache_poster/cover.png",
  exampleUrls: [
    "/presets/restyle/gouache_poster/1.png",
    "/presets/restyle/gouache_poster/2.png",
    "/presets/restyle/gouache_poster/3.png",
    "/presets/restyle/gouache_poster/4.png",
  ],
  referenceGridUrl: "/presets/restyle/gouache_poster/reference_grid.jpg",
  prompt: `
STRUCTURAL FIDELITY LOCK:
Preserve the source image with absolute structural fidelity, including identical composition, framing, crop, perspective, camera angle, spatial relationships, scale, proportions, silhouette, pose, viewpoint, facial expression, and all original content. Do not add, remove, replace, distort, reinterpret, or rearrange any element. Translate only the visual surface, materials, finish, and rendering language into the requested style. Maintain identity, gesture, and scene construction with zero drift. The final output must be one single standalone image only. No duplicated subject, no alternate poses, no extra props, no added text unless it already exists in the source, no border, no collage sheet, no split panel, no contact sheet, no multi-frame layout.

Gouache Poster Folk Modernism
Transform the image into a flattened yet sophisticated gouache poster painting with opaque matte color, crisp shape logic, hand-painted edges, and decorative modernist simplification. Use bold but disciplined color blocking, visible brush drag at the edges, slightly uneven paint coverage, and layered matte surfaces that feel handcrafted rather than digital. Simplify fine detail into elegant planes, patterned accents, and controlled contour shapes while preserving the exact scene. Clothing and background should feature subtle ornamental rhythms, folk-inspired motifs, or graphic geometry integrated into the original forms. The final image should feel like a rare mid-century poster crossed with contemporary illustration—clean, artful, stylish, and timeless.

STYLE REFERENCE HANDLING:
A style reference image may be provided as a 2x2 grid or mosaic of example images.
Use that grid ONLY to infer style, lighting, rendering, materials, finish, and overall aesthetic direction.
Do NOT reproduce the grid, panel layout, collage composition, contact sheet structure, or multiple-image arrangement in the final result.
The final output must always be a single cohesive image unless the user's own prompt explicitly asks for a grid, collage, diptych, triptych, or multi-panel composition.
  `.trim(),
};

export default preset;
