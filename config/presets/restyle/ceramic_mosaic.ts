import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "ceramic_mosaic",
  name: "Ceramic Mosaic",
  kind: "restyle",
  coverUrl: "/presets/restyle/ceramic_mosaic/cover.png",
  exampleUrls: [
    "/presets/restyle/ceramic_mosaic/1.png",
    "/presets/restyle/ceramic_mosaic/2.png",
    "/presets/restyle/ceramic_mosaic/3.png",
    "/presets/restyle/ceramic_mosaic/4.png",
  ],
  referenceGridUrl: "/presets/restyle/ceramic_mosaic/reference_grid.jpg",
  prompt: `
STRUCTURAL FIDELITY LOCK:
Preserve the source image with absolute structural fidelity, including identical composition, framing, crop, perspective, camera angle, spatial relationships, scale, proportions, silhouette, pose, viewpoint, facial expression, and all original content. Do not add, remove, replace, distort, reinterpret, or rearrange any element. Translate only the visual surface, materials, finish, and rendering language into the requested style. Maintain identity, gesture, and scene construction with zero drift. The final output must be one single standalone image only. No duplicated subject, no alternate poses, no extra props, no added text unless it already exists in the source, no border, no collage sheet, no split panel, no contact sheet, no multi-frame layout.

Glazed Ceramic Mosaic Relief
Rebuild the source image as a dimensional ceramic mosaic made from hand-cut glazed tiles, cracked enamel pieces, matte stoneware inserts, and raised ceramic fragments. Use irregular tesserae shapes, slight height variation, grout lines, glaze pooling, kiln imperfections, pinholes, and subtle crackle finishes to construct the entire scene. Skin, clothing, and background should be translated into carefully planned tile color clusters with real surface reflectivity and hand-placed spacing. Allow some tiles to be glossy and deep while others are dry, matte, or slightly rough, creating a rich interplay of ceramic behaviors. Highlights should come from glaze sheen and tile angle rather than painted light. The result should feel handcrafted, precious, and architectural—somewhere between sacred mosaic, ceramic mural, and collectible object.

STYLE REFERENCE HANDLING:
A style reference image may be provided as a 2x2 grid or mosaic of example images.
Use that grid ONLY to infer style, lighting, rendering, materials, finish, and overall aesthetic direction.
Do NOT reproduce the grid, panel layout, collage composition, contact sheet structure, or multiple-image arrangement in the final result.
The final output must always be a single cohesive image unless the user's own prompt explicitly asks for a grid, collage, diptych, triptych, or multi-panel composition.
  `.trim(),
};

export default preset;
