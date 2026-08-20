import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: false,
  clean: true,
  sourcemap: true,
  splitting: false,
  platform: "neutral",
  target: "es2022",
  outExtension({ format }) {
    if (format === "esm") return { js: ".js" };
    else if (format === "cjs") return { js: ".cjs" };
    else throw new Error(`Unknown output format: ${format}`);
  },
});
