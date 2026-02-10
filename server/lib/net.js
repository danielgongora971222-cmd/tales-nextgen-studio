export function getClientIp(req) {
  // Prioriza headers “reales” cuando estás detrás de proxies (Render/Cloudflare/Vercel)
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf) return cf;

  const trueClient = req.headers["true-client-ip"];
  if (typeof trueClient === "string" && trueClient) return trueClient;

  const vercelFwd = req.headers["x-vercel-forwarded-for"];
  if (typeof vercelFwd === "string" && vercelFwd)
    return vercelFwd.split(",")[0].trim();

  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff) return xff.split(",")[0].trim();

  return req.ip;
}
