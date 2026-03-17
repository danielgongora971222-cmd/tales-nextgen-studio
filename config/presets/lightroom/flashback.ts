import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "flashback",
  name: "FLASHBACK",
  kind: "lightroom",
  coverUrl: "/presets/lightroom/flashback/cover.png",
  exampleUrls: [
    "/presets/lightroom/flashback/1.png",
    "/presets/lightroom/flashback/2.png",
    "/presets/lightroom/flashback/3.png",
    "/presets/lightroom/flashback/4.png",
  ],
  referenceGridUrl: "/presets/lightroom/flashback/reference_grid.jpg",
  prompt: `
Apply premium analog image science, soft halation around practical highlights, authentic film grain, subtle gate-weave stability, slight lens breathing, gentle chromatic aberration, faded print warmth, tactile atmospheric diffusion, and a cohesive vintage-fashion finish that feels photographed on real film rather than digitally overprocessed.

PROMPT — LIGHTING EFFECT
PRESERVATION LOCK
Do not alter the original identity, expression, pose, framing, or scene structure. Only transform lighting, tonal character, and editorial atmosphere.

LIGHTING STYLE
Raw 90s diary-fashion lighting with disposable flash realism, moody ambient spill, and intimate anti-glam energy.

LIGHT SOURCES
A small direct on-camera flash delivers harsh frontal illumination with realistic texture and documentary immediacy. Ambient greenish-blue room light remains underneath, leaving the shadows stained with melancholy color. A faint warm practical spill in the distance adds emotional imperfection.

LUT / COLOR GRADING
90s grunge editorial grading with slightly dirty whites, green-cyan shadow bias, muted skin warmth, matte blacks, and low-saturation realism punctuated by flash brightness.

FILM / TEXTURE TREATMENT
Rough 35mm grain, snapshot harshness, subtle underexposed corners, slight color inconsistency, and imperfect analog realism. Nothing should feel polished or luxury-retouched.

COLOR PALETTE
Dominant colors: dirty flash white, washed skin beige, moldy teal, nicotine yellow warmth, gray-green shadows, muted denim blue.
Suggested palette accents: #E8E0D4, #AAB7B0, #6B8C8A, #C49B6B, #54606A, #2E3437

SURFACE RESPONSE
Skin must remain real, human, vulnerable, and textured. Fabric, hair, and background surfaces should feel lived-in, slightly rough, intimate, and emotionally charged.

ATMOSPHERE
The air should feel still, stale, private, and honest. No glamorous fog — just subtle environmental heaviness and fragile realism.

STYLE REFERENCE
Inspired by 90s grunge editorials, raw youth photography, anti-fashion diaries, and intimate magazine portraiture.

TECHNICAL SPECS
No text, no watermark, no logo. 8k, gritty analog realism, rough grain, flash harshness, muted editorial mood, unpolished cinematic intimacy.
  `.trim(),
};

export default preset;
