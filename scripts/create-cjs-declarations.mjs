import { readdir, readFile, writeFile } from "node:fs/promises";

const directory = new URL("../dist/", import.meta.url);
const files = (await readdir(directory)).filter((name) => name.endsWith(".d.ts"));

await Promise.all(
  files.map(async (name) => {
    const source = await readFile(new URL(name, directory), "utf8");
    const declaration = source
      .replaceAll(/(\.\/[^"]+)\.js"/g, "$1.cjs\"")
      .replace(/\n\/\/# sourceMappingURL=.*\n?$/, "\n");
    await writeFile(new URL(name.replace(/\.d\.ts$/, ".d.cts"), directory), declaration, "utf8");
  }),
);
