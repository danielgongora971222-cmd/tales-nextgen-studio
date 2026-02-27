export function base64urlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function base64urlDecodeToString(b64url) {
  const b64 = String(b64url || "").replace(/-/g, "+").replace(/_/g, "/");
  const mod = b64.length % 4;
  const padded = b64 + (mod ? "=".repeat(4 - mod) : "");
  return Buffer.from(padded, "base64").toString("utf8");
}
