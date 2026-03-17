import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "pop_editorial",
  name: "pop editorial",
  kind: "restyle",
  coverUrl: "/presets/restyle/pop_editorial/cover.png",
  exampleUrls: [
    "/presets/restyle/pop_editorial/1.png",
    "/presets/restyle/pop_editorial/2.png",
    "/presets/restyle/pop_editorial/3.png",
    "/presets/restyle/pop_editorial/4.png",
  ],
  referenceGridUrl: "/presets/restyle/pop_editorial/reference_grid.jpg",
  prompt: `
STRUCTURAL FIDELITY LOCK:
Preserve the source image with absolute structural fidelity, including identical composition, framing, crop, perspective, camera angle, spatial relationships, scale, proportions, silhouette, pose, viewpoint, facial expression, and all original content. Do not add, remove, replace, distort, reinterpret, or rearrange any element. Translate only the visual surface, materials, finish, and rendering language into the requested style. Maintain identity, gesture, and scene construction with zero drift. The final output must be one single standalone image only. No duplicated subject, no alternate poses, no extra props, no added text unless it already exists in the source, no border, no collage sheet, no split panel, no contact sheet, no multi-frame layout.

Acid Halftone Neo-Pop Editorial
Apply an ultra-bold neo-pop editorial print transformation driven by hard posterization, sharp contour separation, dense black anchors, and layered halftone screens. Use a high-voltage palette of acid yellow, hot magenta, electric cyan, scarlet, cobalt, and carbon black with deliberate screen-print channel tension, tiny registration shifts, ink overlaps, and selective overprint artifacts. Convert midtones into Ben-Day dot matrices, stippled fields, and mechanical silkscreen texture instead of photographic shading. Keep shadows as clean graphic masses and highlights as clipped punchy accents. Add subtle distressed poster wear, micro-speckled pigment noise, and fragments of abstract editorial geometry without disturbing the original composition. The image should feel iconic, commercial, collectible, and loud: a collision of gallery poster, fashion editorial, and retro comic cover, crisp, flat-yet-deep, and mechanically printed with luxurious control.

STYLE REFERENCE HANDLING:
A style reference image may be provided as a 2x2 grid or mosaic of example images.
Use that grid ONLY to infer style, lighting, rendering, materials, finish, and overall aesthetic direction.
Do NOT reproduce the grid, panel layout, collage composition, contact sheet structure, or multiple-image arrangement in the final result.
The final output must always be a single cohesive image unless the user's own prompt explicitly asks for a grid, collage, diptych, triptych, or multi-panel composition.
  `.trim(),
};

export default preset;
