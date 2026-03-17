import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "noir_ilustrator",
  name: "Noir Ilustrator",
  kind: "restyle",
  coverUrl: "/presets/restyle/noir_ilustrator/cover.png",
  exampleUrls: [
    "/presets/restyle/noir_ilustrator/1.png",
    "/presets/restyle/noir_ilustrator/2.png",
    "/presets/restyle/noir_ilustrator/3.png",
    "/presets/restyle/noir_ilustrator/4.png",
  ],
  referenceGridUrl: "/presets/restyle/noir_ilustrator/reference_grid.jpg",
  prompt: `
STRUCTURAL FIDELITY LOCK:
Preserve the source image with absolute structural fidelity, including identical composition, framing, crop, perspective, camera angle, spatial relationships, scale, proportions, silhouette, pose, viewpoint, facial expression, and all original content. Do not add, remove, replace, distort, reinterpret, or rearrange any element. Translate only the visual surface, materials, finish, and rendering language into the requested style. Maintain identity, gesture, and scene construction with zero drift. The final output must be one single standalone image only. No duplicated subject, no alternate poses, no extra props, no added text unless it already exists in the source, no border, no collage sheet, no split panel, no contact sheet, no multi-frame layout.

Noir Graphic Novel Crosshatch
Redraw the image as a high-end black-heavy graphic novel panel using intense pen crosshatching, dry-brush blacks, razor-cut negative space, and moody noir lighting logic. Rebuild every surface through line direction, hatch density, nib pressure changes, and controlled pools of shadow, with only minimal restrained accent color if absolutely necessary. Skin should be shaped through elegant cross-contours, clothing through brush-blocked shadow masses, and the background through architectural ink atmosphere, smoke, rain-like texture, or broken shadow geometry. Keep the image cinematic and dramatic, but never glossy. Let some edges disappear into black and others snap with surgical precision. The whole piece should feel like a prestige collector’s edition comic page: serious, atmospheric, tactile, beautifully drafted, and brutally high contrast.

STYLE REFERENCE HANDLING:
A style reference image may be provided as a 2x2 grid or mosaic of example images.
Use that grid ONLY to infer style, lighting, rendering, materials, finish, and overall aesthetic direction.
Do NOT reproduce the grid, panel layout, collage composition, contact sheet structure, or multiple-image arrangement in the final result.
The final output must always be a single cohesive image unless the user's own prompt explicitly asks for a grid, collage, diptych, triptych, or multi-panel composition.
  `.trim(),
};

export default preset;
