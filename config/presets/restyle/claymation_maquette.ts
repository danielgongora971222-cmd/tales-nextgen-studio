import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "claymation_maquette",
  name: "Claymation Maquette",
  kind: "restyle",
  coverUrl: "/presets/restyle/claymation_maquette/cover.png",
  exampleUrls: [
    "/presets/restyle/claymation_maquette/1.png",
    "/presets/restyle/claymation_maquette/2.png",
    "/presets/restyle/claymation_maquette/3.png",
    "/presets/restyle/claymation_maquette/4.png",
  ],
  referenceGridUrl: "/presets/restyle/claymation_maquette/reference_grid.jpg",
  prompt: `
STRUCTURAL FIDELITY LOCK:
Preserve the source image with absolute structural fidelity, including identical composition, framing, crop, perspective, camera angle, spatial relationships, scale, proportions, silhouette, pose, viewpoint, facial expression, and all original content. Do not add, remove, replace, distort, reinterpret, or rearrange any element. Translate only the visual surface, materials, finish, and rendering language into the requested style. Maintain identity, gesture, and scene construction with zero drift. The final output must be one single standalone image only. No duplicated subject, no alternate poses, no extra props, no added text unless it already exists in the source, no border, no collage sheet, no split panel, no contact sheet, no multi-frame layout.

Claymation Maquette Deluxe
Redesign the entire image as premium claymation / stop-motion sculpture built from hand-modeled clay, plastiline, and miniature set craftsmanship. Surfaces must show real fingerprints, tool marks, thumb-pressed volume changes, soft dents, edge smears, and subtle color marbling inside the clay. Skin should read as sculpted clay planes with hand-shaped features; hair should become rolled, cut, or extruded clay strands; clothing should look like layered slabs of colored clay with folded edges, pressed seams, and tactile weight. Background elements should feel like miniature clay set pieces under studio lighting, with shallow shadows that reveal material thickness and hand-built construction. Keep the result richly dimensional, a little imperfect, and unmistakably physical—more artisan studio maquette than polished CGI. The image should feel like a collector-grade still from an award-winning stop-motion film.

STYLE REFERENCE HANDLING:
A style reference image may be provided as a 2x2 grid or mosaic of example images.
Use that grid ONLY to infer style, lighting, rendering, materials, finish, and overall aesthetic direction.
Do NOT reproduce the grid, panel layout, collage composition, contact sheet structure, or multiple-image arrangement in the final result.
The final output must always be a single cohesive image unless the user's own prompt explicitly asks for a grid, collage, diptych, triptych, or multi-panel composition.
  `.trim(),
};

export default preset;
