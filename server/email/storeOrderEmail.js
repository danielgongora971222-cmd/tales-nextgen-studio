import { makeTransport } from "./mailer.js";

function safeStr(v) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function money(n) {
  const x = Number(n || 0);
  return `$${x.toFixed(2)}`;
}

async function fetchAsBuffer(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status}`);
  const ab = await resp.arrayBuffer();
  const buf = Buffer.from(ab);
  const contentType = resp.headers.get("content-type") || "application/octet-stream";
  return { buf, contentType };
}

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

async function tryCropWithSharp(assetUrl, cropNormalized) {
  // Import dinámico: si sharp no está instalado por alguna razón, no rompe todo el server.
  const { default: sharp } = await import("sharp");

  const { buf: originalBuf } = await fetchAsBuffer(assetUrl);

  const meta = await sharp(originalBuf, { failOnError: false }).metadata();
  if (!meta.width || !meta.height) throw new Error("No se pudo leer width/height de la imagen.");

  const x = Number(cropNormalized?.x) || 0;
  const y = Number(cropNormalized?.y) || 0;
  const w = Number(cropNormalized?.w) || 1;
  const h = Number(cropNormalized?.h) || 1;

  const left = clamp(Math.round(x * meta.width), 0, meta.width - 1);
  const top = clamp(Math.round(y * meta.height), 0, meta.height - 1);
  const width = clamp(Math.round(w * meta.width), 1, meta.width - left);
  const height = clamp(Math.round(h * meta.height), 1, meta.height - top);

  // Generamos JPG para mantener tamaño razonable
  const out = await sharp(originalBuf, { failOnError: false })
    .extract({ left, top, width, height })
    .jpeg({ quality: 92 })
    .toBuffer();

  return { buf: out, contentType: "image/jpeg", ext: "jpg" };
}

export async function sendStoreOrderEmail({ orderId, payload }) {
  const transport = makeTransport();
  if (!transport) {
    return { sent: false, reason: "SMTP not configured" };
  }

  const factoryEmail = process.env.FACTORY_EMAIL;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  if (!factoryEmail || !from) {
    return { sent: false, reason: "FACTORY_EMAIL/SMTP_FROM missing" };
  }

  const customerEmail = safeStr(payload?.delivery?.email);
  const subject = `1NationUp Order ${orderId} — ${safeStr(payload?.materialLabel)} / ${safeStr(payload?.size?.label)}`;

  // Adjuntos: original (si < 20MB) + recorte (si viene)
  const attachments = [];
    let cropCid = null;

  // Original
  try {
    const { buf, contentType } = await fetchAsBuffer(payload.assetUrl);
    const max = 20 * 1024 * 1024; // 20MB
    if (buf.length <= max) {
      const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
      attachments.push({
        filename: `original-4k-${orderId}.${ext}`,
        content: buf,
        contentType,
      });
    }
  } catch {
    // si falla, igual mandamos link en el HTML
  }

  // Cropped — preferimos recorte server-side con sharp (assetUrl + cropNormalized)
  // y si falla, usamos croppedImageDataUrl como plan B.
  const max = 20 * 1024 * 1024; // 20MB

  // 1) Intento: sharp + cropNormalized
  if (payload?.assetUrl && payload?.cropNormalized) {
    try {
      const cropped = await tryCropWithSharp(payload.assetUrl, payload.cropNormalized);
      if (cropped.buf.length <= max) {
        cropCid = `crop-${orderId}@1nationup`;
        attachments.push({
          filename: `crop-${orderId}.${cropped.ext}`,
          content: cropped.buf,
          contentType: cropped.contentType,
          cid: cropCid,
        });
      }
    } catch {
      // fallamos y seguimos al plan B (dataUrl)
    }
  }

  // 2) Plan B: dataUrl (lo que ya hacías)
  if (!cropCid && payload?.croppedImageDataUrl && typeof payload.croppedImageDataUrl === "string") {
    const m = payload.croppedImageDataUrl.match(/^data:(.+);base64,(.+)$/);
    if (m) {
      const contentType = m[1];
      const b64 = m[2];
      const buf = Buffer.from(b64, "base64");
      if (buf.length <= max) {
        const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
        cropCid = `crop-${orderId}@1nationup`;
        attachments.push({
          filename: `crop-${orderId}.${ext}`,
          content: buf,
          contentType,
          cid: cropCid,
        });
      }
    }
  }

  const html = `
  <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height: 1.45">
    <h2 style="margin: 0 0 10px">New Print Order — <span style="font-family: ui-monospace, Menlo, Consolas">${orderId}</span></h2>
    <p style="margin: 0 0 16px; color: #444">This email contains the full production payload for the factory.</p>

    <h3 style="margin: 18px 0 8px">Customer</h3>
    <ul style="margin: 0 0 12px">
      <li><b>Name:</b> ${safeStr(payload?.delivery?.customerName)}</li>
      <li><b>Email:</b> ${safeStr(payload?.delivery?.email)}</li>
      <li><b>Phone:</b> ${safeStr(payload?.delivery?.phone)}</li>
      <li><b>Method:</b> ${safeStr(payload?.delivery?.method)}</li>
      ${
        payload?.delivery?.method === "ship"
          ? `<li><b>Address:</b> ${safeStr(payload?.delivery?.address1)}, ${safeStr(payload?.delivery?.city)}, ${safeStr(payload?.delivery?.state)} ${safeStr(payload?.delivery?.zip)}</li>`
          : `<li><b>Pickup:</b> Miami</li>`
      }
    </ul>

    <h3 style="margin: 18px 0 8px">Product</h3>
    <ul style="margin: 0 0 12px">
      <li><b>Material:</b> ${safeStr(payload?.materialLabel)} (${safeStr(payload?.material)})</li>
      <li><b>Size:</b> ${safeStr(payload?.size?.label)} (${safeStr(payload?.size?.wIn)}" x ${safeStr(payload?.size?.hIn)}")</li>
      <li><b>Fit Mode:</b> ${safeStr(payload?.fitMode)}</li>
      <li><b>Original Image:</b> <a href="${safeStr(payload?.assetUrl)}">link</a></li>
      <li><b>Image Dims:</b> ${safeStr(payload?.imageDims?.w)}×${safeStr(payload?.imageDims?.h)}</li>
    </ul>

    <h3 style="margin: 18px 0 8px">Crop</h3>

    ${
      cropCid
        ? `
          <div style="margin: 0 0 12px; padding: 12px; border: 1px solid #ddd; border-radius: 12px;">
            <div style="font-weight: 700; margin-bottom: 8px;">Cropped preview (exact framing)</div>
            <img src="cid:${cropCid}" alt="Cropped preview" style="max-width: 520px; width: 100%; border-radius: 10px; border: 1px solid #eee;" />
            <div style="margin-top: 8px; color: #555; font-size: 12px;">
              También se adjunta como archivo: <b>crop-${orderId}.*</b>
            </div>
          </div>
        `
        : `
          <div style="margin: 0 0 12px; padding: 12px; border: 1px solid #f3c5c5; border-radius: 12px; background: #fff7f7;">
            <div style="font-weight: 700; margin-bottom: 6px;">Cropped preview not attached</div>
            <div style="color:#555; font-size: 12px;">
              No se pudo generar el recorte como imagen (probable CORS del storage). Se incluyen coordenadas para reproducir el recorte.
            </div>
          </div>
        `
    }

    <p style="margin: 0 0 12px; color: #333">
      ${
        payload?.cropNormalized
          ? `Normalized crop: x=${payload.cropNormalized.x}, y=${payload.cropNormalized.y}, w=${payload.cropNormalized.w}, h=${payload.cropNormalized.h}`
          : "No cropNormalized provided."
      }
    </p>

    <h3 style="margin: 18px 0 8px">Pricing</h3>
    <ul style="margin: 0 0 12px">
      <li><b>Base:</b> ${money(payload?.pricing?.basePrice)}</li>
      <li><b>Shipping:</b> ${money(payload?.pricing?.shipping)}</li>
      <li><b>Add-ons:</b> ${money(payload?.pricing?.smartFillAddon)}</li>
      <li><b>Total:</b> ${money(payload?.pricing?.total)}</li>
    </ul>

    <h3 style="margin: 18px 0 8px">Notes</h3>
    <div style="white-space: pre-wrap; background: #f7f7f7; padding: 10px; border-radius: 8px">${safeStr(payload?.notes)}</div>

    <p style="margin-top: 18px; color: #666; font-size: 12px">
      If attachments are missing due to size limits, use the image link(s).
    </p>
  </div>
  `;

  // Enviar a fábrica y cc al cliente (si quieres)
  const to = factoryEmail;
  const cc = customerEmail ? customerEmail : undefined;

  await transport.sendMail({
    from,
    to,
    cc,
    subject,
    html,
    attachments,
  });

  return { sent: true };
}