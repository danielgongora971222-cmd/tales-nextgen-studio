// services/apiBase.ts
// Permite usar API por mismo origen ("/api") o por dominio externo (VITE_API_BASE_URL).
// - En DEV: normalmente VITE_API_BASE_URL vacío y Vite proxy maneja /api.
// - En Vercel/Prod: configura VITE_API_BASE_URL = "https://tu-api.onrender.com"

const rawBase = (import.meta as any)?.env?.VITE_API_BASE_URL;
const base =
  typeof rawBase === "string" && rawBase.trim()
    ? rawBase.trim().replace(/\/+$/g, "")
    : "";

export function apiUrl(path: string): string {
  const p = String(path || "");

  // Si ya es URL absoluta, no tocamos.
  if (/^https?:\/\//i.test(p)) return p;

  // Normaliza a "/..."
  const normalized = p.startsWith("/") ? p : `/${p}`;

  // Si no hay base configurada, usamos mismo origen.
  if (!base) return normalized;

  return `${base}${normalized}`;
}