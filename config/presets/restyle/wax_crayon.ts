import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "wax_crayon",
  name: "Wax Crayon",
  kind: "restyle",
  coverUrl: "/presets/restyle/wax_crayon/cover.png",
  exampleUrls: [
    "/presets/restyle/wax_crayon/1.png",
    "/presets/restyle/wax_crayon/2.png",
    "/presets/restyle/wax_crayon/3.png",
    "/presets/restyle/wax_crayon/4.png",
  ],
  referenceGridUrl: "/presets/restyle/wax_crayon/reference_grid.jpg",
  prompt: `
STRUCTURAL FIDELITY LOCK:
Preserve the source image with absolute structural fidelity, including identical composition, framing, crop, perspective, camera angle, spatial relationships, scale, proportions, silhouette, pose, viewpoint, facial expression, and all original content. Do not add, remove, replace, distort, reinterpret, or rearrange any element. Translate only the visual surface, materials, finish, and rendering language into the requested style. Maintain identity, gesture, and scene construction with zero drift. The final output must be one single standalone image only. No duplicated subject, no alternate poses, no extra props, no added text unless it already exists in the source, no border, no collage sheet, no split panel, no contact sheet, no multi-frame layout.

Wax Crayon + Oil Pastel Distortion
Redraw the image as a premium wax-crayon and oil-pastel artwork with dense pigment drag, wax bloom, gritty paper tooth, and thick hand-drawn contour pressure. Translate surfaces into layered crayon fills, broken color rubs, buttery pastel blocks, scribbled tone building, and deliberate pressure variation. Let edges feel hand-worked, sometimes rough and vibrating, sometimes boldly outlined. Skin and fabric should be simplified into rich waxy color regions with visible layering and scumbled buildup. Background areas should become broad rubbed fields, gestural marks, and soft wax haze. Preserve the source faithfully, but let the medium stay unapologetically tactile and analog. The result should feel playful yet masterful—like a collector’s illustration where childlike directness meets elite compositional control.

STYLE REFERENCE HANDLING:
A style reference image may be provided as a 2x2 grid or mosaic of example images.
Use that grid ONLY to infer style, lighting, rendering, materials, finish, and overall aesthetic direction.
Do NOT reproduce the grid, panel layout, collage composition, contact sheet structure, or multiple-image arrangement in the final result.
The final output must always be a single cohesive image unless the user's own prompt explicitly asks for a grid, collage, diptych, triptych, or multi-panel composition.
  `.trim(),
};

export default preset;
