import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(() => {
  return {
    server: {
      port: 3000,
      host: "0.0.0.0",
      proxy: {
        // Dev convenience: frontend calls /api/* and Vite proxies to the local API server.
        "/api": {
          target: "http://127.0.0.1:8080",
          changeOrigin: true,
        },
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
    esbuild: {
      legalComments: "none",
    },
    build: {
      target: "es2022",
      cssCodeSplit: true,
      sourcemap: false,
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (id.includes("react") || id.includes("react-dom") || id.includes("react-router")) return "vendor-react";
            if (id.includes("@react-three") || id.includes("three")) return "vendor-3d";
            if (id.includes("@supabase")) return "vendor-supabase";
            if (id.includes("@sentry")) return "vendor-observability";
            if (id.includes("lucide-react")) return "vendor-icons";
            return "vendor";
          },
        },
      },
    },
  };
});
