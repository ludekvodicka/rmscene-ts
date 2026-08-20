import { describe, expect, it } from "vitest";

import { BinaryReader } from "../src/binary-reader.js";
import { crdtId } from "../src/crdt.js";
import { RmParseError } from "../src/errors.js";
import { ReadContext, type ReadOptions } from "../src/read-context.js";
import { paragraphStyleFromValue, penColorFromValue, penFromValue } from "../src/scene-items.js";
import { TagType, TaggedBlockReader } from "../src/tagged-block-reader.js";

function bytes(hex: string): Uint8Array {
  return Uint8Array.from(
    hex
      .replaceAll(/\s/g, "")
      .match(/.{2}/g)
      ?.map((value) => Number.parseInt(value, 16)) ?? [],
  );
}

function reader(hex: string, options: ReadOptions = {}): TaggedBlockReader {
  return new TaggedBlockReader(new BinaryReader(bytes(hex)), new ReadContext(options), 5);
}

describe("TaggedBlockReader", () => {
  it("uses the v6 tag values from rmscene", () => {
    expect(TagType.Id).toBe(0xf);
    expect(TagType.Length4).toBe(0xc);
    expect(TagType.Byte8).toBe(0x8);
    expect(TagType.Byte4).toBe(0x4);
    expect(TagType.Byte1).toBe(0x1);
  });

  it("reads an integer", () => {
    expect(reader("34abcd0000").readInt(3)).toBe(0xcdab);
  });

  it("rewinds after a mismatched tag", () => {
    const stream = reader("34abcd0000");
    expect(() => stream.readInt(2)).toThrowError(RmParseError);
    expect(stream.readInt(3)).toBe(0xcdab);
  });

  it("reads optional values without consuming a different tag", () => {
    const stream = reader("34abcd0000");
    expect(stream.readIntOptional(2)).toBeUndefined();
    expect(stream.readIntOptional(3)).toBe(0xcdab);
    expect(stream.readIntOptional(4)).toBeUndefined();
  });

  it("checks subblocks repeatedly without advancing", () => {
    const stream = reader("5c04000000ff000000");
    expect(stream.hasSubblock(5)).toBe(true);
    expect(stream.hasSubblock(4)).toBe(false);
    expect(stream.hasSubblock(5)).toBe(true);
    expect(stream.readSubblock(5, (child) => child.data.readUint32()).value).toBe(0xff);
  });

  it("bounds subblocks", () => {
    const stream = reader("5c04000000ff00000000000000");
    expect(() =>
      stream.readSubblock(5, (child) => {
        child.data.readUint32();
        child.data.readUint32();
      }),
    ).toThrowError(RmParseError);
  });

  it("retains and warns about subblock trailing bytes", () => {
    const warnings: unknown[] = [];
    const stream = reader("5c04000000ff000000", { onWarning: (warning) => warnings.push(warning) });
    const result = stream.readSubblock(5, () => "value");
    expect(result.value).toBe("value");
    expect(result.extraData).toEqual(bytes("ff000000"));
    expect(warnings).toEqual([
      { kind: "trailing-data", message: "4 unread bytes remain in subblock 5", blockType: 5 },
    ]);
  });

  it("reads LWW strings", () => {
    const stream = reader("1c0d0000001f01012c050000000301616263");
    expect(stream.readLwwString(1)).toEqual({ timestamp: crdtId(1, 1), value: "abc" });
  });

  it("reads UTF-8 strings", () => {
    expect(reader("1c05000000030161c397").readString(1)).toBe("a×");
  });

  it("reads packed BGRA colors as RGBA", () => {
    expect(reader("8401 75edffff").readColorOptional(8)).toEqual([255, 237, 117, 255]);
  });
});

describe("open numeric values", () => {
  it("names known values", () => {
    expect(penFromValue(23)).toEqual({ value: 23, name: "SHADER" });
    expect(penColorFromValue(9)).toEqual({ value: 9, name: "HIGHLIGHT" });
    expect(paragraphStyleFromValue(1)).toEqual({ value: 1, name: "PLAIN" });
  });

  it("keeps unknown values", () => {
    expect(penFromValue(255)).toEqual({ value: 255 });
    expect(penColorFromValue(255)).toEqual({ value: 255 });
    expect(paragraphStyleFromValue(255)).toEqual({ value: 255 });
  });
});
