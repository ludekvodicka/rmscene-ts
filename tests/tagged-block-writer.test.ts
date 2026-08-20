import { BinaryReader } from "../src/binary-reader.js";
import { describe, expect, it } from "vitest";
import { crdtId } from "../src/crdt.js";
import { ReadContext } from "../src/read-context.js";
import { TaggedBlockReader } from "../src/tagged-block-reader.js";
import { TaggedBlockWriter } from "../src/tagged-block-writer.js";

describe("TaggedBlockWriter", () => {
  it("matches the upstream ID encoding", () => {
    const writer = new TaggedBlockWriter();
    writer.writeId(3, crdtId(0, 0));
    expect(Buffer.from(writer.toUint8Array()).toString("hex")).toBe("3f0000");
  });

  it("matches the upstream int encoding", () => {
    const writer = new TaggedBlockWriter();
    writer.writeInt(3, 0xcdab);
    expect(Buffer.from(writer.toUint8Array()).toString("hex")).toBe("34abcd0000");
  });

  it("matches upstream block and subblock framing", () => {
    const block = new TaggedBlockWriter();
    block.writeBlock(5, 1, 2, () => block.writeInt(3, 0x1234));
    expect(Buffer.from(block.toUint8Array()).toString("hex")).toBe("05000000000102053434120000");

    const subblock = new TaggedBlockWriter();
    subblock.writeSubblock(1, () => subblock.writeSubblock(2, () => subblock.writeInt(3, 0x1234)));
    expect(Buffer.from(subblock.toUint8Array()).toString("hex")).toBe(
      "1c0a0000002c050000003434120000",
    );
  });

  it("does not append a failed block or subblock", () => {
    const writer = new TaggedBlockWriter();
    expect(() =>
      writer.writeBlock(5, 1, 2, () => {
        writer.writeInt(3, 1);
        throw new Error("stop");
      }),
    ).toThrow("stop");
    expect(() =>
      writer.writeSubblock(2, () => {
        writer.writeInt(3, 1);
        throw new Error("stop");
      }),
    ).toThrow("stop");
    writer.writeBool(7, true);
    expect(Buffer.from(writer.toUint8Array()).toString("hex")).toBe("7101");
  });

  it("rejects nested top-level blocks", () => {
    const writer = new TaggedBlockWriter();
    expect(() => writer.writeBlock(5, 1, 2, () => writer.writeBlock(4, 1, 1, () => undefined))).toThrow(
      "Cannot nest",
    );
    expect(writer.toUint8Array()).toHaveLength(0);
  });

  it("round-trips higher-level tagged values", () => {
    const writer = new TaggedBlockWriter();
    writer.writeId(0, crdtId(1, 5));
    writer.writeLwwBool(1, { timestamp: crdtId(2, 6), value: true });
    writer.writeLwwString(2, { timestamp: crdtId(3, 7), value: "a×" });
    writer.writeColor(3, [1, 2, 3, 4]);
    writer.writeIntPair(4, [1620, 2160]);

    const reader = new TaggedBlockReader(
      new BinaryReader(writer.toUint8Array()),
      new ReadContext(),
    );
    expect(reader.readId(0)).toEqual(crdtId(1, 5));
    expect(reader.readLwwBool(1)).toEqual({ timestamp: crdtId(2, 6), value: true });
    expect(reader.readLwwString(2)).toEqual({ timestamp: crdtId(3, 7), value: "a×" });
    expect(reader.readColorOptional(3)).toEqual([1, 2, 3, 4]);
    expect(reader.readIntPair(4)).toEqual([1620, 2160]);
    expect(reader.remaining).toBe(0);
  });
});
