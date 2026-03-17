import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "cardboard",
  name: "cardboard",
  kind: "restyle",
  coverUrl: "/presets/restyle/cardboard/cover.png",
  exampleUrls: [
    "/presets/restyle/cardboard/1.png",
    "/presets/restyle/cardboard/2.png",
    "/presets/restyle/cardboard/3.png",
    "/presets/restyle/cardboard/4.png",
  ],
  referenceGridUrl: "/presets/restyle/cardboard/reference_grid.jpg",
  prompt: `
STRUCTURAL FIDELITY LOCK:
Preserve the source image with absolute structural fidelity, including identical composition, framing, crop, perspective, camera angle, spatial relationships, scale, proportions, silhouette, pose, viewpoint, facial expression, and all original content. Do not add, remove, replace, distort, reinterpret, or rearrange any element. Translate only the visual surface, materials, finish, and rendering language into the requested style. Maintain identity, gesture, and scene construction with zero drift. The final output must be one single standalone image only. No duplicated subject, no alternate poses, no extra props, no added text unless it already exists in the source, no border, no collage sheet, no split panel, no contact sheet, no multi-frame layout.

Corrugated Cardboard Relief Assemblage
Rebuild the image as a sculptural relief made entirely from corrugated cardboard, kraft paper, packaging scraps, peeled paper liners, and exposed ribbed flutes. Forms should be constructed from stacked cardboard planes, beveled cut edges, torn labels, glue residue, crease memory, and weathered shipping wear. Let the subject emerge through layers of brown craft tones, faded printed markings, raw cut channels, and exposed corrugation used to suggest contour, shadow, and depth. Preserve fine detail through changes in thickness, angle, and torn edge texture rather than realistic shading. Background elements should become flatter cardboard planes with occasional folds, punctures, and compression dents. The finished image should feel like an exquisite upcycled sculpture—brutalist, tactile, and unexpectedly luxurious—half installation art, half stop-motion set design.

STYLE REFERENCE HANDLING:
A style reference image may be provided as a 2x2 grid or mosaic of example images.
Use that grid ONLY to infer style, lighting, rendering, materials, finish, and overall aesthetic direction.
Do NOT reproduce the grid, panel layout, collage composition, contact sheet structure, or multiple-image arrangement in the final result.
The final output must always be a single cohesive image unless the user's own prompt explicitly asks for a grid, collage, diptych, triptych, or multi-panel composition.
  `.trim(),
};

export default preset;
