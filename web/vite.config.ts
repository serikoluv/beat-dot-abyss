import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// base "./" なので GitHub Pages のサブパス・file://・Artifact のどこでも動く
export default defineConfig({
  base: "./",
  plugins: process.env.SINGLE ? [viteSingleFile()] : [],
});
