import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "ink_cyclone",
  name: "Ink cyclone",
  kind: "restyle",
  coverUrl: "/presets/restyle/ink_cyclone/cover.png",
  exampleUrls: [
    "/presets/restyle/ink_cyclone/1.png",
    "/presets/restyle/ink_cyclone/2.png",
    "/presets/restyle/ink_cyclone/3.png",
    "/presets/restyle/ink_cyclone/4.png",
  ],
  referenceGridUrl: "/presets/restyle/ink_cyclone/reference_grid.jpg",
  prompt: `
STRUCTURAL FIDELITY LOCK:
Preserve the source image with absolute structural fidelity, including identical composition, framing, crop, perspective, camera angle, spatial relationships, scale, proportions, silhouette, pose, viewpoint, facial expression, and all original content. Do not add, remove, replace, distort, reinterpret, or rearrange any element. Translate only the visual surface, materials, finish, and rendering language into the requested style. Maintain identity, gesture, and scene construction with zero drift. The final output must be one single standalone image only. No duplicated subject, no alternate poses, no extra props, no added text unless it already exists in the source, no border, no collage sheet, no split panel, no contact sheet, no multi-frame layout.

STYLE REFERENCE HANDLING:
A style reference image may be provided as a 2x2 grid or mosaic of example images. Use that grid ONLY to infer style, lighting, rendering, materials, finish, and overall aesthetic direction. Do NOT reproduce the grid, panel layout, collage composition, contact sheet structure, or multiple-image arrangement in the final result. The final output must always be a single cohesive image unless the user's own prompt explicitly asks for a grid, collage, diptych, triptych, or multi-panel composition.

OPTIONAL DETAIL BOOST:
Emphasize extreme material fidelity, tactile micro-texture, visible handcrafted imperfections, realistic contact shadows between layers, crisp edge definition, subtle wear, dust, fibers, grain, surface relief, and premium consistency across the entire frame.

Chaotic Ink Cyclone
Redraw the entire provided image into a violent hand-inked poster aesthetic built from dense looping black pen strokes, feral cross-hatching, tangled contour nests, and rough pressure shifts that visibly intensify around edges, shadows, and facial planes. Reconstruct depth through layers of uneven ink marks rather than smooth shading. Convert skin, fabric, and background surfaces into expressive line density, scratchy feathering, and raw dry-ink abrasion. Allow imperfect symmetry, accidental overlaps, blunt stroke endings, and small pools of black where forms compress. Add a nervous halo of scattered scribbles around the silhouette and high-contrast shadow anchors. Keep color highly restrained: muted paper-like undertones with one or two flat accent hues only, never glossy, never polished. The result should feel like a rare underground poster drawn at manic speed on toothy stock, graphic, unstable, emotional, and beautifully uncontrolled.
  `.trim(),
};

export default preset;
