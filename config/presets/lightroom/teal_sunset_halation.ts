import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "teal_sunset_halation",
  name: "Teal Sunset Halation",
  kind: "lightroom",
  coverUrl: "/presets/lightroom/teal_sunset_halation/cover.png",
  exampleUrls: [
    "/presets/lightroom/teal_sunset_halation/1.png",
    "/presets/lightroom/teal_sunset_halation/2.png",
    "/presets/lightroom/teal_sunset_halation/3.png",
    "/presets/lightroom/teal_sunset_halation/4.png",
  ],
  referenceGridUrl: "/presets/lightroom/teal_sunset_halation/reference_grid.jpg",
  prompt: `
TEAL SUNSET HALATION

PROMPT — LIGHTING EFFECT
PRESERVATION LOCK
Relight this exact image — do not change the character, pose, face, expression, framing, or any element in the scene. Only modify the lighting, color separation, and atmosphere.

LIGHTING STYLE
Luxury cinematic sunset lighting with refined teal-orange separation and soft analog halation.

LIGHT SOURCES
A low warm sunset key light enters from frame-left at a shallow angle, wrapping across the face and body with a rich golden-amber edge. A soft cool ambient skylight fills the opposite side from upper-right, creating elegant tonal balance without flattening contrast. A faint secondary back rim in pale peach traces the silhouette selectively on hair, shoulders, and jawline. Light transitions remain smooth and expensive-looking, with no harsh clipping.

LUT / COLOR GRADING
Premium print-film LUT aesthetic with softened highlight roll-off, rich amber mids, restrained teal shadows, subtle halation around the brightest specular points, and slightly lifted shadow detail for a polished commercial finish.

COLOR PALETTE
Dominant colors: burnt orange, honey gold, pale apricot highlights, muted deep teal shadows, smoky cyan in the cool fill, soft tobacco-brown neutrals.
Suggested palette accents: #F6B15E, #D97A32, #F2D1B0, #2F5D67, #1E3944, #6A5042

SURFACE RESPONSE
Skin should retain realistic detail while glowing softly in the warm key zones. Highlights feel creamy and dimensional rather than metallic. Fabrics and surfaces reflect the warm key with subtle golden richness while shadow materials absorb the teal atmosphere naturally.

ATMOSPHERE
A light suspended haze catches the sunset direction delicately, adding depth without obscuring detail. Very subtle air bloom around bright edges. The image should feel expensive, calm, cinematic, and editorial.

STYLE REFERENCE
Inspired by high-end fragrance campaigns, Kodak print-film warmth, and contemporary fashion cinematography.

TECHNICAL SPECS
No text, no watermark, no logo. Ultra detailed 8k, cinematic dynamic range, rich warm-cool separation, soft highlight halation, refined contrast, natural skin texture preserved.
  `.trim(),
};

export default preset;
