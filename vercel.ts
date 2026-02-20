import { routes, type VercelConfig } from "@vercel/config/v1";

const API_ORIGIN = process.env.API_ORIGIN || "https://tales-nextgen-studio-1.onrender.com";

export const config: VercelConfig = {
  rewrites: [
    routes.rewrite("/api/(.*)", `${API_ORIGIN}/api/$1`),
    routes.rewrite("/(.*)", "/index.html"),
  ],
};