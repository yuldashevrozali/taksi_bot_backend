import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Served by the backend under /app/ ; a standalone deploy (Vercel) sets VITE_BASE=/
  base: process.env.VITE_BASE ?? "/app/",
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false, target: "es2022" },
});
