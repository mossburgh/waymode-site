import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "demo",
  base: "/showcase/",
  build: {
    outDir: resolve("public/showcase"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        product: resolve("demo/product.html"),
        studio: resolve("demo/studio.html"),
      },
    },
  },
});
