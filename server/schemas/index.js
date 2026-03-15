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
  gridMode: z.enum(["none", "2x2", "2x3", "3x3", "4x4", "3x4"]).optional(),
  googleSearchGrounding: z.boolean().optional(),

  tool: z.string().optional(),      // ej: "image-generator"
  nameHint: z.string().optional(),  // ej: "generated"

  // Referencias por Asset IDs (opcional)
  characterAssetIds: z.array(z.string()).max(12).optional(),

  // legacy/manual style asset
  styleAssetId: z.string().optional(),

  // nuevo flujo de preset visual
  stylePresetId: z.string().max(120).optional(),
  stylePresetName: z.string().max(200).optional(),
  styleReferenceDataUrl: Base64ImageSchema.optional(),

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
  sync: z.boolean().optional(),
  async: z.boolean().optional(),
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

  // Idempotencia (Queue): permite reintentos sin crear jobs duplicados
  clientJobId: z.string().max(120).optional(),

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
    z.enum(["customize", "intelligent", "intelligence"]).optional()
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

  // std = 720p, pro = 1080p (lo mapeamos así en el handler)
  mode: z.enum(["std", "pro"]).optional(),
  model: z.enum(["kling-2.6-motion-control", "kling-v3-motion-control"]).optional(),

  async: z.boolean().optional(),
  tool: z.string().optional(),
  nameHint: z.string().optional(),
  clientJobId: z.string().max(120).optional(),
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

  // Reference-to-video (legacy frames)
  // ✅ Aceptamos null para evitar 400 si el cliente manda `null` (se tratará como "no enviado").
  startImageAssetId: z.string().uuid().nullable().optional(),
  endImageAssetId: z.string().uuid().nullable().optional(),

  // Video-to-video (reference)
  videoAssetId: z.string().uuid().optional(),

  // Refs (la validación real por modelo se hace en la ruta)
  // - reference-to-video: 1..7 combinadas (imágenes + Elements)
  // - video-to-video:     0..4 combinadas (imágenes + Elements)
  referenceImageAssetIds: z.array(z.string().uuid()).max(7).optional(),
  klingElementIds: z.array(z.string().uuid()).max(7).optional(),

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

export const RestyleSchema = z
  .object({
    // ✅ Preferido (evita mandar base64 gigante al API)
    sourceAssetId: z.string().uuid().optional(),

    // ⚠️ Legacy (se mantiene para compatibilidad, pero NO recomendado para async)
    imageDataUrl: Base64ImageSchema.optional(),

    prompt: z.string().min(1).max(4000),
    model: z.string().optional(),

    // control de timeout: por defecto async
    sync: z.boolean().optional(),
    async: z.boolean().optional(),
  })
  .refine((v) => Boolean(v.sourceAssetId || v.imageDataUrl), {
    message: "Provide sourceAssetId or imageDataUrl",
    path: ["sourceAssetId"],
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

  // control de timeout: por defecto async
  sync: z.boolean().optional(),
  async: z.boolean().optional(),
});

export const FaceSwapAnalysisStageSchema = z.object({
  targetAssetId: z.string().uuid(),
  swapType: z.enum(["face", "face_hair", "body", "body_clothes", "clothes_only"]).default("face"),
  quality: z.enum(["1K", "2K", "4K"]).default("2K"),
  analysisKind: z.enum(["depth", "canny", "openpose"]),

  // control de timeout: por defecto async
  sync: z.boolean().optional(),
  async: z.boolean().optional(),
});

export const FaceSwapInsertSchema = z
  .object({
    baseAssetId: z.string().uuid().nullish(),
    depthAssetId: z.string().uuid().nullish(),
    cannyAssetId: z.string().uuid().nullish(),
    openposeAssetId: z.string().uuid().nullish(),
    donorElementId: z.string().uuid(),
    swapType: z.enum(["face", "face_hair", "body", "body_clothes", "clothes_only"]).default("face"),
    quality: z.enum(["1K", "2K", "4K"]).default("2K"),

    // control de timeout: por defecto async
    sync: z.boolean().optional(),
    async: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    const hasLegacyBase = Boolean(val.baseAssetId);
    const hasBundle = Boolean(val.depthAssetId && val.cannyAssetId && val.openposeAssetId);

    if (!hasLegacyBase && !hasBundle) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["depthAssetId"],
        message: "Provide baseAssetId or the trio depthAssetId + cannyAssetId + openposeAssetId",
      });
    }
  });

export const UpscaleSchema = z
  .object({
    // ✅ Preferido (evita mandar base64 gigante al API)
    imageAssetId: z.string().uuid().optional(),

    // ⚠️ Legacy (se mantiene para compatibilidad, pero NO recomendado para async)
    imageDataUrl: Base64ImageSchema.optional(),

    scale: z.number().int().min(2).max(8).default(2),
    model: z.string().optional(),

    // control de timeout: por defecto async
    sync: z.boolean().optional(),
    async: z.boolean().optional(),
  })
  .refine((v) => Boolean(v.imageAssetId || v.imageDataUrl), {
    message: "Provide imageAssetId or imageDataUrl",
    path: ["imageAssetId"],
  });

export const UploadAssetSchema = z.object({
  dataUrl: z.string().optional(),
  name: z.string().optional(),
  tool: z.string().optional(),
  category: z.string().optional(),
  type: z.enum(["image", "video"]).optional(),
  meta: z.record(z.any()).optional(),
});

export const StoreOrderSchema = z.object({
  assetId: z.string().min(1),
  assetUrl: z.string().min(1),
  assetName: z.string().optional(),

  imageDims: z.object({ w: z.number().int().nonnegative(), h: z.number().int().nonnegative() }).nullable().optional(),
  require4k: z.literal(true),

  material: z.enum(["metal", "acrylic", "canvas", "paper"]),
  materialLabel: z.string().min(1),

  size: z.object({
    id: z.string().min(1),
    wIn: z.number().positive(),
    hIn: z.number().positive(),
    label: z.string().min(1),
  }),

  fitMode: z.enum(["perfect", "crop", "smart_fill"]),
  crop: z
    .object({
      x: z.number(),
      y: z.number(),
      scale: z.number().min(1).max(5),
    })
    .nullable()
    .optional(),

  // NUEVO: crop normalizado (0..1) para fábrica / reproducibilidad
  cropNormalized: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      w: z.number().min(0).max(1),
      h: z.number().min(0).max(1),
    })
    .nullable()
    .optional(),

  // NUEVO: imagen recortada (dataUrl base64) para adjuntar al correo (best-effort)
  croppedImageDataUrl: Base64ImageSchema.optional(),

  pricing: z.object({
    basePrice: z.number().nonnegative(),
    shipping: z.number().nonnegative(),
    smartFillAddon: z.number().nonnegative(),
    total: z.number().nonnegative(),
  }),

  artDeco: z
    .object({
      listingId: z.string().uuid(),
      sellerId: z.string().uuid().nullable().optional(),
      sellerUsername: z.string().optional(),
      salePriceUsd: z.number().positive(),
      basePriceUsd: z.number().nonnegative(),
      sellerProfitUsd: z.number().nonnegative(),
      currency: z.string().min(3).max(8).default("USD"),
    })
    .optional(),

  delivery: z.object({
    method: z.enum(["ship", "pickup"]),
    customerName: z.string().min(1),
    email: z.string().min(3),
    phone: z.string().min(3),

    address1: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    zip: z.string().nullable().optional(),
  }),

  notes: z.string().optional(),

  flags: z
    .object({
      smartFillIsPlaceholder: z.boolean().optional(),
    })
    .optional(),
});

export const PresignUploadSchema = z.object({
  tool: z.string().optional(),
  name: z.string().optional(),
  category: z.string().optional(),
  type: z.enum(["image", "video"]).optional(),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive().optional(),
  expiresSeconds: z.number().int().positive().max(3600).optional(),
});

export const CompleteUploadSchema = z.object({
  storagePath: z.string().min(1),
  tool: z.string().optional(),
  name: z.string().optional(),
  category: z.string().optional(),
  type: z.enum(["image", "video"]).optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().positive().optional(),
  meta: z.record(z.any()).optional(),
});

export const KlingElementImageSchema = z.union([
  z.object({ assetId: z.string().uuid() }),
  z.object({ dataUrl: z.string().min(20) }),
]);

export const KlingElementVideoSchema = z.object({
  assetId: z.string().uuid(),
});

export const CreateKlingElementRequestSchema = z
  .object({
    name: z.string().min(1).max(20),
    description: z.string().max(100).optional(),
    tag: z.string().optional(),

    // Kling Advanced: image_refer | video_refer
    referenceType: z.enum(["image_refer", "video_refer"]).optional(),

    // Kling Advanced: bind manual de voz (opcional)
    voiceId: z.string().min(1).max(128).optional(),

    // image_refer
    images: z.array(KlingElementImageSchema).min(1).max(4).optional(),

    // video_refer (solo assetId; NO dataUrl por tamaño)
    video: KlingElementVideoSchema.optional(),
  })
  .superRefine((val, ctx) => {
    const ref = val.referenceType || (val.video ? "video_refer" : "image_refer");

    if (ref === "video_refer") {
      if (!val.video?.assetId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "referenceType=video_refer requiere video.assetId",
          path: ["video"],
        });
      }
      return;
    }

    // image_refer
    if (!val.images || val.images.length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "referenceType=image_refer requiere images (1–4)",
        path: ["images"],
      });
    }
  });

export const FalJobSchema = z.object({
  jobToken: z.string().min(10),
});

export const FalFinalizeSchema = z.object({
  jobToken: z.string().min(10),
  prompt: z.string().min(1).max(14000),
});

export const CreateCommentSchema = z.object({
  text: z.string().trim().min(1).max(500),
});
