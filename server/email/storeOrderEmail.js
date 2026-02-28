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

  // Cropped (dataUrl)
  if (payload?.croppedImageDataUrl && typeof payload.croppedImageDataUrl === "string") {
    const m = payload.croppedImageDataUrl.match(/^data:(.+);base64,(.+)$/);
    if (m) {
      const contentType = m[1];
      const b64 = m[2];
      const buf = Buffer.from(b64, "base64");
      const max = 20 * 1024 * 1024;
      if (buf.length <= max) {
        const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
        attachments.push({
          filename: `crop-${orderId}.${ext}`,
          content: buf,
          contentType,
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