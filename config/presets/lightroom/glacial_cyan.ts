import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "glacial_cyan",
  name: "GLACIAL CYAN",
  kind: "lightroom",
  coverUrl: "/presets/lightroom/glacial_cyan/cover.png",
  exampleUrls: [
    "/presets/lightroom/glacial_cyan/1.png",
    "/presets/lightroom/glacial_cyan/2.png",
    "/presets/lightroom/glacial_cyan/3.png",
    "/presets/lightroom/glacial_cyan/4.png",
  ],
  referenceGridUrl: "/presets/lightroom/glacial_cyan/reference_grid.jpg",
  prompt: `
GLACIAL CYAN FUTURISM

PROMPT — LIGHTING EFFECT
PRESERVATION LOCK
Relight this exact image without changing any features, pose, framing, composition, or environment. Only modify the illumination and color atmosphere.

LIGHTING STYLE
Ultra-clean futuristic cyan-white lighting with surgical precision and luxury tech minimalism.

LIGHT SOURCES
A crisp cool-white key from directly above creates polished top-plane illumination on the face and body. A cyan side light from frame-right defines contours with cool electric structure. A faint icy back rim from rear-left gives shape separation. Shadows are controlled and modern, never muddy, with clean tonal transitions.

LUT / COLOR GRADING
Futuristic digital LUT with cool white balance, cyan energy in the shadow contours, pearl highlight roll-off, neutralized skin reds, and lightly elevated blacks for a sleek premium interface-world feel.

COLOR PALETTE
Dominant colors: icy white, glacial cyan, pale aqua, frosted blue-gray, silver neutrals, deep space navy in the deepest recesses.
Suggested palette accents: #EAF8FF, #9CEBFF, #65D8F3, #6D8793, #DDE3E7, #18252F

SURFACE RESPONSE
Skin retains pore detail but appears cleaner and more porcelain-lit. Reflective surfaces respond with controlled cold speculars. Matte surfaces should feel premium and architectural rather than flat.

ATMOSPHERE
Extremely light volumetric haze for depth, almost sterile. The frame should feel futuristic, intelligent, premium, and ultra-modern.

STYLE REFERENCE
Inspired by luxury tech campaigns, sci-fi fashion editorials, and contemporary concept cinematography.

TECHNICAL SPECS
No text, no watermark, no logo. Ultra detailed 8k, crisp cool contrast, modern digital color science, premium edge definition, balanced clean whites.
  `.trim(),
};

export default preset;
