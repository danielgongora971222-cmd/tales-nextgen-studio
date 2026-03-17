import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "cracked_fresco",
  name: "Cracked Fresco",
  kind: "restyle",
  coverUrl: "/presets/restyle/cracked_fresco/cover.png",
  exampleUrls: [
    "/presets/restyle/cracked_fresco/1.png",
    "/presets/restyle/cracked_fresco/2.png",
    "/presets/restyle/cracked_fresco/3.png",
    "/presets/restyle/cracked_fresco/4.png",
  ],
  referenceGridUrl: "/presets/restyle/cracked_fresco/reference_grid.jpg",
  prompt: `
STRUCTURAL FIDELITY LOCK:
Preserve the source image with absolute structural fidelity, including identical composition, framing, crop, perspective, camera angle, spatial relationships, scale, proportions, silhouette, pose, viewpoint, facial expression, and all original content. Do not add, remove, replace, distort, reinterpret, or rearrange any element. Translate only the visual surface, materials, finish, and rendering language into the requested style. Maintain identity, gesture, and scene construction with zero drift. The final output must be one single standalone image only. No duplicated subject, no alternate poses, no extra props, no added text unless it already exists in the source, no border, no collage sheet, no split panel, no contact sheet, no multi-frame layout.

Cracked Fresco Wall Fragment
Transform the entire image into an ancient wall fresco painted on lime plaster, aged by centuries of cracking, flaking pigment, exposed underlayers, and weather-worn surface erosion. Use muted mineral pigments, chalky matte color, hand-brushed edges, uneven plaster absorption, and faded tonal transitions consistent with real fresco technique. Let the image breathe through missing pigment islands, hairline craquelure, plaster pitting, abrasion marks, and slightly ghosted contours where paint has worn away. Skin and fabric should feel softly painted into plaster, while the background becomes architectural wall fields, stained lime areas, and subtle restoration scars. The result should feel sacred, timeworn, fragile, and historically rich, like a rediscovered mural fragment preserved from a ruined chapel or palace wall.

STYLE REFERENCE HANDLING:
A style reference image may be provided as a 2x2 grid or mosaic of example images.
Use that grid ONLY to infer style, lighting, rendering, materials, finish, and overall aesthetic direction.
Do NOT reproduce the grid, panel layout, collage composition, contact sheet structure, or multiple-image arrangement in the final result.
The final output must always be a single cohesive image unless the user's own prompt explicitly asks for a grid, collage, diptych, triptych, or multi-panel composition.
  `.trim(),
};

export default preset;
