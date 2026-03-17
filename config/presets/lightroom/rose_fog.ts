import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "rose_fog",
  name: "ROSE FOG",
  kind: "lightroom",
  coverUrl: "/presets/lightroom/rose_fog/cover.png",
  exampleUrls: [
    "/presets/lightroom/rose_fog/1.png",
    "/presets/lightroom/rose_fog/2.png",
    "/presets/lightroom/rose_fog/3.png",
    "/presets/lightroom/rose_fog/4.png",
  ],
  referenceGridUrl: "/presets/lightroom/rose_fog/reference_grid.jpg",
  prompt: `
Apply premium analog image science, soft halation around practical highlights, authentic film grain, subtle gate-weave stability, slight lens breathing, gentle chromatic aberration, faded print warmth, tactile atmospheric diffusion, and a cohesive vintage-fashion finish that feels photographed on real film rather than digitally overprocessed.

PROMPT — LIGHTING EFFECT
PRESERVATION LOCK
Preserve the exact face, subject, pose, expression, framing, and all original scene elements. Only transform the lighting and atmospheric film mood.

LIGHTING STYLE
Ethereal large-format portrait lighting with rose fog diffusion, soft focus glow, and painterly fashion quietness.

LIGHT SOURCES
A broad frontal soft source in muted rose-beige creates feather-light luminous skin. A gentle pale lilac back haze lifts the silhouette into the atmosphere. A very faint cool underfill prevents the lower tones from becoming muddy while keeping the image dreamy and elevated.

LUT / COLOR GRADING
Soft rose-beige grading with muted pink mids, lifted foggy blacks, creamy whites, delicate mauve shadows, and lowered micro-contrast for a luxurious blurred-edge elegance.

FILM / TEXTURE TREATMENT
Ultra-fine grain, large-format softness, delicate halation, blooming highlights, and a slight lens-breath dream effect. The image should feel tactile, poetic, and expensive.

COLOR PALETTE
Dominant colors: dusty rose, pale mauve, faded cream, blush beige, soft lilac fog, muted taupe.
Suggested palette accents: #D8B1B6, #C7A1C9, #F0E6DE, #D8C1B2, #8F7B87, #F6F2EC

SURFACE RESPONSE
Skin feels luminous and intimate, with natural detail gently wrapped by atmosphere rather than erased. Hair and textiles melt softly into the tonal space.

ATMOSPHERE
Dense rose-fog mist gives the frame a floating, painterly silence. The mood should feel spiritual, romantic, delicate, and editorial.

STYLE REFERENCE
Inspired by poetic 80s–90s large-format fashion portraiture, soft-focus editorials, and vaporous fine-art beauty imagery.

TECHNICAL SPECS
No text, no watermark, no logo. 8k, atmospheric diffusion, elegant soft focus, creamy tonal transitions, fine grain, poetic editorial rendering.
  `.trim(),
};

export default preset;
