import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { readBlocks, readText, readTree, renderSvg, writeBlocks } from "rmscene-ts";

const data = readFileSync(new URL("../fixtures/paper-pro/paper-pro-empty.rm", import.meta.url));
const blocks = readBlocks(data);
const tree = readTree(data);

assert.ok(blocks.length > 0);
assert.deepEqual(writeBlocks(blocks), new Uint8Array(data));
assert.deepEqual(tree.sceneInfo?.paperSize, [1620, 2160]);
assert.equal(readText(tree), null);
assert.deepEqual(renderSvg(tree, { viewport: "paper" }).viewBox, { x: -810, y: 0, width: 1620, height: 2160 });
