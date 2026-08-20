import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { END_MARKER, crdtId, readBlocks, simpleTextDocument, writeBlocks, type Block } from "../src/index.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
const WRITER_GOLDENS = JSON.parse(
  readFileSync(join(import.meta.dirname, "goldens", "writer-python.json"), "utf8"),
) as {
  readonly files: Readonly<Record<string, { readonly length: number; readonly sha256: string; readonly version: string }>>;
  readonly simpleTextDocument: { readonly length: number; readonly sha256: string; readonly version: string };
};

const UPSTREAM_VERSIONS = new Map([
  ["Normal_AB.rm", "3.0"],
  ["Normal_A_stroke_2_layers.rm", "3.0"],
  ["Normal_A_stroke_2_layers_v3.2.2.rm", "3.2.2"],
  ["Normal_A_stroke_2_layers_v3.3.2.rm", "3.3.2"],
  ["Bold_Heading_Bullet_Normal.rm", "3.0"],
  ["Lines_v2.rm", "3.1"],
  ["Lines_v2_updated.rm", "3.2"],
  ["Wikipedia_highlighted_p1.rm", "3.1"],
  ["Wikipedia_highlighted_p2.rm", "3.1"],
  ["With_SceneInfo_Block.rm", "3.4"],
  ["Color_and_tool_v3.14.4.rm", "3.14"],
  ["More_color_highlight_shader_v3.15.4.2.rm", "3.15"],
]);

describe("writeBlocks", () => {
  for (const suite of ["rmscene", "paper-pro"]) {
    const directory = join(FIXTURES, suite);
    for (const filename of readdirSync(directory).filter((name) => name.endsWith(".rm")).sort()) {
      it(`losslessly round-trips ${suite}/${filename}`, () => {
        const input = readFileSync(join(directory, filename));
        expect(writeBlocks(readBlocks(input))).toEqual(new Uint8Array(input));
      });
    }
  }

  for (const [filename, version] of UPSTREAM_VERSIONS) {
    it(`matches Python target-version output for ${filename} at ${version}`, () => {
      const input = readFileSync(join(FIXTURES, "rmscene", filename));
      const expected =
        version === "3.2.2" || version === "3.3.2"
          ? replaceAllBytes(input, [1, 2, 5], [2, 2, 5])
          : new Uint8Array(input);
      expect(writeBlocks(readBlocks(input), { version })).toEqual(expected);
    });
  }

  for (const [relative, golden] of Object.entries(WRITER_GOLDENS.files)) {
    it(`matches the Python writer hash for ${relative}`, () => {
      const input = readFileSync(join(FIXTURES, relative));
      const output = writeBlocks(readBlocks(input), { version: golden.version });
      expect(output.byteLength).toBe(golden.length);
      expect(createHash("sha256").update(output).digest("hex")).toBe(golden.sha256);
    });
  }

  it("matches the upstream simple text fixture", () => {
    const expected = readFileSync(join(FIXTURES, "rmscene", "Normal_AB.rm"));
    const blocks = simpleTextDocument("AB", {
      version: "3.0",
      authorUuid: "495ba59f-c943-2b5c-b455-3682f6948906",
    });
    expect(writeBlocks(blocks, { version: "3.0" })).toEqual(new Uint8Array(expected));
    const output = writeBlocks(blocks, { version: WRITER_GOLDENS.simpleTextDocument.version });
    expect(output.byteLength).toBe(WRITER_GOLDENS.simpleTextDocument.length);
    expect(createHash("sha256").update(output).digest("hex")).toBe(
      WRITER_GOLDENS.simpleTextDocument.sha256,
    );
  });

  it("preserves a non-default line timestamp", () => {
    const input = readFileSync(join(FIXTURES, "rmscene", "Lines_v2.rm"));
    const blocks = readBlocks(input);
    const index = blocks.findIndex((block) => block.kind === "sceneLineItem" && block.item.value !== null);
    const original = blocks[index];
    if (original?.kind !== "sceneLineItem" || original.item.value === null) throw new Error("Missing line fixture");
    const changed: Block = {
      ...original,
      item: { ...original.item, value: { ...original.item.value, timestamp: { part1: 7, part2: 1234n } } },
    };
    const output = writeBlocks(blocks.map((block, blockIndex) => (blockIndex === index ? changed : block)));
    const reparsed = readBlocks(output)[index];
    if (reparsed?.kind !== "sceneLineItem" || reparsed.item.value === null) throw new Error("Missing output line");
    expect(reparsed.item.value.timestamp).toEqual({ part1: 7, part2: 1234n });
  });

  it("preserves valid unknown and truncated blocks byte-for-byte", () => {
    const header = new TextEncoder().encode("reMarkable .lines file, version=6          ");
    const unknown = Uint8Array.from([...header, 3, 0, 0, 0, 0, 1, 1, 99, 0xaa, 0xbb, 0xcc]);
    expect(writeBlocks(readBlocks(unknown))).toEqual(unknown);

    const warnings: string[] = [];
    const truncated = Uint8Array.from([...header, 5, 0, 0, 0, 0, 1, 1, 99, 0xaa, 0xbb]);
    const blocks = readBlocks(truncated, { onWarning: (warning) => warnings.push(warning.kind) });
    expect(writeBlocks(blocks)).toEqual(truncated);
    expect(warnings).toContain("truncated-block");
  });

  it("preserves an incomplete final block header byte-for-byte", () => {
    const header = new TextEncoder().encode("reMarkable .lines file, version=6          ");
    const input = Uint8Array.from([...header, 0xaa, 0xbb, 0xcc]);
    const blocks = readBlocks(input);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind === "unreadable" ? blocks[0].partialHeaderData : undefined).toEqual(
      new Uint8Array([0xaa, 0xbb, 0xcc]),
    );
    expect(writeBlocks(blocks)).toEqual(input);
  });

  it("derives a missing glyph length from Unicode code points", () => {
    const block: Block = {
      kind: "sceneGlyphItem",
      blockType: 3,
      minVersion: 1,
      currentVersion: 1,
      extraData: new Uint8Array(),
      parentId: END_MARKER,
      item: {
        itemId: crdtId(1, 1),
        leftId: END_MARKER,
        rightId: END_MARKER,
        deletedLength: 0,
        valuePresent: true,
        value: {
          kind: "glyphRange",
          length: 999,
          lengthPresent: false,
          text: "😀",
          color: { value: 0 },
          rectangles: [],
        },
      },
      extraValueData: new Uint8Array(),
    };
    const parsed = readBlocks(writeBlocks([block]))[0];
    if (parsed?.kind !== "sceneGlyphItem" || parsed.item.value === null) throw new Error("Missing glyph block");
    expect(parsed.item.value.lengthPresent).toBe(false);
    expect(parsed.item.value.length).toBe(1);
  });

  it.each(["", "v3", "3.-1", "3.x", "3..2"])("rejects invalid target version %j", (version) => {
    expect(() => writeBlocks([], { version })).toThrow(RangeError);
  });

  it("rejects invalid UUIDs", () => {
    expect(() => simpleTextDocument("test", { version: "3.0", authorUuid: "not-a-uuid" })).toThrow(
      "Invalid UUID",
    );
  });
});

function replaceAllBytes(input: Uint8Array, from: readonly number[], to: readonly number[]): Uint8Array {
  if (from.length !== to.length) throw new Error("Replacement byte sequences must have equal length");
  const output = Uint8Array.from(input);
  for (let offset = 0; offset <= output.length - from.length; offset++) {
    if (!from.every((value, index) => output[offset + index] === value)) continue;
    for (let index = 0; index < to.length; index++) output[offset + index] = to[index] ?? 0;
  }
  return output;
}
