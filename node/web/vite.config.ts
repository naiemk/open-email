import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: resolve(__dirname),
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@client": resolve(__dirname, "../../client/src"),
    },
  },
  server: {
    proxy: {
      "/meta": "http://127.0.0.1:8787",
      "/signup": "http://127.0.0.1:8787",
      "/api": "http://127.0.0.1:8787",
      "/bootstrap": "http://127.0.0.1:8787",
      "/index": "http://127.0.0.1:8787",
      "/blobs": "http://127.0.0.1:8787",
      "/storage": "http://127.0.0.1:8787",
      "/trash": "http://127.0.0.1:8787",
      "/empty-trash": "http://127.0.0.1:8787",
      "/send": "http://127.0.0.1:8787",
      "/pair": "http://127.0.0.1:8787",
      "/pay": "http://127.0.0.1:8787",
    },
  },
});
