import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "desert_copper",
  name: "DESERT COPPER",
  kind: "lightroom",
  coverUrl: "/presets/lightroom/desert_copper/cover.png",
  exampleUrls: [
    "/presets/lightroom/desert_copper/1.png",
    "/presets/lightroom/desert_copper/2.png",
    "/presets/lightroom/desert_copper/3.png",
    "/presets/lightroom/desert_copper/4.png",
  ],
  referenceGridUrl: "/presets/lightroom/desert_copper/reference_grid.jpg",
  prompt: `
DESERT COPPER HORIZON

PROMPT — LIGHTING EFFECT
PRESERVATION LOCK
Preserve the exact image structure, same character, same face, same pose, same framing, same scene. Only rework light, grade, and atmosphere.

LIGHTING STYLE
Epic desert dusk lighting with copper horizon glow and dusty turquoise shadow separation.

LIGHT SOURCES
A powerful low-angle horizon light from behind-left emits deep copper-orange light that wraps around the silhouette and grazes the side planes of the face and body. The front receives a gentle cooler ambient fill from the sky in dusty turquoise-blue. A faint top ambience adds realism to upper surfaces without breaking the sunset drama.

LUT / COLOR GRADING
Cinematic desert LUT with copper highlights, sun-baked earth mids, restrained turquoise in shadow channels, soft filmic contrast, and subtle highlight halation around the sun-facing edges.

COLOR PALETTE
Dominant colors: oxidized copper, sun-baked terracotta, golden dust, faded turquoise, dry sand beige, deep umber in shadow pockets.
Suggested palette accents: #C96F35, #A54E2F, #E0BC86, #5E8E92, #8F7A5C, #3C2A22

SURFACE RESPONSE
Skin should glow with warm desert energy on the lit side while maintaining believable detail. Dust, fabric, and dry environmental materials catch warm particulate richness. Shadow side remains cooler and elegant.

ATMOSPHERE
Visible suspended dust, subtle atmospheric thickness, and long-range warm diffusion. The air should feel hot, dry, and cinematic.

STYLE REFERENCE
Inspired by desert epics, luxury western editorials, and prestige streaming adventure cinematography.

TECHNICAL SPECS
No text, no watermark, no logo. 8k, rich desert warmth, balanced cool shadow counterpoint, atmospheric depth, natural textures preserved.
  `.trim(),
};

export default preset;
