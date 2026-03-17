import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "felt_puppet",
  name: "Felt Puppet",
  kind: "restyle",
  coverUrl: "/presets/restyle/felt_puppet/cover.png",
  exampleUrls: [
    "/presets/restyle/felt_puppet/1.png",
    "/presets/restyle/felt_puppet/2.png",
    "/presets/restyle/felt_puppet/3.png",
    "/presets/restyle/felt_puppet/4.png",
  ],
  referenceGridUrl: "/presets/restyle/felt_puppet/reference_grid.jpg",
  prompt: `
STRUCTURAL FIDELITY LOCK:
Preserve the source image with absolute structural fidelity, including identical composition, framing, crop, perspective, camera angle, spatial relationships, scale, proportions, silhouette, pose, viewpoint, facial expression, and all original content. Do not add, remove, replace, distort, reinterpret, or rearrange any element. Translate only the visual surface, materials, finish, and rendering language into the requested style. Maintain identity, gesture, and scene construction with zero drift. The final output must be one single standalone image only. No duplicated subject, no alternate poses, no extra props, no added text unless it already exists in the source, no border, no collage sheet, no split panel, no contact sheet, no multi-frame layout.

Felt Puppet Stop-Motion Frame
Transform the reference into a handcrafted felt stop-motion universe. Reimagine all surfaces as cut felt sheets, stitched seams, fuzzy wool fibers, stuffed fabric volumes, embroidered accents, and tiny handmade props assembled like a premium animation puppet set. Skin and facial features should read as layered felt pieces with subtle needle marks, soft nap direction, and stitched detail rather than realism. Clothing should become textile shapes with visible thread, blanket-stitch borders, tiny puckers, and soft folds. Background elements should feel like miniature felt scenery placed on a tabletop stage. Add gentle stop-motion imperfection: slight asymmetry, tactile seams, visible craftsmanship, and believable miniature scale. Lighting should emphasize the softness of the fibers and the shadow between layered fabric pieces. The final result must feel charming, tactile, and cinematic, like a still frame from an elite handmade stop-motion short.

STYLE REFERENCE HANDLING:
A style reference image may be provided as a 2x2 grid or mosaic of example images.
Use that grid ONLY to infer style, lighting, rendering, materials, finish, and overall aesthetic direction.
Do NOT reproduce the grid, panel layout, collage composition, contact sheet structure, or multiple-image arrangement in the final result.
The final output must always be a single cohesive image unless the user's own prompt explicitly asks for a grid, collage, diptych, triptych, or multi-panel composition.
  `.trim(),
};

export default preset;
