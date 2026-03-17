import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "bronze_monument",
  name: "Bronze Monument",
  kind: "restyle",
  coverUrl: "/presets/restyle/bronze_monument/cover.png",
  exampleUrls: [
    "/presets/restyle/bronze_monument/1.png",
    "/presets/restyle/bronze_monument/2.png",
    "/presets/restyle/bronze_monument/3.png",
    "/presets/restyle/bronze_monument/4.png",
  ],
  referenceGridUrl: "/presets/restyle/bronze_monument/reference_grid.jpg",
  prompt: `
STRUCTURAL FIDELITY LOCK:
Preserve the source image with absolute structural fidelity, including identical composition, framing, crop, perspective, camera angle, spatial relationships, scale, proportions, silhouette, pose, viewpoint, facial expression, and all original content. Do not add, remove, replace, distort, reinterpret, or rearrange any element. Translate only the visual surface, materials, finish, and rendering language into the requested style. Maintain identity, gesture, and scene construction with zero drift. The final output must be one single standalone image only. No duplicated subject, no alternate poses, no extra props, no added text unless it already exists in the source, no border, no collage sheet, no split panel, no contact sheet, no multi-frame layout.

Oxidized Bronze Monument Relief
Reimagine the source as a cast bronze relief with rich patina, aged oxidation, dark recessed shadows, and polished highlight edges from touch and time. Translate the image into sculpted metal planes with believable casting thickness, subtle mold lines, hammered finishing, and soft metal transitions. Allow turquoise and deep verdigris oxidation to gather in crevices while burnished bronze catches light on raised planes. Clothing folds, hair, and background elements should feel simplified into strong sculptural rhythms suitable for monumental casting. Fine textures should emerge through chased surface detail, engraved line accents, and worn metal granularity, not photographic rendering. The scene should feel authoritative, ceremonial, and tactile—like a museum plaque, public monument panel, or heroic commemorative relief with real weight and age.

STYLE REFERENCE HANDLING:
A style reference image may be provided as a 2x2 grid or mosaic of example images.
Use that grid ONLY to infer style, lighting, rendering, materials, finish, and overall aesthetic direction.
Do NOT reproduce the grid, panel layout, collage composition, contact sheet structure, or multiple-image arrangement in the final result.
The final output must always be a single cohesive image unless the user's own prompt explicitly asks for a grid, collage, diptych, triptych, or multi-panel composition.
  `.trim(),
};

export default preset;
