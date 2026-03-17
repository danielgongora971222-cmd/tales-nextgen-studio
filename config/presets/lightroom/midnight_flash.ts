import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "midnight_flash",
  name: "MIDNIGHT FLASH",
  kind: "lightroom",
  coverUrl: "/presets/lightroom/midnight_flash/cover.png",
  exampleUrls: [
    "/presets/lightroom/midnight_flash/1.png",
    "/presets/lightroom/midnight_flash/2.png",
    "/presets/lightroom/midnight_flash/3.png",
    "/presets/lightroom/midnight_flash/4.png",
  ],
  referenceGridUrl: "/presets/lightroom/midnight_flash/reference_grid.jpg",
  prompt: `
Apply premium analog image science, soft halation around practical highlights, authentic film grain, subtle gate-weave stability, slight lens breathing, gentle chromatic aberration, faded print warmth, tactile atmospheric diffusion, and a cohesive vintage-fashion finish that feels photographed on real film rather than digitally overprocessed.

PROMPT — LIGHTING EFFECT
PRESERVATION LOCK
Relight this exact image without changing the subject, face, pose, expression, framing, or any scene elements. Only alter the lighting and visual mood.

LIGHTING STYLE
Hard 80s nightlife flash glamour with luxurious tension, bold contrast, and cold shadow depth.

LIGHT SOURCES
A strong direct flash from camera-front hits the subject with crisp bright intensity, flattening some planes while exposing texture and attitude. A secondary cool rim from rear-right adds contour separation. Background and non-lit areas fall off quickly into rich midnight shadow.

LUT / COLOR GRADING
Late-80s editorial flash grading with dense blacks, slightly cold whites, controlled skin warmth, subtle blue contamination in shadows, and metallic contrast.

FILM / TEXTURE TREATMENT
35mm magazine-style grain, tiny flash-bloom on specular highlights, slight lens edge softness, minimal halation, and a polished analog magazine finish.

COLOR PALETTE
Dominant colors: flash white, cool ivory, midnight blue-black, silver gray, pale skin warmth, faint steel cyan.
Suggested palette accents: #F6F3EE, #DADDE2, #27303D, #11151C, #B9A08D, #6A8592

SURFACE RESPONSE
Skin should keep visible pore detail and sharp flash texture, while still reading expensive and intentional. Fabric, leather, hair, and metallic surfaces respond strongly to direct light.

ATMOSPHERE
Air stays mostly clear, with only a whisper of nocturnal haze. The overall sensation is bold, glamorous, controlled, and dangerously elegant.

STYLE REFERENCE
Inspired by 80s fashion nightlife portraiture, hard flash editorial photography, and luxury hotel-after-dark visual language.

TECHNICAL SPECS
No text, no watermark, no logo. 8k, sharp direct-flash contrast, premium grain, nocturnal elegance, hard texture rendering, cinematic black depth.
  `.trim(),
};

export default preset;
