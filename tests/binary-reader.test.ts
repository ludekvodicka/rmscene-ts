import { describe, expect, it } from "vitest";

import { BinaryReader } from "../src/binary-reader.js";
import { RmParseError } from "../src/errors.js";

function bytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/.{2}/g)?.map((value) => Number.parseInt(value, 16)) ?? []);
}

describe("BinaryReader", () => {
  it.each([
    ["00", 0n],
    ["03", 3n],
    ["7f", 0x7fn],
    ["8c01", 0x8cn],
    ["9c01", 0x9cn],
    ["ff7f", 0x3fffn],
    ["ffffffffffffffffff01", 0xffff_ffff_ffff_ffffn],
  ])("reads varuint %s", (hex, expected) => {
    expect(new BinaryReader(bytes(hex)).readVarUintBigInt()).toBe(expected);
  });

  it("rejects an overlong varuint", () => {
    const reader = new BinaryReader(bytes("8080808080808080808000"));
    expect(() => reader.readVarUintBigInt()).toThrowError(RmParseError);
  });

  it("rejects a uint64 overflow", () => {
    const reader = new BinaryReader(bytes("ffffffffffffffffff02"));
    expect(() => reader.readVarUintBigInt()).toThrowError(/exceeds uint64/);
  });

  it("bounds child readers to their declared length", () => {
    const reader = new BinaryReader(bytes("01020304"));
    const child = reader.fork(2);
    expect(child.readUint16()).toBe(0x0201);
    expect(() => child.readUint8()).toThrowError(RmParseError);
    expect(reader.readUint16()).toBe(0x0403);
  });

  it("reads a CRDT id with a bigint second component", () => {
    const reader = new BinaryReader(bytes("07ffffffffffffffffff01"));
    expect(reader.readCrdtId()).toEqual({ part1: 7, part2: 0xffff_ffff_ffff_ffffn });
  });

  it("rejects invalid boolean values", () => {
    expect(() => new BinaryReader(bytes("02")).readBool()).toThrowError(/Invalid boolean/);
  });
});
