# AI Pricing Audit — 2026-03-13

## Regla global implementada

- `1 USD = 222 créditos`
- `precio_en_créditos = ceil(coste_fal_usd × 222 × 1.35)`
- El `1.35` aplica el markup operativo del 35% sobre el coste base del proveedor.

## Modelos de imagen detectados en el repo

### Generación / edición principal
- `gemini-2.5-flash-image`
- `gemini-3.1-flash-image-preview`
- `gemini-3-pro-image-preview`
- `openai:gpt-image-1.5`
- `openai:gpt-image-1.5-high`
- `fal-ai/flux-2-max`
- `fal-ai/flux-2-pro`
- `fal-ai/flux-2-flex`
- `kling:kling-image-o1`
- `fal-ai/kling-image/v3/text-to-image`
- `fal-ai/kling-image/o3/image-to-image`
- `fal-ai/qwen-image-edit-2511-multiple-angles`
- `imagen-3.0-generate-002`

### Flujos especializados
- FaceSwap análisis: `gemini-3.1-flash-image-preview` × 3 (`depth`, `canny`, `openpose`)
- FaceSwap inserción: `gemini-3-pro-image-preview` × 1
- Upscaler / Lightroom / Restyle usan el mismo pricing por modelo + resolución

## Modelos de video detectados en el repo

### Video generator principal
- `veo-3.0-generate-001`
- `veo-3.0-fast-generate-001`
- `veo-3.1-generate-preview`
- `veo-3.1-fast-generate-preview`
- `kling-v2-5-turbo`
- `kling-v2-6`
- `kling-v3`
- `kling-o3-pro`

### Flujos especializados
- `kling-o3-ref-to-video-pro`
- `kling-o3-edit-video-pro`
- `kling-o3-ref-video-to-video-pro`
- `kling-v3-motion-control`
- `kling-v3-motion-control-pro`
- `kling-2.6-motion-control`
- `kling-2.6-motion-control-pro`

## Fórmulas implementadas

### Imagen
- Gemini 2.5 Flash Image: fijo por imagen
- Gemini 3.1 Flash Image Preview: `1K / 2K / 4K`
- Gemini 3 Pro Image Preview: `1K / 2K / 4K`
- GPT Image 1.5: por tier (`auto≈medium`, `high`) y aspect ratio OpenAI
- Flux 2 Max: `0.07` primer MP + `0.03` por MP extra
- Flux 2 Pro: `0.03` primer MP + `0.015` por MP extra
- Flux 2 Flex: `0.05` por MP de output (baseline estable)
- Kling Image O1 / V3 / O3: fijo por imagen, 4K = doble
- Qwen Multiple Angles: `0.035` por MP
- Imagen 3: fijo por imagen

### Video
- Veo 3 / Veo 3 Fast: por segundo, con soporte para audio on/off
- Veo 3.1 / 3.1 Fast: por segundo, diferenciando `720p/1080p` vs `4k`
- Kling 2.5 Turbo: por segundo
- Kling 2.6: por segundo, con audio on/off
- Kling V3: por segundo, diferenciando `std` vs `pro`, audio y voice control
- Kling O3: por segundo, diferenciando `std` vs `pro` y audio
- Reference/Edit video pro: por segundo según endpoint especializado
- Motion Control: por segundo según `std` o `pro`

## Ajustes de infraestructura realizados

- `config/pricing.js` pasó a ser una matriz de pricing basada en FAL + markup.
- `server/routes/ai/video.js` ahora cobra usando resolución/audio/modo/voice-control cuando aplica.
- `server/server.js` dejó de tener cobros legacy fijos de `1 crédito` en FaceSwap y Upscale.
- El estimador frontend ahora coincide mejor con backend para video y para OpenAI image según aspect ratio.
- Se agregó patch SQL para que planes y topups sigan la regla `1 USD = 222 créditos`.

## Nota operativa

Este ajuste no recalcula saldos históricos ya existentes en `wallet_balances`; corrige el pricing futuro y la oferta de planes/topups.
