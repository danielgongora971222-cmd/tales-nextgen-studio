import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "vhs",
  name: "VHS",
  kind: "lightroom",
  coverUrl: "/presets/lightroom/vhs/cover.png",
  exampleUrls: [
    "/presets/lightroom/vhs/1.png",
    "/presets/lightroom/vhs/2.png",
    "/presets/lightroom/vhs/3.png",
    "/presets/lightroom/vhs/4.png",
  ],
  referenceGridUrl: "/presets/lightroom/vhs/reference_grid.jpg",
  prompt: `
Apply premium analog image science, soft halation around practical highlights, authentic film grain, subtle gate-weave stability, slight lens breathing, gentle chromatic aberration, faded print warmth, tactile atmospheric diffusion, and a cohesive vintage-fashion finish that feels photographed on real film rather than digitally overprocessed.

PROMPT — LIGHTING EFFECT
PRESERVATION LOCK
Keep the original subject, pose, face, expression, framing, and scene exactly intact. Only change the lighting treatment, atmosphere, and retro-video mood.

LIGHTING STYLE
Soft neon teenage dream with ultraviolet haze, mall-portrait nostalgia, and late-80s / early-90s VHS bloom.

LIGHT SOURCES
A soft magenta-violet key from upper-front illuminates the face with flattering glow. A cyan-blue ambient wash fills the scene from the opposite side. A faint rose backlight gives the silhouette a synthetic nostalgic edge, as if lit by cheap but beautiful prom-night decor.

LUT / COLOR GRADING
VHS-era pastel neon LUT with lifted blacks, purple-heavy mids, cyan shadow contamination, low-contrast glow, and gentle over-saturation in pink-blue crossover zones.

FILM / TEXTURE TREATMENT
Visible VHS softness, analog bloom, slight chromatic fringing, fine electronic noise mixed with delicate grain, and subtle tape-like color instability without ruining image clarity.

COLOR PALETTE
Dominant colors: ultraviolet purple, bubblegum pink, cool cyan, powder blue, light mauve, smoky navy.
Suggested palette accents: #B66DFF, #F08FC7, #8CD8F8, #DAB3F2, #43506A, #F6E8F3

SURFACE RESPONSE
Skin stays flattering and soft, with a nostalgic glow rather than hyperreal sharpness. Hair, fabrics, and edges catch dreamy neon bleed.

ATMOSPHERE
Dense but soft haze diffuses the colored light and creates a romantic adolescent fantasy mood. The air should feel emotional, synthetic, tender, and retro.

STYLE REFERENCE
Inspired by late-80s prom portraits, VHS music videos, mall studio photography, and teen dream visual culture.

TECHNICAL SPECS
No text, no watermark, no logo. 8k base detail with retro diffusion, VHS bloom, analog softness, controlled chromatic aberration, nostalgic neon mood.
  `.trim(),
};

export default preset;
