import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "sodium_vapor",
  name: "SODIUM VAPOR",
  kind: "lightroom",
  coverUrl: "/presets/lightroom/sodium_vapor/cover.png",
  exampleUrls: [
    "/presets/lightroom/sodium_vapor/1.png",
    "/presets/lightroom/sodium_vapor/2.png",
    "/presets/lightroom/sodium_vapor/3.png",
    "/presets/lightroom/sodium_vapor/4.png",
  ],
  referenceGridUrl: "/presets/lightroom/sodium_vapor/reference_grid.jpg",
  prompt: `
PROMPT — LIGHTING EFFECT
PRESERVATION LOCK
The original image relit without changing the character, pose, face, expression, framing, or scene geometry. Only alter lighting, grading, and mood.

LIGHTING STYLE
Moody urban night lighting under premium sodium vapor street ambience with controlled cyan counterbalance.

LIGHT SOURCES
A dominant overhead-left streetlamp style key emits dense amber-sodium light, producing a downward directional wash over the face and upper body. From the far opposite side, a subtle cyan environmental bounce adds shape to the shadow planes. Small reflective accents on skin and surfaces catch warm micro-specular highlights, while the unlit regions stay deep and cinematic. The scene should feel lit by real urban practicals rather than studio gels.

LUT / COLOR GRADING
Night-city LUT with rich amber mids, polluted orange streetlight glow, desaturated deep shadows, selective cyan shadow restoration, and compact black levels for a modern prestige-thriller look.

COLOR PALETTE
Dominant colors: sodium amber, tarnished gold, dirty bronze, smoky cyan-blue, deep petrol black, muted concrete gray.
Suggested palette accents: #E79B2E, #B86A1F, #6C4A2A, #3D6D7A, #162127, #5C5A57

SURFACE RESPONSE
Skin takes on a believable urban warmth with visible texture in the lit areas and controlled shadow retention. Metallic and glossy materials should catch small warm reflections; matte surfaces remain heavy and atmospheric.

ATMOSPHERE
Mild city haze, airborne particulate, and a little moisture in the air to help the sodium light bloom softly. The frame should feel nocturnal, dangerous, elegant, and real.

STYLE REFERENCE
Inspired by Michael Mann night exteriors, neo-noir street photography, and prestige streaming-crime visuals.

TECHNICAL SPECS
No text, no watermark, no logo. 8k, cinematic low-key contrast, premium urban color science, realistic night exposure, natural texture retention.
  `.trim(),
};

export default preset;
