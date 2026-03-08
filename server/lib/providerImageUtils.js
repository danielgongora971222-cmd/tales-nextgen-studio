import sharp from "sharp";

function replaceExtensionWithPng(filename) {
  const base = String(filename || "image").replace(/\.[^.]+$/, "");
  return `${base}.png`;
}

export async function normalizeImageBufferForOpenAI(input) {
  const buffer = input?.buffer;
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    const err = new Error("Referencia visual vacía o inválida para OpenAI.");
    err.code = "OPENAI_REF_EMPTY";
    throw err;
  }

  try {
    const normalized = await sharp(buffer, {
      animated: false,
      failOnError: false,
      limitInputPixels: false,
    })
      .rotate()
      .toColorspace("srgb")
      .png()
      .toBuffer();

    return {
      buffer: normalized,
      mimeType: "image/png",
      filename: replaceExtensionWithPng(input?.filename || "reference.png"),
    };
  } catch (cause) {
    const err = new Error("No se pudo normalizar una referencia visual para OpenAI.");
    err.code = "OPENAI_REF_NORMALIZE_FAILED";
    err.details = {
      filename: input?.filename || null,
      mimeType: input?.mimeType || null,
      cause: cause?.message || String(cause),
    };
    throw err;
  }
}