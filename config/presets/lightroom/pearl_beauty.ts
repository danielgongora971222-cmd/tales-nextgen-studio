import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "pearl_beauty",
  name: "Pearl Beauty",
  kind: "lightroom",
  coverUrl: "/presets/lightroom/pearl_beauty/cover.png",
  exampleUrls: [
    "/presets/lightroom/pearl_beauty/1.png",
    "/presets/lightroom/pearl_beauty/2.png",
    "/presets/lightroom/pearl_beauty/3.png",
    "/presets/lightroom/pearl_beauty/4.png",
  ],
  referenceGridUrl: "/presets/lightroom/pearl_beauty/reference_grid.jpg",
  prompt: `
PROMPT — LIGHTING EFFECT
PRESERVATION LOCK
Keep the original image perfectly intact in subject identity, face, pose, expression, framing, and scene composition. Only adjust lighting and color treatment.

LIGHTING STYLE
High-end beauty cinema lighting with pearl diffusion, champagne highlights, and editorial skin rendering.

LIGHT SOURCES
A large frontal-above soft source wraps smoothly around the face and body, producing delicate shadow transitions and refined dimensionality. A subtle side kicker from frame-left adds shape to cheekbones, jawline, shoulders, and texture edges. A faint warm backlight introduces luxury separation without overpowering the softness.

LUT / COLOR GRADING
Editorial beauty LUT with creamy highlights, soft champagne warmth, preserved skin nuance, gentle contrast, controlled reds, and luminous but natural complexion rendering.

COLOR PALETTE
Dominant colors: pearl white, champagne gold, soft beige, warm blush undertones, pale taupe shadows, clean ivory highlights.
Suggested palette accents: #F5EEE7, #E6D2B4, #D2B49B, #B8A393, #F9F5F0, #8C7A6D

SURFACE RESPONSE
Skin should appear incredibly dimensional, clean, natural, and expensive — pores preserved but flattering, with no waxiness. Hair should catch silky micro-highlights. Clothing and surfaces remain understated and polished.

ATMOSPHERE
Minimal atmosphere — just enough diffusion to bloom the highlights delicately. The mood should feel premium, polished, intimate, and luxury-commercial.

STYLE REFERENCE
Inspired by prestige beauty ads, luxury skincare campaigns, and soft cinematic portrait lighting.

TECHNICAL SPECS
No text, no watermark, no logo. 8k, ultra refined soft contrast, editorial skin fidelity, controlled bloom, premium beauty-grade lighting.
  `.trim(),
};

export default preset;
