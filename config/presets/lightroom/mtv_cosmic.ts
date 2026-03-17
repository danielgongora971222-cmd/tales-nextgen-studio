import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "mtv_cosmic",
  name: "MTV COSMIC",
  kind: "lightroom",
  coverUrl: "/presets/lightroom/mtv_cosmic/cover.png",
  exampleUrls: [
    "/presets/lightroom/mtv_cosmic/1.png",
    "/presets/lightroom/mtv_cosmic/2.png",
    "/presets/lightroom/mtv_cosmic/3.png",
    "/presets/lightroom/mtv_cosmic/4.png",
  ],
  referenceGridUrl: "/presets/lightroom/mtv_cosmic/reference_grid.jpg",
  prompt: `
Apply premium analog image science, soft halation around practical highlights, authentic film grain, subtle gate-weave stability, slight lens breathing, gentle chromatic aberration, faded print warmth, tactile atmospheric diffusion, and a cohesive vintage-fashion finish that feels photographed on real film rather than digitally overprocessed.

PROMPT — LIGHTING EFFECT
PRESERVATION LOCK
Do not alter the person, expression, pose, face, framing, or scene content. Only transform the lighting design, color field, and retro-media atmosphere.

LIGHTING STYLE
Hyper-stylized 90s pop-fantasy lighting with cosmic airbrush color transitions, music-video glamour, and synthetic dream haze.

LIGHT SOURCES
A glowing pink-violet frontal key lights the subject in smooth airbrushed fashion. A cyan underglow rises from below, tinting the lower planes with dream-pop surrealism. A deep electric blue halo from behind fills the surrounding atmosphere and creates a floating silhouette effect.

LUT / COLOR GRADING
90s pop-video LUT with exaggerated magenta-cyan balance, velvet blues, pastel highlight bloom, softened contrast, and luminous synthetic gradients across the shadows.

FILM / TEXTURE TREATMENT
Fine grain mixed with slight analog video softness, subtle glow trails in brighter areas, mild chromatic bleed, and polished retro-pop bloom.

COLOR PALETTE
Dominant colors: cosmic magenta, electric cyan, royal blue, pastel violet, cotton-candy pink, soft pearl white.
Suggested palette accents: #F05BD7, #6CE7F5, #355CFF, #B88AF6, #F8CBE6, #F5F4F0

SURFACE RESPONSE
Skin should remain beautiful and believable, but wrapped in a synthetic dream sheen that feels iconic and playful. Fabrics and hair catch bold color shifts with glossy pop energy.

ATMOSPHERE
A thick luminous mist turns the entire frame into a retro-pop fantasy space. The air should feel musical, emotional, glamorous, and visually addictive.

STYLE REFERENCE
Inspired by 90s music-video glamour, airbrushed pop photography, teen magazine fantasy shoots, and high-color retro visual culture.

TECHNICAL SPECS
No text, no watermark, no logo. 8k, retro-pop diffusion, luminous magenta-cyan grading, elegant glow, fine analog grain, dreamlike MTV-era atmosphere.
  `.trim(),
};

export default preset;
