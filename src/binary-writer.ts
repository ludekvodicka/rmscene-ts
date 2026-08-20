import type { CrdtId } from "./crdt.js";

const MAX_UINT64 = 0xffff_ffff_ffff_ffffn;
const UTF8_ENCODER = new TextEncoder();

export class BinaryWriter {
  #buffer = new Uint8Array(256);
  #view = new DataView(this.#buffer.buffer);
  #length = 0;

  get length(): number {
    return this.#length;
  }

  writeBytes(value: Uint8Array): void {
    this.#reserve(value.byteLength);
    this.#buffer.set(value, this.#length);
    this.#length += value.byteLength;
  }

  writeUint8(value: number): void {
    requireInteger(value, 0xff, "uint8");
    this.#reserve(1);
    this.#view.setUint8(this.#length, value);
    this.#length++;
  }

  writeUint16(value: number): void {
    requireInteger(value, 0xffff, "uint16");
    this.#reserve(2);
    this.#view.setUint16(this.#length, value, true);
    this.#length += 2;
  }

  writeUint32(value: number): void {
    requireInteger(value, 0xffff_ffff, "uint32");
    this.#reserve(4);
    this.#view.setUint32(this.#length, value, true);
    this.#length += 4;
  }

  writeFloat32(value: number): void {
    requireFinite(value, "float32");
    this.#reserve(4);
    this.#view.setFloat32(this.#length, value, true);
    this.#length += 4;
  }

  writeFloat64(value: number): void {
    requireFinite(value, "float64");
    this.#reserve(8);
    this.#view.setFloat64(this.#length, value, true);
    this.#length += 8;
  }

  writeBool(value: boolean): void {
    if (typeof value !== "boolean") throw new TypeError(`Expected a boolean, got ${String(value)}`);
    this.writeUint8(value ? 1 : 0);
  }

  writeVarUint(value: bigint | number): void {
    const integer = toUint64(value, "varuint");
    let remaining = integer;
    while (remaining >= 0x80n) {
      this.writeUint8(Number(remaining & 0x7fn) | 0x80);
      remaining >>= 7n;
    }
    this.writeUint8(Number(remaining));
  }

  writeCrdtId(value: CrdtId): void {
    if (typeof value !== "object" || value === null)
      throw new TypeError(`Expected a CRDT ID, got ${String(value)}`);
    this.writeUint8(value.part1);
    this.writeVarUint(value.part2);
  }

  writeUtf8(value: string): void {
    if (typeof value !== "string") throw new TypeError(`Expected a string, got ${String(value)}`);
    this.writeBytes(UTF8_ENCODER.encode(value));
  }

  toUint8Array(): Uint8Array {
    return this.#buffer.slice(0, this.#length);
  }

  #reserve(additional: number): void {
    if (!Number.isSafeInteger(additional) || additional < 0)
      throw new RangeError(`Invalid additional byte count ${additional}`);
    const required = this.#length + additional;
    if (!Number.isSafeInteger(required)) throw new RangeError(`Writer size exceeds the safe integer range`);
    if (required <= this.#buffer.byteLength) return;
    let capacity = this.#buffer.byteLength;
    while (capacity < required) capacity = Math.max(capacity * 2, required);
    const replacement = new Uint8Array(capacity);
    replacement.set(this.#buffer.subarray(0, this.#length));
    this.#buffer = replacement;
    this.#view = new DataView(replacement.buffer);
  }
}

function requireInteger(value: number, maximum: number, type: string): void {
  if (!Number.isInteger(value) || value < 0 || value > maximum)
    throw new RangeError(`${type} must be an integer from 0 to ${maximum}, got ${value}`);
}

function requireFinite(value: number, type: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${type} must be finite, got ${value}`);
}

function toUint64(value: bigint | number, type: string): bigint {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0))
    throw new RangeError(`${type} must be a non-negative safe integer or bigint, got ${value}`);
  const integer = typeof value === "bigint" ? value : BigInt(value);
  if (integer < 0n || integer > MAX_UINT64)
    throw new RangeError(`${type} must be from 0 to ${MAX_UINT64}, got ${integer}`);
  return integer;
}
