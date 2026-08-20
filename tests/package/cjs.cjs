const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const { readBlocks, readText, readTree, renderSvg, writeBlocks } = require("rmscene-ts");

const data = readFileSync(path.join(__dirname, "../fixtures/paper-pro/paper-pro-empty.rm"));
const blocks = readBlocks(data);
const tree = readTree(data);

assert.ok(blocks.length > 0);
assert.deepEqual(writeBlocks(blocks), new Uint8Array(data));
assert.deepEqual(tree.sceneInfo?.paperSize, [1620, 2160]);
assert.equal(readText(tree), null);
assert.deepEqual(renderSvg(tree, { viewport: "paper" }).viewBox, { x: -810, y: 0, width: 1620, height: 2160 });
