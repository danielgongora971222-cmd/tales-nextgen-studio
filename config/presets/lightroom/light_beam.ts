import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "light_beam",
  name: "Light Beam",
  kind: "lightroom",
  coverUrl: "/presets/lightroom/light_beam/cover.png",
  exampleUrls: [
    "/presets/lightroom/light_beam/1.png",
    "/presets/lightroom/light_beam/2.png",
    "/presets/lightroom/light_beam/3.png",
    "/presets/lightroom/light_beam/4.png",
  ],
  referenceGridUrl: "/presets/lightroom/light_beam/reference_grid.jpg",
  prompt: `
PROMPT — LIGHTING EFFECT
PRESERVATION LOCK
Relight this exact image — do not change the character, pose, face, expression, framing, or any element in the scene. Only modify the lighting and atmosphere. No light source should be visible in the frame.
LIGHTING STYLE
The entire scene is now lit by a single strong hard light coming from outside the frame, upper right. This is the only light source — everything in the scene depends on it.
LIGHT SOURCES
On the subject: the light hits the face and body from that angle, creating strong defined shadows on the opposite side. Every surface texture is revealed harshly where the light lands — pores, fabric weave, material grain. The shadow side is deep and rich with minimal fill. On the environment: every object and surface in the background and foreground responds to this same directional light — surfaces facing upper right catch highlights, surfaces facing away fall into shadow.
COLOR PALETTE
Deep cool charcoal shadows throughout the whole image. Highlights carry clean neutral-warm intensity.
SURFACE RESPONSE
The entire scene reads as one unified lighting setup, not a light effect placed on top of an existing photo. Every surface texture is revealed harshly where the light lands — pores, fabric weave, material grain.
ATMOSPHERE
Fine dust particles float subtly in the air.
STYLE REFERENCE
—
TECHNICAL SPECS
The mood is raw, dramatic, cinematic. 8k, high contrast, all original textures preserved.
  `.trim(),
};

export default preset;
