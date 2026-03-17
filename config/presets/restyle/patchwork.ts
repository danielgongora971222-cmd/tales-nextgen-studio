import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "patchwork",
  name: "Patchwork",
  kind: "restyle",
  coverUrl: "/presets/restyle/patchwork/cover.png",
  exampleUrls: [
    "/presets/restyle/patchwork/1.png",
    "/presets/restyle/patchwork/2.png",
    "/presets/restyle/patchwork/3.png",
    "/presets/restyle/patchwork/4.png",
  ],
  referenceGridUrl: "/presets/restyle/patchwork/reference_grid.jpg",
  prompt: `
STRUCTURAL FIDELITY LOCK:
Preserve the source image with absolute structural fidelity, including identical composition, framing, crop, perspective, camera angle, spatial relationships, scale, proportions, silhouette, pose, viewpoint, facial expression, and all original content. Do not add, remove, replace, distort, reinterpret, or rearrange any element. Translate only the visual surface, materials, finish, and rendering language into the requested style. Maintain identity, gesture, and scene construction with zero drift. The final output must be one single standalone image only. No duplicated subject, no alternate poses, no extra props, no added text unless it already exists in the source, no border, no collage sheet, no split panel, no contact sheet, no multi-frame layout.

Patchwork Textile Appliqué
Transform the image into an intricate textile composition built from layered fabric appliqué, quilting seams, embroidery, and stitched surface design. Translate each region into distinct cloth behavior: raw linen, velvet, denim, satin, burlap, canvas, tapestry weave, lace, or faded cotton, each used intentionally for form, tone, and contrast. Build depth through padding, stitch lines, folded hems, puckered fabric tension, quilted stuffing, and overlapping patches rather than painterly shading. Skin should become nuanced fabric layering with embroidered contour guidance and soft tonal fabric transitions. Clothing should showcase textile realism through weave direction, seam logic, and edge finishing. Backgrounds should feel like larger fabric fields with quilting channels, decorative thread, and subtle stitched ornament. The whole piece should feel like couture-meets-folk-art wall tapestry: handmade, rich, tactile, and museum-worthy.

STYLE REFERENCE HANDLING:
A style reference image may be provided as a 2x2 grid or mosaic of example images.
Use that grid ONLY to infer style, lighting, rendering, materials, finish, and overall aesthetic direction.
Do NOT reproduce the grid, panel layout, collage composition, contact sheet structure, or multiple-image arrangement in the final result.
The final output must always be a single cohesive image unless the user's own prompt explicitly asks for a grid, collage, diptych, triptych, or multi-panel composition.
  `.trim(),
};

export default preset;
