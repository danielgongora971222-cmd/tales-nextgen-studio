import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "live_action",
  name: "Live Action",
  kind: "restyle",
  coverUrl: "/presets/restyle/live_action/cover.png",
  exampleUrls: [
    "/presets/restyle/live_action/1.png",
    "/presets/restyle/live_action/2.jpeg",
    "/presets/restyle/live_action/3.png",
    "/presets/restyle/live_action/4.jpeg",
  ],
  referenceGridUrl: "/presets/restyle/live_action/reference_grid.jpg",
  prompt: `
STYLE: Apply photorealistic materials and cinematic lighting to the provided image using TEXTURE AND MATERIAL
TRANSLATION ONLY.

STYLE REFERENCE HANDLING:
A style reference image may be provided as a 2x2 grid or mosaic of example images.
Use that grid ONLY to infer materials, rendering language, lighting logic, surface treatment, and overall aesthetic direction.
Do NOT reproduce the grid, panel layout, collage composition, contact sheet look, split frames, or multiple-image arrangement in the final result.
The final output must always be a single cohesive image unless the user's own prompt explicitly asks for a grid, collage, diptych, triptych, or multi-panel composition.

ABSOLUTE PRESERVATION RULE:
Preserve the original image EXACTLY as-is in design and identity. This is a material/lighting pass only.
Do not reinterpret any described traits from the text prompt. Do not reinterpret any traits shown in reference images.
Even if features are stylized, non-realistic, simplified or exaggerated, they must remain EXACTLY the same.

PRESERVE ORIGINAL CHARACTERS EXACTLY (LOCKED DESIGN):
- identical facial structure and proportions
- identical head shape and stylized geometry
- identical mouth shape and facial expressions
- identical silhouette, body proportions, and overall character identity
- identical hairstyle shape, hairline, hair volume and hair design (only add strand-level texture without changing the shape)
- identical clothing design, seams, patterns, logos, symbols, text, graphics, jewelry, accessories, props (do NOT alter, replace, add, or remove anything)

EYES AND FACIAL EXPRESSIONS ARE ABSOLUTELY LOCKED (HIGHEST PRIORITY):
- do not change eye size, eye shape, iris size, pupil size or eye spacing
- do not add shine, emotion, intensity, wetness, sparkle, reflections or realism to the eyes
- do not modify eyelids, eyebrows, lashes, or facial muscle tension
- do not change gaze direction, head tilt, micro-expression, or “mood”
- eyes and expressions must remain pixel-identical in pose and emotion to the original image
Facial expressions are the HIGHEST PRIORITY and must remain completely unchanged.

FACE PROTECTION (NO BEAUTIFICATION / NO REPAIR):
Do NOT reinterpret, redesign, enhance, beautify, “improve”, or “fix” faces.
Do NOT correct anatomy or add realism to facial features.
Do NOT change facial identity, symmetry, jawline, cheek volume, nose shape, lips shape, or skin contour.
Treat all facial geometry, eyes, and expressions as LOCKED reference design.

ALLOWED CHANGES (ONLY THESE):
Only upgrade:
- fur texture and hair strands (micro-detail only; keep original hair/fur shape and clumps)
- skin material detail (material response only; do NOT change facial features or perceived age)
- material depth (PBR-like roughness/normal depth; subtle, controlled)
- cinematic lighting and shadows applied to the scene/environment, not the face
- improved global shading coherence without altering design or colors

TEXT / LOGO / GRAPHICS LOCK:
If there is ANY text, logo, signage, UI, symbols, or typography:
- keep EXACT content, spelling, font shape, placement, size, and alignment
- do not redraw, restyle, translate, “correct”, or replace text
- do not add new text

COLOR AND LIGHTING DIRECTION (NO NIGHT CONDITION):
- cinematic color grading
- natural, film-like colors
- slightly desaturated palette
- soft highlights, controlled shadows
- NO oversaturation, NO HDR plastic look
- match the original time-of-day and scene intent from the input (day stays day, indoor stays indoor, etc.)
- preserve original light direction and key-to-fill logic; enhance it cinematically without changing mood/emotion
- avoid any dramatic face/eye lighting; keep face lighting consistent with the original

COMPOSITION & CAMERA LOCK:
Maintain original composition, pose, framing, lens feel, perspective, and emotion.
Do not crop, zoom, warp, or change camera angle.
Soft depth of field (subtle, cinematic) while preserving original focus intent.

Negative prompt:
face redesign, eye variation, expression change, emotional enhancement, eye sparkle, wet eyes, added eye reflections,
beautification, symmetry correction, anatomy correction, realistic facial anatomy conversion, new facial identity,
generic lion face, wildlife photography look, realistic lion anatomy, new accessories, removed accessories, added props,
text changes, logo changes, typography changes, oversaturated colors, HDR look, dramatic eye lighting, face relighting,
pose change, framing change, crop, zoom, perspective change
  `.trim(),
};

export default preset;