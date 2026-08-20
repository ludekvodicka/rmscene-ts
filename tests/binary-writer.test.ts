import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { BinaryReader } from "../src/binary-reader.js";
import { BinaryWriter } from "../src/binary-writer.js";
import { crdtId } from "../src/crdt.js";

describe("BinaryWriter", () => {
  it("writes little-endian primitives", () => {
    const writer = new BinaryWriter();
    writer.writeBool(true);
    writer.writeUint8(0xab);
    writer.writeUint16(0xcdef);
    writer.writeUint32(0x1234_5678);
    writer.writeFloat32(1.5);
    writer.writeFloat64(-2.25);
    expect(Buffer.from(writer.toUint8Array()).toString("hex")).toBe(
      "01abefcd785634120000c03f00000000000002c0",
    );
  });

  it("writes uint64 varints and CRDT IDs", () => {
    const writer = new BinaryWriter();
    writer.writeVarUint(0xffff_ffff_ffff_ffffn);
    writer.writeCrdtId(crdtId(255, 0xffff_ffff_ffff_ffffn));
    const reader = new BinaryReader(writer.toUint8Array());
    expect(reader.readVarUintBigInt()).toBe(0xffff_ffff_ffff_ffffn);
    expect(reader.readCrdtId()).toEqual(crdtId(255, 0xffff_ffff_ffff_ffffn));
    expect(reader.remaining).toBe(0);
  });

  it("grows without returning unused capacity", () => {
    const writer = new BinaryWriter();
    const bytes = new Uint8Array(10_000).fill(0xa5);
    writer.writeBytes(bytes);
    expect(writer.length).toBe(bytes.length);
    expect(writer.toUint8Array()).toEqual(bytes);
  });

  it.each([
    ["uint8", () => new BinaryWriter().writeUint8(256)],
    ["uint16", () => new BinaryWriter().writeUint16(-1)],
    ["uint32", () => new BinaryWriter().writeUint32(0x1_0000_0000)],
    ["float32", () => new BinaryWriter().writeFloat32(Number.NaN)],
    ["float64", () => new BinaryWriter().writeFloat64(Number.POSITIVE_INFINITY)],
    ["varuint", () => new BinaryWriter().writeVarUint(-1)],
    ["uint64", () => new BinaryWriter().writeVarUint(0x1_0000_0000_0000_0000n)],
  ])("rejects an invalid %s", (_name, write) => {
    expect(write).toThrow(RangeError);
  });

  it("round-trips generated varints", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 0xffff_ffff_ffff_ffffn }), (value) => {
        const writer = new BinaryWriter();
        writer.writeVarUint(value);
        const reader = new BinaryReader(writer.toUint8Array());
        expect(reader.readVarUintBigInt()).toBe(value);
        expect(reader.remaining).toBe(0);
      }),
    );
  });
});
