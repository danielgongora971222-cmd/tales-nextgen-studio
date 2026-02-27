import type { ImagePreset } from "../presetTypes";

const preset: ImagePreset = {
  id: "luxury_product",
  name: "Luxury Product",
  coverUrl: "/presets/restyle/luxury_product/cover.jpg",
  exampleUrls: [
    "/presets/restyle/luxury_product/1.jpg",
    "/presets/restyle/luxury_product/2.jpg",
    "/presets/restyle/luxury_product/3.jpg",
    "/presets/restyle/luxury_product/4.jpg",
  ],
  prompt: `
STYLE: Luxury product advertising. Clean studio, premium reflections.
Lighting: controlled specular highlights, soft gradients, no harsh glare.
Composition: centered hero shot, elegant negative space, minimal clutter.
Quality: extremely sharp, high contrast micro-detail, commercial polish.
  `.trim(),
};

export default preset;
