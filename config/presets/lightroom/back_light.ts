import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "back_light",
  name: "Back Light",
  kind: "lightroom",
  coverUrl: "/presets/lightroom/back_light/cover.png",
  exampleUrls: [
    "/presets/lightroom/back_light/1.png",
    "/presets/lightroom/back_light/2.png",
    "/presets/lightroom/back_light/3.png",
    "/presets/lightroom/back_light/4.png",
  ],
  referenceGridUrl: "/presets/lightroom/back_light/reference_grid.jpg",
  prompt: `
PROMPT — LIGHTING EFFECT
PRESERVATION LOCK
Relight this exact image — do not change the character, pose, face, expression, framing, or any element in the scene. Only modify the lighting and atmosphere.
LIGHTING STYLE
Add dramatic backlighting with an intense warm light source directly behind the subject.
LIGHT SOURCES
Create a bright glowing rim light outlining the entire silhouette with warm amber-gold edges. Add visible lens flare streaks and hexagonal light artifacts spreading across the frame. The front of the subject falls into rich cooler shadow with soft ambient bounce providing fill detail on the face.
COLOR PALETTE
Blazing warm white-gold at the light source core, cool blue-teal undertones in the front shadows.
SURFACE RESPONSE
Natural skin texture preserved.
ATMOSPHERE
Existing environment washed with intense backlight creating depth haze and light diffusion. Dense atmospheric haze amplifying backlight diffusion, visible light particles in the air.
STYLE REFERENCE
—
TECHNICAL SPECS
8k, cinematic contrast, natural skin texture preserved.
  `.trim(),
};

export default preset;
