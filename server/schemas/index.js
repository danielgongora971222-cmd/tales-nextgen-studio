import { z } from "zod";

// Centralizamos los schemas Zod para que server.js no sea monolítico.
// Importa lo que necesites desde: server/schemas/index.js

export const Base64ImageSchema = z
  .string()
  .min(10)
  .refine((v) => v.startsWith("data:image/"), "Expected a data:image/*;base64,... dataUrl");

export const ImageRequestSchema = z.object({
  prompt: z.string().min(1).max(14000),
  model: z.string().optional(),
  aspectRatio: z.string().optional(),

  // UI nueva
  count: z.number().int().min(1).max(4).default(1),
  quality: z.enum(["1K", "2K", "4K"]).optional(),

  tool: z.string().optional(),      // ej: "image-generator"
  nameHint: z.string().optional(),  // ej: "generated"

  // Referencias por Asset IDs (opcional)
  characterAssetIds: z.array(z.string()).max(10).optional(),
  styleAssetId: z.string().optional(),
  backgroundAssetId: z.string().optional(),
  // ✅ Kling-only (Element Library): IDs UUID de tu tabla public.kling_elements
  // (estos NO son los element_id bigint que devuelve Kling)
  klingElementIds: z.array(z.string().uuid()).max(5).optional(),
});

export const VideoRequestSchema = z.object({
  prompt: z.string().min(1).max(14000),
  model: z.string().optional(),
  sync: z.boolean().optional(),
  async: z.boolean().optional(),

  // Solo aplica cuando NO hay firstFrame
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]).optional(),

  // Params Veo
  resolution: z.enum(["720p", "1080p", "4k"]).optional(),
  durationSeconds: z.coerce.number().optional(),
  count: z.number().int().min(1).max(4).default(1),

  tool: z.string().optional(),
  nameHint: z.string().optional(),

  // Frame assets (opcionales)
  firstFrameAssetId: z.string().uuid().nullable().optional(),
  lastFrameAssetId: z.string().uuid().nullable().optional(),

  // Kling extras (v2.* / v3)
  // ⚠️ Tu endpoint /api/ai/video usa estos nombres kling* (si no están aquí, Zod los elimina)
  klingMode: z.enum(["std", "pro"]).optional(),
  klingSound: z.boolean().optional(),
  klingCfgScale: z.coerce.number().min(0).max(2).optional(),
  klingVoiceIds: z.array(z.string()).max(2).optional(),
  klingShotType: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
    z.enum(["customize", "intelligent"]).optional()
  ),
  klingMultiPrompt: z
    .array(
      z.object({
        prompt: z.string().min(1).max(4000),
        durationSeconds: z.coerce.number().optional(),
      })
    )
    .max(10)
    .optional(),

  // (Opcional) Si luego unificas nombres, estos quedan disponibles también:
  negativePrompt: z.string().max(2000).optional(),
  durationLabel: z.enum(["5s", "10s"]).optional(),
  cfgScale: z.coerce.number().min(0).max(2).optional(),
  mode: z.enum(["std", "pro"]).optional(),


  // ✅ Kling-only (Element Library): UUIDs de tu tabla public.kling_elements
  klingElementIds: z.array(z.string().uuid()).max(5).optional(),
});

export const RestyleSchema = z.object({
  imageDataUrl: Base64ImageSchema,
  prompt: z.string().min(1).max(4000),
  model: z.string().optional(),
});

export const FaceSwapSchema = z.object({
  sourceDataUrl: Base64ImageSchema,
  targetDataUrl: Base64ImageSchema,
  model: z.string().optional(),
});

export const UpscaleSchema = z.object({
  imageDataUrl: Base64ImageSchema,
  scale: z.number().int().min(2).max(8).default(2),
  model: z.string().optional(),
});

export const UploadAssetSchema = z.object({
  dataUrl: Base64ImageSchema,
  name: z.string().max(200).optional(),
  tool: z.string().max(50).optional(),
  type: z.enum(["image","video"]).optional(),
});

export const KlingElementImageSchema = z.union([
  z.object({ assetId: z.string().uuid() }),
  z.object({ dataUrl: z.string().min(20) }),
]);

export const CreateKlingElementRequestSchema = z.object({
  name: z.string().min(1).max(80),
  tag: z.string().optional(), // e.g. "character" | "object" | "scene" (depende de Kling)
  images: z.array(KlingElementImageSchema).min(1).max(4),
});

export const FalJobSchema = z.object({
  jobToken: z.string().min(10),
});

export const FalFinalizeSchema = z.object({
  jobToken: z.string().min(10),
  prompt: z.string().min(1).max(14000),
});
