export type ImagePreset = {
  id: string;
  name: string;
  prompt: string;

  // Imagen cuadrada para el selector (preview)
  coverUrl?: string;

  // Opcional (por si luego quieres galería 2x2 o ejemplos)
  exampleUrls?: [string, string, string, string];
};
