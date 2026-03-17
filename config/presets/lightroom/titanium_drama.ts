import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "titanium_drama",
  name: "TITANIUM DRAMA",
  kind: "lightroom",
  coverUrl: "/presets/lightroom/titanium_drama/cover.png",
  exampleUrls: [
    "/presets/lightroom/titanium_drama/1.png",
    "/presets/lightroom/titanium_drama/2.png",
    "/presets/lightroom/titanium_drama/3.png",
    "/presets/lightroom/titanium_drama/4.png",
  ],
  referenceGridUrl: "/presets/lightroom/titanium_drama/reference_grid.jpg",
  prompt: `
BLEACH BYPASS TITANIUM DRAMA

PROMPT — LIGHTING EFFECT
PRESERVATION LOCK
Relight this exact image only. Preserve the same subject, face, pose, expression, framing, and full scene integrity.

LIGHTING STYLE
Bleach bypass inspired hard cinematic lighting with metallic desaturation and silver-heavy tonal density.

LIGHT SOURCES
A strong neutral-cool key light enters from upper-left, carving the subject with crisp contrast and steep tonal falloff. A faint colder edge light from rear-right introduces separation without warmth. Shadows remain dense, textured, and heavy, with minimal fill. Highlights should feel bright but not glossy — more mineral and steel-like than soft.

LUT / COLOR GRADING
Bleach bypass LUT with reduced saturation, elevated silver density, compressed color response, reinforced local contrast, tungsten contamination removed, and smoky low-end blacks with cold gray lift in the mids.

COLOR PALETTE
Dominant colors: steel gray, titanium silver, smoked graphite, dirty blue-gray shadows, pale pewter highlights, faint olive residue in low saturation zones.
Suggested palette accents: #C7C9C7, #8D9398, #555B60, #2F353A, #8A8D7A, #E2E0DA

SURFACE RESPONSE
Skin texture remains realistic but less rosy and more sculptural. Pores, fabric texture, and hard material grain should become pronounced under the directional light. Nothing should feel glossy-beauty-lit; it should feel severe, expensive, and cinematic.

ATMOSPHERE
Very fine suspended dust or smoke haze to thicken the tonal space subtly. Atmosphere should support density rather than softness.

STYLE REFERENCE
Inspired by bleach bypass finishing in war dramas, crime thrillers, and high-end automotive campaigns.

TECHNICAL SPECS
No text, no watermark, no logo. Ultra sharp 8k, desaturated cinematic finish, hard tonal sculpting, preserved texture detail, premium contrast control.
  `.trim(),
};

export default preset;
