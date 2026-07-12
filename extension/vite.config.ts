import { defineConfig } from "vite";
import { resolve } from "node:path";

const root = resolve(__dirname, "src");

export default defineConfig({
  root,
  publicDir: resolve(__dirname, "public"),
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/lib"),
    },
  },
  build: {
    outDir: resolve(__dirname, "dist-build"),
    emptyOutDir: true,
    minify: "esbuild",
    sourcemap: true,
    target: "es2022",
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background/service-worker.ts"),
        content: resolve(__dirname, "src/content/detector.ts"),
        popup: resolve(__dirname, "src/popup.html"),
        options: resolve(__dirname, "src/options.html"),
        welcome: resolve(__dirname, "src/welcome.html"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name][extname]",
        format: "esm",
        inlineDynamicImports: false,
      },
    },
  },
});
