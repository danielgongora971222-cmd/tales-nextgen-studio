import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "supermodel_silver",
  name: "SUPERMODEL SILVER",
  kind: "lightroom",
  coverUrl: "/presets/lightroom/supermodel_silver/cover.png",
  exampleUrls: [
    "/presets/lightroom/supermodel_silver/1.png",
    "/presets/lightroom/supermodel_silver/2.png",
    "/presets/lightroom/supermodel_silver/3.png",
    "/presets/lightroom/supermodel_silver/4.png",
  ],
  referenceGridUrl: "/presets/lightroom/supermodel_silver/reference_grid.jpg",
  prompt: `
Apply premium analog image science, soft halation around practical highlights, authentic film grain, subtle gate-weave stability, slight lens breathing, gentle chromatic aberration, faded print warmth, tactile atmospheric diffusion, and a cohesive vintage-fashion finish that feels photographed on real film rather than digitally overprocessed.

PROMPT — LIGHTING EFFECT
PRESERVATION LOCK
Keep the exact image intact in subject, expression, pose, composition, and scene. Only change the lighting design and monochrome-finishing mood.

LIGHTING STYLE
Romantic 90s supermodel monochrome with soft silver diffusion and timeless editorial sculpting.

LIGHT SOURCES
A large overhead-frontal soft source creates luminous silver highlights across the face and upper planes. A faint side kicker shapes the cheekbones and jawline. Background values remain gentle and elegant, with smooth tonal separation and no aggressive shadow collapse.

LUT / COLOR GRADING
Selenium-toned black-and-white finish with cool silver highlights, velvety charcoal mids, gentle pearl whites, and an almost imperceptible lavender-cold tint in the deepest tonal transitions.

FILM / TEXTURE TREATMENT
Fine black-and-white film grain, soft enlarger-style tonal bloom, subtle silver halation, and classic editorial print softness.

COLOR PALETTE
Dominant colors: pearl white, cool silver, graphite gray, smoky charcoal, faint lavender-selenium undertones.
Suggested palette accents: #F1F2F2, #C8CDD3, #8E949A, #585E65, #23282D, #A59CB0

SURFACE RESPONSE
Skin should read as luminous, noble, tactile, and sculptural. Every texture remains elegant and resolved, never harsh or clinical.

ATMOSPHERE
Soft editorial haze with air that feels elevated, timeless, and expensive. The image should feel iconic rather than nostalgic in a cliché way.

STYLE REFERENCE
Inspired by 90s supermodel portraiture, monochrome fashion covers, and silver-rich editorial print aesthetics.

TECHNICAL SPECS
No text, no watermark, no logo. 8k, refined monochrome tonality, selenium-silver finish, luxurious grain, soft sculptural contrast, timeless editorial depth.
  `.trim(),
};

export default preset;
