import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "bourdin_candy",
  name: "BOURDIN CANDY",
  kind: "lightroom",
  coverUrl: "/presets/lightroom/bourdin_candy/cover.png",
  exampleUrls: [
    "/presets/lightroom/bourdin_candy/1.png",
    "/presets/lightroom/bourdin_candy/2.png",
    "/presets/lightroom/bourdin_candy/3.png",
    "/presets/lightroom/bourdin_candy/4.png",
  ],
  referenceGridUrl: "/presets/lightroom/bourdin_candy/reference_grid.jpg",
  prompt: `
Apply premium analog image science, soft halation around practical highlights, authentic film grain, subtle gate-weave stability, slight lens breathing, gentle chromatic aberration, faded print warmth, tactile atmospheric diffusion, and a cohesive vintage-fashion finish that feels photographed on real film rather than digitally overprocessed.

PROMPT — LIGHTING EFFECT
PRESERVATION LOCK
Preserve the exact character, face, expression, pose, composition, and scene. Only modify lighting, color logic, and atmosphere.

LIGHTING STYLE
Bold surreal fashion lighting with seductive candy-colored tension and graphic editorial drama.

LIGHT SOURCES
A hot pink-red directional key from frame-left strikes the subject with rich saturated glamour. A cool turquoise fill from frame-right shapes the shadow side with glossy cinematic contrast. A narrow warm peach kicker from behind adds seductive contour around the hair, shoulders, and cheek line.

LUT / COLOR GRADING
1980s luxury fashion print grading with saturated reds, lacquered skin warmth, cyan-tinted shadows, glossy contrast, and slightly exaggerated chromatic separation. Highlights should feel rich and expensive, not digital.

FILM / TEXTURE TREATMENT
Glossy fashion-print texture, subtle print halation, low-to-medium film grain, slight color density buildup in reds, and faint analog softness in high-saturation zones.

COLOR PALETTE
Dominant colors: lipstick red, fuchsia, candy pink, turquoise, peach skin light, dense plum-black shadows.
Suggested palette accents: #D6285B, #F05AA6, #4BC6C8, #F2B6A0, #53243F, #0E2730

SURFACE RESPONSE
Skin remains realistic but glamorized, with rich color density and polished contrast. Materials should feel editorial, sexy, reflective, and color-reactive.

ATMOSPHERE
Very subtle haze softens the clash of saturated colors and gives the image a decadent, dangerous, high-fashion mood.

STYLE REFERENCE
Inspired by provocative late-70s and 80s fashion surrealism, saturated luxury editorials, and graphic color storytelling that shaped fashion imagery.

TECHNICAL SPECS
No text, no watermark, no logo. 8k, high-fashion saturation, glossy print feel, refined grain, strong chromatic contrast, premium editorial finish.
  `.trim(),
};

export default preset;
