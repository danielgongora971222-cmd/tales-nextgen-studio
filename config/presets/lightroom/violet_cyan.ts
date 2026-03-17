import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "violet_cyan",
  name: "VIOLET-CYAN",
  kind: "lightroom",
  coverUrl: "/presets/lightroom/violet_cyan/cover.png",
  exampleUrls: [
    "/presets/lightroom/violet_cyan/1.png",
    "/presets/lightroom/violet_cyan/2.png",
    "/presets/lightroom/violet_cyan/3.png",
    "/presets/lightroom/violet_cyan/4.png",
  ],
  referenceGridUrl: "/presets/lightroom/violet_cyan/reference_grid.jpg",
  prompt: `
Apply premium cinematic color science, elegant highlight roll-off, subtle halation, dense but controlled blacks, realistic skin tone protection, micro-contrast in textures, natural material response, atmospheric depth separation, and a cohesive LUT finish that feels integrated into the original image rather than overlaid.

PROMPT — LIGHTING EFFECT
PRESERVATION LOCK
The original image must remain unchanged in face, body, pose, expression, framing, and scene elements. Only alter lighting, color dynamics, and atmospheric tone.

LIGHTING STYLE
Charged storm-light cinema with violet-cyan electrical contrast and dramatic weather energy.

LIGHT SOURCES
A cold cyan flash-like key from upper-left strikes the scene with sharp, stormy intensity, revealing selective texture with dramatic contrast. A saturated violet fill from the opposite side shapes the shadow planes and creates chromatic tension. A cool white rear edge light flickers softly across the silhouette as though reflecting distant lightning in wet air.

LUT / COLOR GRADING
Electric storm LUT with cool cyan highlight bias, violet shadow infusion, crisp contrast, selective desaturation in neutral zones, and luminous energy around high-intensity edges.

COLOR PALETTE
Dominant colors: lightning cyan, ultraviolet violet, silver-white flashes, deep blue-black storm shadows, muted indigo midtones.
Suggested palette accents: #7CEBFF, #7A5CFF, #E6F7FF, #243B63, #111A2A, #4A4D8F

SURFACE RESPONSE
Skin texture should be visible and dramatic where the cyan strike lands, while the violet side remains richer and moodier. Wet-looking or reflective materials can catch energized highlights, but natural realism must remain intact.

ATMOSPHERE
Dense charged mist, subtle airborne droplets, light diffusion, and a sense of humid storm pressure in the air. The atmosphere should make the light feel alive and electric.

STYLE REFERENCE
Inspired by sci-fi thrillers, storm-lit music videos, and high-concept cinematic poster lighting.

TECHNICAL SPECS
No text, no watermark, no logo. 8k, vivid storm contrast, premium chromatic separation, cinematic atmospheric depth, natural detail preserved.
  `.trim(),
};

export default preset;
