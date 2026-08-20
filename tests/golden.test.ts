import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readBlocks, readText, readTree } from "../src/index.js";
import { canonicalStringify, normalizeResult } from "./helpers/normalize.js";

const fixtureRoot = fileURLToPath(new URL("fixtures", import.meta.url));
const goldenRoot = fileURLToPath(new URL("goldens", import.meta.url));
const cases = ["rmscene", "paper-pro"].flatMap((category) =>
  readdirSync(`${fixtureRoot}/${category}`)
    .filter((name) => name.endsWith(".rm"))
    .map((name) => ({ category, name })),
);

describe("rmscene golden compatibility", () => {
  it.each(cases)("matches $category/$name byte for byte", ({ category, name }) => {
    const data = readFileSync(`${fixtureRoot}/${category}/${name}`);
    const blocks = readBlocks(data);
    const tree = readTree(data);
    const document = readText(tree);
    const actual = canonicalStringify(normalizeResult(blocks, tree, document));
    const expected = readFileSync(`${goldenRoot}/${category}/${name}.json`, "utf8");
    expect(actual).toBe(expected);
  });
});
