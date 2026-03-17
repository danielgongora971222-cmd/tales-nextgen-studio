import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "magenta_mist",
  name: "MAGENTA MIST",
  kind: "lightroom",
  coverUrl: "/presets/lightroom/magenta_mist/cover.png",
  exampleUrls: [
    "/presets/lightroom/magenta_mist/1.png",
    "/presets/lightroom/magenta_mist/2.png",
    "/presets/lightroom/magenta_mist/3.png",
    "/presets/lightroom/magenta_mist/4.png",
  ],
  prompt: `
MAGENTA MIST DREAMSCAPE

PROMPT — LIGHTING EFFECT
PRESERVATION LOCK
Do not alter the subject, expression, framing, pose, or original scene elements. Only transform the lighting design and atmospheric color mood.

LIGHTING STYLE
Dreamlike soft diffusion lighting with magenta-lilac atmosphere and luminous pastel depth.

LIGHT SOURCES
A broad soft frontal key in pale pink-lavender illuminates the face with creamy low-contrast smoothness. From behind and slightly above, a stronger magenta-violet backlight adds glow and dimensional halo. A cool pale cyan underfill lifts the lower shadow planes subtly to prevent mud and create chromatic elegance.

LUT / COLOR GRADING
Pastel dream LUT with blooming highlights, soft magenta mids, lilac atmospheric shadows, delicate cyan balancing in the lower tonal zones, and reduced harshness throughout the frame.

COLOR PALETTE
Dominant colors: rose quartz pink, orchid magenta, soft lilac, pale cyan, pearl white, muted plum in deeper shadows.
Suggested palette accents: #F5C7DF, #D97CCB, #A98BE7, #BEEAF2, #F7F3F0, #5A476A

SURFACE RESPONSE
Skin appears luminous and flattering while retaining natural texture and believable detail. Hair and fabric catch pastel edge glows. The overall response should feel romantic and premium, never cheap or neon-heavy.

ATMOSPHERE
Dense but soft mist fills the background and gently diffuses the colored sources, creating dreamy dimensional separation. Air should glow, not cloud the image.

STYLE REFERENCE
Inspired by luxury beauty campaigns, dreamy pop cinematography, and soft fantasy editorial lighting.

TECHNICAL SPECS
No text, no watermark, no logo. 8k, soft cinematic bloom, premium pastel color harmony, natural skin fidelity, elegant low-contrast diffusion.
  `.trim(),
};

export default preset;
