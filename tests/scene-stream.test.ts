import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { RmParseError, readBlocks, type ReadWarning } from "../src/index.js";
import { HEADER_V6 } from "../src/scene-stream.js";

const fixtureDirectory = fileURLToPath(new URL("fixtures/rmscene", import.meta.url));
const fixtures = readdirSync(fixtureDirectory).filter((name) => name.endsWith(".rm"));

describe("readBlocks", () => {
  it.each(fixtures)("fully parses upstream fixture %s", (name) => {
    const warnings: ReadWarning[] = [];
    const data = readFileSync(`${fixtureDirectory}/${name}`);
    const blocks = readBlocks(data, { onWarning: (warning) => warnings.push(warning) });
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.filter((block) => block.kind === "unreadable")).toEqual([]);
    expect(warnings.every((warning) => warning.kind === "trailing-data")).toBe(true);
  });

  it("rejects a wrong header", () => {
    expect(() => readBlocks(new Uint8Array(HEADER_V6.byteLength))).toThrowError(RmParseError);
  });

  it("returns prior blocks and warns on a truncated final block", () => {
    const source = readFileSync(`${fixtureDirectory}/Normal_AB.rm`);
    const warnings: ReadWarning[] = [];
    const blocks = readBlocks(source.subarray(0, source.byteLength - 1), {
      onWarning: (warning) => warnings.push(warning),
    });
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.at(-1)?.kind).toBe("unreadable");
    expect(warnings.at(-1)?.kind).toBe("truncated-block");
  });

  it("throws on a truncated final block in strict mode", () => {
    const source = readFileSync(`${fixtureDirectory}/Normal_AB.rm`);
    expect(() => readBlocks(source.subarray(0, source.byteLength - 1), { strict: true })).toThrowError(RmParseError);
  });

  it("contains a malformed block and parses the following block", () => {
    const data = bytes(`
      06000000 00010103 1f0219aabbcc
      05000000 00010100 1f02192101
    `);
    const file = new Uint8Array(HEADER_V6.byteLength + data.byteLength);
    file.set(HEADER_V6);
    file.set(data, HEADER_V6.byteLength);
    const warnings: ReadWarning[] = [];
    const blocks = readBlocks(file, { onWarning: (warning) => warnings.push(warning) });
    expect(blocks.map((block) => block.kind)).toEqual(["unreadable", "migrationInfo"]);
    expect(blocks[0]?.kind === "unreadable" ? blocks[0].data : null).toEqual(bytes("1f0219aabbcc"));
    expect(warnings.map((warning) => warning.kind)).toEqual(["unreadable-block"]);
    expect(() => readBlocks(file, { strict: true })).toThrowError(RmParseError);
  });

  it("retains an unknown block payload and continues", () => {
    const data = bytes(`
      03000000 000101ff aabbcc
      05000000 00010100 1f02192101
    `);
    const file = new Uint8Array(HEADER_V6.byteLength + data.byteLength);
    file.set(HEADER_V6);
    file.set(data, HEADER_V6.byteLength);
    const blocks = readBlocks(file);
    expect(blocks.map((block) => block.kind)).toEqual(["unreadable", "migrationInfo"]);
    expect(blocks[0]?.kind === "unreadable" ? blocks[0].data : null).toEqual(bytes("aabbcc"));
  });
});

function bytes(hex: string): Uint8Array {
  return Uint8Array.from(
    hex
      .replaceAll(/\s/g, "")
      .match(/.{2}/g)
      ?.map((value) => Number.parseInt(value, 16)) ?? [],
  );
}
