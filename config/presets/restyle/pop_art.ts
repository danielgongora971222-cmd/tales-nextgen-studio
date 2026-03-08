import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "pop_art",
  name: "PoP Art",
  kind: "restyle",
  coverUrl: "/presets/restyle/pop_art/cover.png",
  exampleUrls: [
    "/presets/restyle/pop_art/1.png",
    "/presets/restyle/pop_art/2.png",
    "/presets/restyle/pop_art/3.png",
    "/presets/restyle/pop_art/4.png",
  ],
  referenceGridUrl: "/presets/restyle/pop_art/reference_grid.jpg",
  prompt: `
Apply an ultra-faithful full-frame style transformation into a high-impact neo-pop-art / retro-comic editorial print aesthetic defined by extreme tonal posterization, aggressive dynamic range compression, hard-edged luminance segmentation, dense black anchoring, sharply vectorized contour hierarchies, and precision-controlled halftone screening; use a hyper-saturated print palette dominated by acid yellow, vivid cyan, electric blue, hot magenta, scarlet red, and deep carbon black, with intentional CMYK-style channel tension, subtle ink misregistration, selective color blocking, and screen-printed chromatic separation artifacts; integrate Ben-Day dot matrices, offset lithography grain, stippled shadow fields, micro-speckled pigment noise, xerographic texture, and layered silkscreen ink buildup with clean but forceful edge treatment, graphic shadow masses, crisply simplified midtones, and high-frequency surface detail converted into stylized print texture rather than photographic realism; incorporate abstract geometric overlays, paint splatter accents, distressed poster wear, fragmented collage energy, and polished urban-graphic finish, while maintaining an overall result that feels editorial, iconic, bold, crisp, high-contrast, and mechanically printed yet artistically refined; the final output must be one single standalone image only, never a grid, never a collage sheet, never a split-panel composition, never a multi-frame layout, never a contact sheet, and never multiple variations in one canvas unless explicitly requested, with no duplication or repetition of the composition anywhere in the frame; preserve the source image with absolute structural fidelity, including identical composition, framing, crop, perspective, spatial relationships, scale, proportions, silhouette, contours, alignment, pose, viewpoint, and all original content, with zero alteration to form, identity, expression, geometry, or scene construction, and do not add, remove, replace, distort, reinterpret, or rearrange any element—only translate the entire image surface into this exact visual language with maximum stylistic precision and consistency.

STYLE REFERENCE HANDLING:
A style reference image may be provided as a 2x2 grid or mosaic of example images.
Use that grid ONLY to infer style, lighting, rendering, materials, finish, and overall aesthetic direction.
Do NOT reproduce the grid, panel layout, collage composition, contact sheet structure, or multiple-image arrangement in the final result.
The final output must always be a single cohesive image unless the user's own prompt explicitly asks for a grid, collage, diptych, triptych, or multi-panel composition.
  `.trim(),
};

export default preset;
