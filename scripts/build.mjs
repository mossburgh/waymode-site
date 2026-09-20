import { build } from "vite";
await build({ configFile: "vite.showcase.config.mjs" });
await build({
  configFile: false,
  publicDir: false,
  build: {
    outDir: "public/waymode",
    emptyOutDir: true,
    lib: {
      entry: { navbar: "site/navbar.js", runtime: "site/runtime.js" },
      formats: ["es"],
      fileName: (_format, name) => `${name}.js`,
    },
  },
});
