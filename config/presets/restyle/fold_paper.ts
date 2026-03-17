import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "fold_paper",
  name: "fold paper",
  kind: "restyle",
  coverUrl: "/presets/restyle/fold_paper/cover.png",
  exampleUrls: [
    "/presets/restyle/fold_paper/1.png",
    "/presets/restyle/fold_paper/2.png",
    "/presets/restyle/fold_paper/3.png",
    "/presets/restyle/fold_paper/4.png",
  ],
  referenceGridUrl: "/presets/restyle/fold_paper/reference_grid.jpg",
  prompt: `
Transform the reference photo into a 3D collage, as if made from cut-out paper pieces, assembled with slight imperfections.
Break the subject down into overlapping, angular paper fragments that form the silhouette and depth of the subject.
Each piece of the image should have visible, irregular edges, as if they were hand-cut from paper or fabric.
Skin and body features should be made up of overlapping geometric fragments, like torn or cut paper with intricate textures or patterns engraved on the surface.
Clothing and accessories should be re-imagined as multi-layered, textured paper strips or patches, with slight curves and folds.
The background should remain dark to emphasize the collage composition, with soft lighting casting subtle shadows between the paper fragments to emphasize depth.
Textures like paper wrinkles, folds, and shadows should be visible to enhance the handmade, crafted feel.
Ensure that each "paper" piece has a sense of individual texture and form, like hand-cut collage art, with varied

STYLE REFERENCE HANDLING:
A style reference image may be provided as a 2x2 grid or mosaic of example images.
Use that grid ONLY to infer style, lighting, rendering, materials, finish, and overall aesthetic direction.
Do NOT reproduce the grid, panel layout, collage composition, contact sheet structure, or multiple-image arrangement in the final result.
The final output must always be a single cohesive image unless the user's own prompt explicitly asks for a grid, collage, diptych, triptych, or multi-panel composition.
  `.trim(),
};

export default preset;
