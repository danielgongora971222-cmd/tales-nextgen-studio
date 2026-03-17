import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "electric_youth",
  name: "ELECTRIC YOUTH",
  kind: "lightroom",
  coverUrl: "/presets/lightroom/electric_youth/cover.png",
  exampleUrls: [
    "/presets/lightroom/electric_youth/1.png",
    "/presets/lightroom/electric_youth/2.png",
    "/presets/lightroom/electric_youth/3.png",
    "/presets/lightroom/electric_youth/4.png",
  ],
  referenceGridUrl: "/presets/lightroom/electric_youth/reference_grid.jpg",
  prompt: `
Apply premium analog image science, soft halation around practical highlights, authentic film grain, subtle gate-weave stability, slight lens breathing, gentle chromatic aberration, faded print warmth, tactile atmospheric diffusion, and a cohesive vintage-fashion finish that feels photographed on real film rather than digitally overprocessed.

PROMPT — LIGHTING EFFECT
PRESERVATION LOCK
Do not change the subject, face, expression, pose, framing, or original scene. Only alter the lighting mood, grading, and analog treatment.

LIGHTING STYLE
Aggressive youth-fashion lighting with cross-processed color shifts, rebellious energy, and vibrant magazine-era stylization.

LIGHT SOURCES
A bright yellow-green key light from upper-left energizes the face and body with edgy contamination. A cool blue-violet counterlight from the opposite side creates conflict and visual electricity. A small frontal white lift keeps the subject readable amid the strong color distortions.

LUT / COLOR GRADING
Cross-process inspired LUT with yellow-green highlights, cyan shadow contamination, exaggerated color shifts, contrasty mids, and a chemically altered analog feel.

FILM / TEXTURE TREATMENT
Pronounced 35mm grain, slight color clipping in extreme highlights, subtle chromatic instability, and edgy print roughness. The result should feel cool, reckless, and fashion-forward.

COLOR PALETTE
Dominant colors: acid yellow, chemical green, electric cyan, bruised violet, dirty white, deep navy-black.
Suggested palette accents: #D7E83C, #88B04B, #3FD6E0, #7757B8, #E7E4D8, #1C2231

SURFACE RESPONSE
Skin stays real but intentionally color-pushed, with unexpected tonal shifts that feel editorial and anti-safe. Materials respond with vibrant analog unpredictability.

ATMOSPHERE
The air should feel charged, youthful, imperfect, and alive. Slight haze helps the unstable colors bleed into one another.

STYLE REFERENCE
Inspired by cross-processed 90s editorials, indie fashion magazines, youth-culture portraiture, and chemically bold film aesthetics.

TECHNICAL SPECS
No text, no watermark, no logo. 8k, cross-process color aggression, visible grain, analog unpredictability, edgy editorial contrast, strong chromatic identity.
  `.trim(),
};

export default preset;
