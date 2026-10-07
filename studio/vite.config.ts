import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("./client", import.meta.url)),
  base: "/studio/dist/",
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    host: "127.0.0.1",
    port: 4317,
    proxy: {
      "/api": "http://127.0.0.1:4316",
      "/assets": "http://127.0.0.1:4316",
      "/poc": "http://127.0.0.1:4316",
    },
  },
});
