import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "grafito",
  name: "Grafito",
  kind: "restyle",
  coverUrl: "/presets/restyle/grafito/cover.png",
  exampleUrls: [
    "/presets/restyle/grafito/1.png",
    "/presets/restyle/grafito/2.png",
    "/presets/restyle/grafito/3.png",
    "/presets/restyle/grafito/4.png",
  ],
  referenceGridUrl: "/presets/restyle/grafito/reference_grid.jpg",
  prompt: `
STRUCTURAL FIDELITY LOCK:
Preserve the source image with absolute structural fidelity, including identical composition, framing, crop, perspective, camera angle, spatial relationships, scale, proportions, silhouette, pose, viewpoint, facial expression, and all original content. Do not add, remove, replace, distort, reinterpret, or rearrange any element. Translate only the visual surface, materials, finish, and rendering language into the requested style. Maintain identity, gesture, and scene construction with zero drift. The final output must be one single standalone image only. No duplicated subject, no alternate poses, no extra props, no added text unless it already exists in the source, no border, no collage sheet, no split panel, no contact sheet, no multi-frame layout.

Charcoal Dust Brutalism
Transform the image into a monumental charcoal-and-chalk drawing on rough cement-gray paper. Build the entire scene from soot-rich charcoal blocks, dusty smudges, broken vine-charcoal strokes, rubbed powder gradients, and brittle white chalk recoveries on edges and highlights. Let dark zones feel scraped, erased, and reworked by hand, with fingerprints, drag marks, kneaded-eraser lifts, and powder residue visible in the surface. Preserve depth using smoky tonal mass and aggressive edge loss, not polished blending. Clothing should feel fibrous and abraded; skin should read as carved from charcoal dust and paper tooth. Background elements should dissolve into smoky architecture and ghostly tonal planes. The overall result must feel raw, physical, studio-floor messy, dramatic, and museum-grade, like a massive preparatory drawing halfway between fine art and brutalist poster design.

STYLE REFERENCE HANDLING:
A style reference image may be provided as a 2x2 grid or mosaic of example images.
Use that grid ONLY to infer style, lighting, rendering, materials, finish, and overall aesthetic direction.
Do NOT reproduce the grid, panel layout, collage composition, contact sheet structure, or multiple-image arrangement in the final result.
The final output must always be a single cohesive image unless the user's own prompt explicitly asks for a grid, collage, diptych, triptych, or multi-panel composition.
  `.trim(),
};

export default preset;
