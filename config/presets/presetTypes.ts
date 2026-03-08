export type ImagePresetKind = "restyle" | "lightroom";

export type ImagePreset = {
  id: string;
  name: string;
  prompt: string;

  // Para que el manager pueda trabajar con ambos catálogos
  kind?: ImagePresetKind;

  // Imagen principal del selector visual
  coverUrl?: string;

  // Ejemplos para hover / preview (1,2,3,4)
  exampleUrls?: string[];

  // Grid 2x2 real que se usará como imagen de referencia del preset
  referenceGridUrl?: string;
};