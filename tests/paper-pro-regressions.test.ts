import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  readBlocks,
  readText,
  readTree,
  type Block,
  type ReadWarning,
  type SceneLineItemBlock,
} from "../src/index.js";
import { HEADER_V6 } from "../src/scene-stream.js";

const fixtureDirectory = fileURLToPath(new URL("fixtures/paper-pro", import.meta.url));

function fixture(name: string): Uint8Array {
  return readFileSync(`${fixtureDirectory}/${name}`);
}

function lineBlocks(blocks: readonly Block[]): SceneLineItemBlock[] {
  return blocks.filter((block): block is SceneLineItemBlock => block.kind === "sceneLineItem");
}

describe("Paper Pro regressions", () => {
  it("contains only deterministic sanitized identity and text values", () => {
    for (const name of readdirSync(fixtureDirectory).filter((entry) => entry.endsWith(".rm"))) {
      for (const block of readBlocks(fixture(name))) {
        if (block.kind === "authorIds") {
          const uuids = block.authorUuids.map((entry) => entry.uuid).sort();
          const expected = Array.from({ length: uuids.length }, (_, index) =>
            `00000000-0000-0000-0000-${(index + 1).toString(16).padStart(12, "0")}`,
          );
          expect(uuids).toEqual(expected);
        } else if (block.kind === "treeNode") expect(block.group.label.value).toMatch(/^Layer \d+$/);
        else if (block.kind === "sceneGlyphItem" && block.item.value !== null)
          expect(block.item.value.text).toMatch(/^[x\n]*$/u);
        else if (block.kind === "rootText") {
          for (const item of block.value.items.sequenceItems()) {
            if (typeof item.value === "string") expect(item.value).toMatch(/^[x\n]*$/u);
          }
        }
      }
    }
  });

  it("retains 111 SceneInfo trailing bytes and continues", () => {
    const warnings: ReadWarning[] = [];
    const blocks = readBlocks(fixture("paper-pro-empty.rm"), { onWarning: (warning) => warnings.push(warning) });
    const sceneInfo = blocks.find((block) => block.kind === "sceneInfo");
    expect(sceneInfo?.extraData).toHaveLength(111);
    expect(warnings).toContainEqual({
      kind: "trailing-data",
      message: "111 unread bytes remain in block type 13",
      blockType: 13,
    });
    expect(blocks.findIndex((block) => block.kind === "sceneInfo")).toBeLessThan(blocks.length - 1);
    expect(blocks.filter((block) => block.kind === "unreadable")).toEqual([]);
  });

  it("retains 18 RootText trailing bytes and continues", () => {
    const blocks = readBlocks(fixture("paper-pro-text-highlighter-overflow.rm"));
    const rootText = blocks.find((block) => block.kind === "rootText");
    expect(rootText?.extraData).toHaveLength(18);
    expect(blocks.filter((block) => block.kind === "unreadable")).toEqual([]);
  });

  it("retains nine nested line-value tails", () => {
    const warnings: ReadWarning[] = [];
    const blocks = readBlocks(fixture("paper-pro-shader-nested-extra.rm"), {
      onWarning: (warning) => warnings.push(warning),
    });
    const nested = lineBlocks(blocks).filter((block) => block.extraValueData.byteLength > 0);
    expect(nested).toHaveLength(9);
    expect(nested.every((block) => block.extraValueData.byteLength === 5)).toBe(true);
    expect(warnings.filter((warning) => warning.message === "5 unread bytes remain in subblock 6")).toHaveLength(9);
  });

  it("recognizes Paper Pro tool 23 as SHADER", () => {
    const blocks = readBlocks(fixture("paper-pro-shader-nested-extra.rm"));
    const shaderLines = lineBlocks(blocks).filter((block) => block.item.value?.tool.value === 23);
    expect(shaderLines.length).toBeGreaterThan(0);
    expect(shaderLines.every((block) => block.item.value?.tool.name === "SHADER")).toBe(true);
  });

  it("retains truly unknown tool and color values", () => {
    const data = fixture("paper-pro-text-highlighter-overflow.rm").slice();
    const pattern = Uint8Array.of(0x14, 0x0f, 0, 0, 0, 0x24, 0, 0, 0, 0);
    const offset = findBytes(data, pattern);
    expect(offset).toBeGreaterThanOrEqual(HEADER_V6.byteLength);
    data.set(Uint8Array.of(0xff, 0, 0, 0), offset + 1);
    data.set(Uint8Array.of(0xfe, 0, 0, 0), offset + 6);
    const warnings: ReadWarning[] = [];
    const blocks = readBlocks(data, { onWarning: (warning) => warnings.push(warning) });
    const unknown = lineBlocks(blocks).find((block) => block.item.value?.tool.value === 255);
    expect(unknown?.item.value?.tool).toEqual({ value: 255 });
    expect(unknown?.item.value?.color).toEqual({ value: 254 });
    expect(warnings.some((warning) => warning.kind === "unknown-pen")).toBe(true);
    expect(warnings.some((warning) => warning.kind === "unknown-color")).toBe(true);
  });

  it("reads both observed paper sizes from SceneInfo", () => {
    expect(readTree(fixture("paper-pro-empty.rm")).sceneInfo?.paperSize).toEqual([1620, 2160]);
    expect(readTree(fixture("paper-pro-text-formatting.rm")).sceneInfo?.paperSize).toEqual([1404, 1872]);
  });

  it("exposes highlighter palette id and actual RGBA", () => {
    const blocks = readBlocks(fixture("paper-pro-text-highlighter-overflow.rm"));
    const highlighted = lineBlocks(blocks).find((block) => block.item.value?.colorRgba !== undefined);
    expect(highlighted?.item.value?.color).toEqual({ value: 9, name: "HIGHLIGHT" });
    expect(highlighted?.item.value?.colorRgba).toEqual([255, 237, 117, 255]);
  });

  it("reports centered and overflowing coordinates unchanged", () => {
    const blocks = readBlocks(fixture("paper-pro-text-highlighter-overflow.rm"));
    const points = lineBlocks(blocks).flatMap((block) => block.item.value?.points ?? []);
    expect(points.some((point) => point.x === -900 && point.y === -100)).toBe(true);
    expect(points.some((point) => point.x === 900 && point.y === 2300)).toBe(true);
  });

  it("retains inline text codes 1 and 2 and warns", () => {
    const tree = readTree(fixture("paper-pro-text-formatting.rm"));
    const rawCodes = tree.rootText?.items.sequenceItems().flatMap((item) =>
      typeof item.value === "number" ? [item.value] : [],
    );
    expect(rawCodes).toEqual(expect.arrayContaining([1, 2]));
    const warnings: ReadWarning[] = [];
    expect(readText(tree, { onWarning: (warning) => warnings.push(warning) })).not.toBeNull();
    expect(warnings.map((warning) => warning.kind)).toEqual([
      "unknown-text-format",
      "unknown-text-format",
    ]);
  });

  it("parses tombstones without adding deleted items to the tree", () => {
    const data = fixture("paper-pro-shader-nested-extra.rm");
    const blocks = readBlocks(data);
    expect(blocks.filter((block) => block.kind === "sceneTombstoneItem")).toHaveLength(3);
    const liveLines = lineBlocks(blocks).filter((block) => block.item.value !== null).length;
    const treeLines = [...readTree(data).walk()].filter((item) => item.kind === "line").length;
    expect(treeLines).toBe(liveLines);
  });
});

function findBytes(data: Uint8Array, pattern: Uint8Array): number {
  for (let offset = 0; offset <= data.byteLength - pattern.byteLength; offset++) {
    let matches = true;
    for (let index = 0; index < pattern.byteLength; index++) {
      if (data[offset + index] !== pattern[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return offset;
  }
  return -1;
}
