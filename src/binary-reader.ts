import { crdtId, type CrdtId } from "./crdt.js";
import { RmParseError } from "./errors.js";

const MAX_UINT64 = 0xffff_ffff_ffff_ffffn;
const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

export class BinaryReader {
  readonly data: Uint8Array;
  readonly start: number;
  readonly end: number;
  #position: number;
  readonly #view: DataView;

  constructor(data: Uint8Array, start = 0, end = data.byteLength) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > data.byteLength)
      throw new RangeError(`Invalid reader bounds ${start}..${end} for ${data.byteLength} bytes`);
    this.data = data;
    this.start = start;
    this.end = end;
    this.#position = start;
    this.#view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  get position(): number {
    return this.#position;
  }

  get remaining(): number {
    return this.end - this.#position;
  }

  seek(position: number): void {
    if (!Number.isInteger(position) || position < this.start || position > this.end)
      throw new RangeError(`Invalid seek position ${position}`);
    this.#position = position;
  }

  fork(length: number): BinaryReader {
    this.#require(length);
    const start = this.#position;
    this.#position += length;
    return new BinaryReader(this.data, start, this.#position);
  }

  readBytes(length: number): Uint8Array {
    this.#require(length);
    const result = this.data.slice(this.#position, this.#position + length);
    this.#position += length;
    return result;
  }

  readUint8(): number {
    this.#require(1);
    return this.#view.getUint8(this.#position++);
  }

  readUint16(): number {
    this.#require(2);
    const result = this.#view.getUint16(this.#position, true);
    this.#position += 2;
    return result;
  }

  readUint32(): number {
    this.#require(4);
    const result = this.#view.getUint32(this.#position, true);
    this.#position += 4;
    return result;
  }

  readFloat32(): number {
    this.#require(4);
    const result = this.#view.getFloat32(this.#position, true);
    this.#position += 4;
    return result;
  }

  readFloat64(): number {
    this.#require(8);
    const result = this.#view.getFloat64(this.#position, true);
    this.#position += 8;
    return result;
  }

  readBool(): boolean {
    const value = this.readUint8();
    if (value === 0) return false;
    else if (value === 1) return true;
    else
      throw new RmParseError("invalid-value", `Invalid boolean value ${value} at offset ${this.#position - 1}`, {
        offset: this.#position - 1,
      });
  }

  readVarUintBigInt(): bigint {
    let result = 0n;
    for (let index = 0; index < 10; index++) {
      const value = this.readUint8();
      if (index === 9 && value > 1)
        throw new RmParseError("invalid-value", `Varuint exceeds uint64 at offset ${this.#position - 1}`, {
          offset: this.#position - 1,
        });
      result |= BigInt(value & 0x7f) << BigInt(index * 7);
      if ((value & 0x80) === 0) return result;
    }
    throw new RmParseError("invalid-value", `Overlong varuint ending at offset ${this.#position}`, {
      offset: this.#position,
    });
  }

  readVarUintNumber(): number {
    const value = this.readVarUintBigInt();
    if (value > MAX_SAFE_INTEGER)
      throw new RmParseError("invalid-value", `Varuint ${value} exceeds JavaScript's safe integer range`, {
        offset: this.#position,
      });
    return Number(value);
  }

  readCrdtId(): CrdtId {
    const part1 = this.readUint8();
    const part2 = this.readVarUintBigInt();
    if (part2 > MAX_UINT64)
      throw new RmParseError("invalid-value", `CRDT id exceeds uint64 at offset ${this.#position}`, {
        offset: this.#position,
      });
    return crdtId(part1, part2);
  }

  readUtf8(length: number): string {
    const offset = this.#position;
    try {
      return UTF8_DECODER.decode(this.readBytes(length));
    } catch (error) {
      if (error instanceof RmParseError) throw error;
      throw new RmParseError("invalid-value", `Invalid UTF-8 string at offset ${offset}`, {
        offset,
        cause: error,
      });
    }
  }

  #require(length: number): void {
    if (!Number.isInteger(length) || length < 0)
      throw new RmParseError("invalid-length", `Invalid byte length ${length} at offset ${this.#position}`, {
        offset: this.#position,
      });
    if (length > this.remaining)
      throw new RmParseError(
        "unexpected-eof",
        `Need ${length} bytes at offset ${this.#position}, only ${this.remaining} remain`,
        { offset: this.#position },
      );
  }
}
