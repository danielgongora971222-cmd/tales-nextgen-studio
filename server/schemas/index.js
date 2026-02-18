import { z } from "zod";

// Centralizamos los schemas Zod para que server.js no sea monolítico.
// Importa lo que necesites desde: server/schemas/index.js

export const Base64ImageSchema = z
  .string()
  .min(10)
  .refine((v) => v.startsWith("data:image/"), "Expected a data:image/*;base64,... dataUrl");

export const Base64MediaSchema = z
  .string()
  .min(10)
  .refine(
    (v) => /^data:(image|video)\/[^;]+;base64,/.test(v),
    "Expected a data:image/*;base64,... or data:video/*;base64,... dataUrl"
  );

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

  // ✅ Token -> Asset binding for robust @mentions in prompt
  // Example: [{ token:"@img1", assetId:"uuid", role:"character" }]
  promptReferences: z
    .array(
      z.object({
        token: z.string().min(2).max(64),
        assetId: z.string().uuid(),
        role: z.enum(["character", "background", "element"]),
      })
    )
    .max(20)
    .optional(),

  // ✅ Kling-only (Element Library): IDs UUID de tu tabla public.kling_elements
  // (estos NO son los element_id bigint que devuelve Kling)
  klingElementIds: z.array(z.string().uuid()).max(5).optional(),


    // ✅ Camera Angles (Qwen Multiple Angles, Fal.ai)
  // Ranges basados en la doc del endpoint:
  // - horizontal_angle: 0..360 (0=front, 90=right, 180=back, 270=left)
  // - vertical_angle:  -30..90 (-30=low, 0=eye-level, 90=top-down)
  // - zoom:           0..10  (0=wide, 10=close)
  // - lora_scale:     0..4   (strength)
  horizontalAngle: z.number().min(0).max(360).optional(),
  verticalAngle: z.number().min(-30).max(90).optional(),
  zoom: z.number().min(0).max(10).optional(),
  loraScale: z.number().min(0).max(4).optional(),
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


export const MotionControlRequestSchema = z.object({
  prompt: z.string().max(14000).optional(),
  imageAssetId: z.string().uuid(),
  videoAssetId: z.string().uuid(),
  keepOriginalSound: z.boolean().optional(),
  characterOrientation: z.enum(["image", "video"]).optional(),
  async: z.boolean().optional(),
  tool: z.string().optional(),
  nameHint: z.string().optional(),
});

// ===============================
// Video Edit (Kling O3 Pro) - async Fal
// POST /api/ai/video/edit
// ===============================
export const VideoEditRequestSchema = z.object({
  // Selector de modelos (mapeado en el server a Fal endpointId)
  model: z.enum([
    "kling-o3-ref-to-video-pro",
    "kling-o3-edit-video-pro",
    "kling-o3-ref-video-to-video-pro",
  ]),

  // Prompt / Multishot (solo aplica a reference-to-video)
  prompt: z.string().max(14000).optional(),
  klingMultiPrompt: z
    .array(
      z.object({
        prompt: z.string().min(1).max(4000),
        durationSeconds: z.coerce.number().optional(),
      })
    )
    .max(10)
    .optional(),

  // Reference-to-video (frames)
  startImageAssetId: z.string().uuid().optional(),
  endImageAssetId: z.string().uuid().optional(),

  // Video-to-video (reference)
  videoAssetId: z.string().uuid().optional(),

  // Refs (máximo recomendado: 4 combinadas con Elements)
  referenceImageAssetIds: z.array(z.string().uuid()).max(4).optional(),
  klingElementIds: z.array(z.string().uuid()).max(5).optional(),

  // Opciones
  generateAudio: z.boolean().optional(), // reference-to-video
  keepAudio: z.boolean().optional(), // video-to-video
  durationSeconds: z.coerce.number().optional(),
  aspectRatio: z.enum(["auto", "16:9", "9:16", "1:1"]).optional(),

  // Identidad en assets
  toolName: z.string().optional(),
  hint: z.string().optional(),
  async: z.boolean().optional(),
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

export const FaceSwapMannequinSchema = z.object({
  targetAssetId: z.string().uuid(),
  swapType: z.enum(["face", "face_hair", "body", "body_clothes", "clothes_only"]).default("face"),
  quality: z.enum(["1K", "2K", "4K"]).default("2K"),
});

export const FaceSwapInsertSchema = z.object({
  baseAssetId: z.string().uuid(),
  donorElementId: z.string().uuid(),
  swapType: z.enum(["face", "face_hair", "body", "body_clothes", "clothes_only"]).default("face"),
  quality: z.enum(["1K", "2K", "4K"]).default("2K"),
});

export const UpscaleSchema = z.object({
  imageDataUrl: Base64ImageSchema,
  scale: z.number().int().min(2).max(8).default(2),
  model: z.string().optional(),
});

export const UploadAssetSchema = z.object({
  dataUrl: Base64MediaSchema,
  name: z.string().max(200).optional(),
  tool: z.string().max(50).optional(),
  category: z.string().max(50).optional(),
  type: z.enum(["image","video"]).optional(),
});

export const KlingElementImageSchema = z.union([
  z.object({ assetId: z.string().uuid() }),
  z.object({ dataUrl: z.string().min(20) }),
]);

export const CreateKlingElementRequestSchema = z.object({
  name: z.string().min(1).max(20),
  tag: z.string().optional(),
  images: z.array(KlingElementImageSchema).min(1).max(4),
});

export const FalJobSchema = z.object({
  jobToken: z.string().min(10),
});

export const FalFinalizeSchema = z.object({
  jobToken: z.string().min(10),
  prompt: z.string().min(1).max(14000),
});
