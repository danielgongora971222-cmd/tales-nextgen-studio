import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "baroque_impasto_oil_drama",
  name: "Baroque Impasto Oil Drama",
  kind: "restyle",
  coverUrl: "/presets/restyle/baroque_impasto_oil_drama/cover.png",
  exampleUrls: [
    "/presets/restyle/baroque_impasto_oil_drama/1.png",
    "/presets/restyle/baroque_impasto_oil_drama/2.png",
    "/presets/restyle/baroque_impasto_oil_drama/3.png",
    "/presets/restyle/baroque_impasto_oil_drama/4.png",
  ],
  referenceGridUrl: "/presets/restyle/baroque_impasto_oil_drama/reference_grid.jpg",
  prompt: `
STRUCTURAL FIDELITY LOCK:
Preserve the source image with absolute structural fidelity, including identical composition, framing, crop, perspective, camera angle, spatial relationships, scale, proportions, silhouette, pose, viewpoint, facial expression, and all original content. Do not add, remove, replace, distort, reinterpret, or rearrange any element. Translate only the visual surface, materials, finish, and rendering language into the requested style. Maintain identity, gesture, and scene construction with zero drift. The final output must be one single standalone image only. No duplicated subject, no alternate poses, no extra props, no added text unless it already exists in the source, no border, no collage sheet, no split panel, no contact sheet, no multi-frame layout.

Baroque Impasto Oil Drama
Translate the source into a dark, high-drama Baroque oil painting with thick impasto, luminous glazing, velvety shadows, and physically rich brushwork. Rebuild skin with loaded oil strokes, translucent glaze warmth, and tactile highlight ridges; render fabric with sumptuous directional brushwork, dense pigment, and deep shadow pooling; let the background fall into dramatic darkness or softened painterly atmosphere consistent with the original composition. Surfaces should show brush hairs, palette-knife interruptions, varnish depth, and subtle craquelure. Keep lighting theatrical and sculptural, emphasizing form emerging from shadow. The result must feel like an old-master canvas that still carries wet-paint energy—luxurious, moody, human, and materially alive.

STYLE REFERENCE HANDLING:
A style reference image may be provided as a 2x2 grid or mosaic of example images.
Use that grid ONLY to infer style, lighting, rendering, materials, finish, and overall aesthetic direction.
Do NOT reproduce the grid, panel layout, collage composition, contact sheet structure, or multiple-image arrangement in the final result.
The final output must always be a single cohesive image unless the user's own prompt explicitly asks for a grid, collage, diptych, triptych, or multi-panel composition.
  `.trim(),
};

export default preset;
