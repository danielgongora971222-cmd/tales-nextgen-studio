import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "rugged_paper",
  name: "Rugged paper",
  kind: "restyle",
  coverUrl: "/presets/restyle/rugged_paper/cover.png",
  exampleUrls: [
    "/presets/restyle/rugged_paper/1.png",
    "/presets/restyle/rugged_paper/2.png",
    "/presets/restyle/rugged_paper/3.png",
    "/presets/restyle/rugged_paper/4.png",
  ],
  referenceGridUrl: "/presets/restyle/rugged_paper/reference_grid.jpg",
  prompt: `
STRUCTURAL FIDELITY LOCK:
Preserve the source image with absolute structural fidelity, including identical composition, framing, crop, perspective, camera angle, spatial relationships, scale, proportions, silhouette, pose, viewpoint, facial expression, and all original content. Do not add, remove, replace, distort, reinterpret, or rearrange any element. Translate only the visual surface, materials, finish, and rendering language into the requested style. Maintain identity, gesture, and scene construction with zero drift. The final output must be one single standalone image only. No duplicated subject, no alternate poses, no extra props, no added text unless it already exists in the source, no border, no collage sheet, no split panel, no contact sheet, no multi-frame layout.

Torn Paper Prism Collage
Transform the entire image into a meticulously handmade cut-paper collage assembled from overlapping torn and hand-cut fragments. Break forms into layered paper shards with irregular deckled edges, soft lift-off shadows, visible paper fibers, and subtle curling corners. Use carefully controlled color grouping so skin, fabric, hair, and background are reconstructed from stacked matte papers, printed scraps, and textured stock with slightly different surface grains. Replace smooth gradients with stepped paper layers, tonal cutouts, and thin interlocking fragments that create depth by physical stacking rather than rendering. Allow small imperfections in alignment, hand-cut asymmetry, and tactile spacing between layers. The result should feel artisanal, dimensional, and gallery-worthy, like a labor-intensive analog collage photographed under soft studio light, where every piece has its own thickness, texture, and handcrafted logic.

STYLE REFERENCE HANDLING:
A style reference image may be provided as a 2x2 grid or mosaic of example images.
Use that grid ONLY to infer style, lighting, rendering, materials, finish, and overall aesthetic direction.
Do NOT reproduce the grid, panel layout, collage composition, contact sheet structure, or multiple-image arrangement in the final result.
The final output must always be a single cohesive image unless the user's own prompt explicitly asks for a grid, collage, diptych, triptych, or multi-panel composition.
  `.trim(),
};

export default preset;
