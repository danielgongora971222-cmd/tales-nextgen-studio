import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "polaroid_lavender",
  name: "POLAROID LAVENDER",
  kind: "lightroom",
  coverUrl: "/presets/lightroom/polaroid_lavender/cover.png",
  exampleUrls: [
    "/presets/lightroom/polaroid_lavender/1.png",
    "/presets/lightroom/polaroid_lavender/2.png",
    "/presets/lightroom/polaroid_lavender/3.png",
    "/presets/lightroom/polaroid_lavender/4.png",
  ],
  referenceGridUrl: "/presets/lightroom/polaroid_lavender/reference_grid.jpg",
  prompt: `
Apply premium analog image science, soft halation around practical highlights, authentic film grain, subtle gate-weave stability, slight lens breathing, gentle chromatic aberration, faded print warmth, tactile atmospheric diffusion, and a cohesive vintage-fashion finish that feels photographed on real film rather than digitally overprocessed.

PROMPT — LIGHTING EFFECT
PRESERVATION LOCK
Do not alter the subject, face, expression, pose, framing, or any original scene element. Only transform the lighting, atmospheric color mood, and film-like rendering.

LIGHTING STYLE
Dreamy instant-film glamour with pastel lavender diffusion and nostalgic Polaroid softness.

LIGHT SOURCES
A broad frontal soft key in pale lavender-pink wraps the face with creamy low-contrast glow. A soft peach backlight from upper-left creates a delicate halo around the silhouette. A faint cyan ambient lift fills the lower shadows so the image stays airy and dimensional rather than flat.

LUT / COLOR GRADING
Polaroid SX-70 inspired pastel grading with faded magenta mids, warm creamy whites, slight cyan cooling in shadow edges, gentle highlight bloom, reduced contrast, and softened tonal transitions.

FILM / TEXTURE TREATMENT
Fine instant-film grain, mild halation around bright edges, subtle softness in the corners, faint emulsion fade, and a very delicate vintage color drift that feels analog and romantic.

COLOR PALETTE
Dominant colors: faded orchid, pale lavender, blush pink, soft peach cream, powder cyan, warm off-white.
Suggested palette accents: #E8BEDA, #CFA7E8, #F2D3C7, #C8E8EE, #F7F1EA, #826B8D

SURFACE RESPONSE
Skin should feel luminous, gentle, flattering, and expensive, with natural texture preserved under the diffusion. Hair and fabric catch soft pastel glow without looking glossy-plastic.

ATMOSPHERE
A suspended veil of soft mist fills the frame with instant-film dreaminess. Air should feel tender, nostalgic, romantic, and slightly unreal.

STYLE REFERENCE
Inspired by late-70s to 80s instant film portraiture, Polaroid fashion tests, and soft beauty editorials.

TECHNICAL SPECS
No text, no watermark, no logo. 8k, pastel analog softness, subtle Polaroid bloom, fine grain, elegant low contrast, natural skin fidelity.
  `.trim(),
};

export default preset;
