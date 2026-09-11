import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/labomapa/",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist-pages",
    emptyOutDir: true,
  },
});
