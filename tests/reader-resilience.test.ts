import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { BinaryReader } from "../src/binary-reader.js";
import { RmParseError } from "../src/errors.js";
import { ReadContext } from "../src/read-context.js";
import { HEADER_V6, readBlocks } from "../src/scene-stream.js";
import { readTree } from "../src/scene-tree.js";
import { TaggedBlockReader } from "../src/tagged-block-reader.js";
import { readText } from "../src/text.js";

const fixtureDirectory = fileURLToPath(new URL("fixtures", import.meta.url));

function fixture(path: string): Uint8Array {
  return readFileSync(`${fixtureDirectory}/${path}`);
}

function expectClean(action: () => unknown): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(RmParseError);
  }
}

function exercisePublicReaders(data: Uint8Array): void {
  expectClean(() => readBlocks(data));
  expectClean(() => readBlocks(data, { strict: true }));
  expectClean(() => {
    const tree = readTree(data);
    readText(tree);
  });
}

function fileWithBlock(blockType: number, payload: Uint8Array): Uint8Array {
  const data = new Uint8Array(HEADER_V6.byteLength + 8 + payload.byteLength);
  data.set(HEADER_V6);
  const header = HEADER_V6.byteLength;
  new DataView(data.buffer).setUint32(header, payload.byteLength, true);
  data.set([0, 1, 1, blockType], header + 4);
  data.set(payload, header + 8);
  return data;
}

function declaredBoundaries(data: Uint8Array): number[] {
  const boundaries = new Set<number>([0, HEADER_V6.byteLength, data.byteLength]);
  let position = HEADER_V6.byteLength;
  while (position + 8 <= data.byteLength) {
    const size = new DataView(data.buffer, data.byteOffset + position, 4).getUint32(0, true);
    const end = position + 8 + size;
    if (end > data.byteLength) break;
    boundaries.add(position);
    boundaries.add(position + 8);
    boundaries.add(end);
    position = end;
  }

  for (let offset = HEADER_V6.byteLength; offset < data.byteLength; offset++) {
    let value = 0;
    let multiplier = 1;
    let length = 0;
    for (; length < 5 && offset + length < data.byteLength; length++) {
      const byte = data[offset + length];
      if (byte === undefined) break;
      value += (byte & 0x7f) * multiplier;
      if ((byte & 0x80) === 0) break;
      multiplier *= 128;
    }
    if (length === 5 || (value & 0xf) !== 0xc) continue;
    const sizeOffset = offset + length + 1;
    if (sizeOffset + 4 > data.byteLength) continue;
    const size = new DataView(data.buffer, data.byteOffset + sizeOffset, 4).getUint32(0, true);
    const payloadOffset = sizeOffset + 4;
    const end = payloadOffset + size;
    if (end > data.byteLength) continue;
    boundaries.add(offset);
    boundaries.add(payloadOffset);
    boundaries.add(end);
  }
  return [...boundaries].sort((left, right) => left - right);
}

describe("reader resilience", () => {
  it("returns or throws a typed error for arbitrary bytes", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 2048 }), (data) => exercisePublicReaders(data)),
      { numRuns: 500 },
    );
  });

  it("returns or throws a typed error for a valid header plus arbitrary bytes", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 2048 }), (suffix) => {
        const data = new Uint8Array(HEADER_V6.byteLength + suffix.byteLength);
        data.set(HEADER_V6);
        data.set(suffix, HEADER_V6.byteLength);
        exercisePublicReaders(data);
      }),
      { numRuns: 500 },
    );
  });

  it("handles every prefix of a compact valid Paper Pro file", () => {
    const data = fixture("paper-pro/paper-pro-empty.rm");
    for (let length = 0; length <= data.byteLength; length++) exercisePublicReaders(data.subarray(0, length));
  });

  it("handles every declared block and candidate subblock boundary", () => {
    const data = fixture("paper-pro/paper-pro-shader-nested-extra.rm");
    for (const length of declaredBoundaries(data)) exercisePublicReaders(data.subarray(0, length));
  });

  it("handles generated truncation points in a larger valid file", () => {
    const data = fixture("paper-pro/paper-pro-text-highlighter-overflow.rm");
    fc.assert(
      fc.property(fc.integer({ min: 0, max: data.byteLength }), (length) => {
        exercisePublicReaders(data.subarray(0, length));
      }),
      { numRuns: 250 },
    );
  });

  it("rejects an oversized collection count before allocation", () => {
    const data = fileWithBlock(9, Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0x0f));
    const parsed = readBlocks(data);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.kind).toBe("unreadable");
    expect(() => readBlocks(data, { strict: true })).toThrowError(RmParseError);
  });

  it("rejects an oversized string length before allocation", () => {
    const data = Uint8Array.of(0x1c, 6, 0, 0, 0, 0xff, 0xff, 0xff, 0xff, 0x0f, 1);
    const stream = new TaggedBlockReader(new BinaryReader(data), new ReadContext());
    expect(() => stream.readString(1)).toThrowError(RmParseError);
  });

  it("rejects a subblock length beyond its parent", () => {
    const data = Uint8Array.of(0x1c, 0xff, 0xff, 0xff, 0xff);
    const stream = new TaggedBlockReader(new BinaryReader(data), new ReadContext());
    expect(() => stream.readSubblock(1, () => null)).toThrowError(RmParseError);
  });
});
