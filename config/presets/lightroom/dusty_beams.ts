import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "dusty_beams",
  name: "Dusty Beams",
  kind: "lightroom",
  coverUrl: "/presets/lightroom/dusty_beams/cover.png",
  exampleUrls: [
    "/presets/lightroom/dusty_beams/1.png",
    "/presets/lightroom/dusty_beams/2.png",
    "/presets/lightroom/dusty_beams/3.png",
    "/presets/lightroom/dusty_beams/4.png",
  ],
  referenceGridUrl: "/presets/lightroom/dusty_beams/reference_grid.jpg",
  prompt: `
PROMPT — LIGHTING EFFECT
PRESERVATION LOCK
Relight this exact image — do not change the character, pose, face, expression, framing, or any element in the scene. Only modify the lighting and atmosphere.
LIGHTING STYLE
Add warm directional light filtering in from the upper left as if sunlight is leaking through a gap in a ceiling or window.
LIGHT SOURCES
The light should feel diffused and organic — not clean geometric beams but soft irregular shafts with feathered edges that scatter and break apart as they pass through the dusty air. Where the light lands on the subject, it creates warm golden patches with soft transitions, not hard stripes. The areas between the light patches stay in cooler ambient shadow.
COLOR PALETTE
The overall palette stays true to the original but the lit areas shift warm champagne-gold while shadows carry a subtle cool undertone.
SURFACE RESPONSE
Natural textures preserved.
ATMOSPHERE
Fill the air with dense floating dust particles and fine atmospheric haze — this is the most important element, the particles must be clearly visible and abundant throughout the frame, catching and revealing the light naturally. The rays become visible only because of the dense particles, not as solid lines of light. The atmosphere should feel like a dusty room with sunlight pouring in — tangible, physical, lived-in.
STYLE REFERENCE
—
TECHNICAL SPECS
8k, cinematic contrast, natural textures preserved.
  `.trim(),
};

export default preset;
