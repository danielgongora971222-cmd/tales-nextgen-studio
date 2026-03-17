import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "vitral",
  name: "Vitral",
  kind: "lightroom",
  coverUrl: "/presets/lightroom/vitral/cover.png",
  exampleUrls: [
    "/presets/lightroom/vitral/1.png",
    "/presets/lightroom/vitral/2.png",
    "/presets/lightroom/vitral/3.png",
    "/presets/lightroom/vitral/4.png",
  ],
  referenceGridUrl: "/presets/lightroom/vitral/reference_grid.jpg",
  prompt: `
PROMPT — LIGHTING EFFECT
PRESERVATION LOCK
The original image reimagined in extreme saturated color gel lighting. Same character and pose preserved. Same framing and composition.
LIGHTING STYLE
Italian giallo horror lighting style.
LIGHT SOURCES
Three competing colored light sources bathing the scene — deep blood red from the left, electric emerald green from below-right, and vivid royal blue from above-behind. Each color bleeds into the next at the edges, creating layered chromatic shadows on the face and body.
COLOR PALETTE
Dominant colors: saturated crimson red, deep emerald green, electric cobalt blue, magenta where red and blue overlap, shadows turning deep violet-black.
SURFACE RESPONSE
Natural skin texture absorbing and reflecting each colored light differently, visible pores tinted by competing hues.
ATMOSPHERE
Subtle atmospheric haze catching all three colors.
STYLE REFERENCE
Inspired by Dario Argento — Suspiria (1977) technicolor horror palette.
TECHNICAL SPECS
No text, no watermark, no logo. Vivid hyper saturated 8k resolution, dreamlike contrast, rich chromatic depth. Shallow depth of field.
  `.trim(),
};

export default preset;
