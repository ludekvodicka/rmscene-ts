import { BinaryWriter } from "./binary-writer.js";
import type { CrdtId, LwwValue } from "./crdt.js";
import { HEADER_V6 } from "./scene-stream.js";
import { TagType, type Rgba } from "./tagged-block-reader.js";

export class TaggedBlockWriter {
  #data = new BinaryWriter();
  #inBlock = false;

  get data(): BinaryWriter {
    return this.#data;
  }

  writeHeader(): void {
    this.#data.writeBytes(HEADER_V6);
  }

  writeId(index: number, value: CrdtId): void {
    this.#writeTag(index, TagType.Id);
    this.#data.writeCrdtId(value);
  }

  writeBool(index: number, value: boolean): void {
    this.#writeTag(index, TagType.Byte1);
    this.#data.writeBool(value);
  }

  writeByte(index: number, value: number): void {
    this.#writeTag(index, TagType.Byte1);
    this.#data.writeUint8(value);
  }

  writeInt(index: number, value: number): void {
    this.#writeTag(index, TagType.Byte4);
    this.#data.writeUint32(value);
  }

  writeFloat(index: number, value: number): void {
    this.#writeTag(index, TagType.Byte4);
    this.#data.writeFloat32(value);
  }

  writeDouble(index: number, value: number): void {
    this.#writeTag(index, TagType.Byte8);
    this.#data.writeFloat64(value);
  }

  writeColor(index: number, value: Rgba): void {
    const [red, green, blue, alpha] = value;
    for (const channel of value) {
      if (!Number.isInteger(channel) || channel < 0 || channel > 0xff)
        throw new RangeError(`RGBA channels must be uint8 values, got ${JSON.stringify(value)}`);
    }
    this.writeInt(index, (blue | (green << 8) | (red << 16) | (alpha << 24)) >>> 0);
  }

  writeBlock(
    blockType: number,
    minVersion: number,
    currentVersion: number,
    write: () => void,
    unknown = 0,
  ): void {
    if (this.#inBlock) throw new Error("Cannot nest a top-level block");
    const previous = this.#data;
    const payload = new BinaryWriter();
    this.#data = payload;
    this.#inBlock = true;
    try {
      write();
    } catch (error) {
      this.#data = previous;
      this.#inBlock = false;
      throw error;
    }
    this.#data = previous;
    this.#inBlock = false;
    this.writeRawBlock(blockType, minVersion, currentVersion, payload.toUint8Array(), unknown);
  }

  writeRawBlock(
    blockType: number,
    minVersion: number,
    currentVersion: number,
    payload: Uint8Array,
    unknown = 0,
    declaredSize = payload.byteLength,
  ): void {
    this.#data.writeUint32(declaredSize);
    this.#data.writeUint8(unknown);
    this.#data.writeUint8(minVersion);
    this.#data.writeUint8(currentVersion);
    this.#data.writeUint8(blockType);
    this.#data.writeBytes(payload);
  }

  writeSubblock(index: number, write: () => void): void {
    const previous = this.#data;
    const payload = new BinaryWriter();
    this.#data = payload;
    try {
      write();
    } catch (error) {
      this.#data = previous;
      throw error;
    }
    this.#data = previous;
    this.#writeTag(index, TagType.Length4);
    this.#data.writeUint32(payload.length);
    this.#data.writeBytes(payload.toUint8Array());
  }

  writeLwwBool(index: number, value: LwwValue<boolean>): void {
    this.writeSubblock(index, () => {
      this.writeId(1, value.timestamp);
      this.writeBool(2, value.value);
    });
  }

  writeLwwByte(index: number, value: LwwValue<number>): void {
    this.writeSubblock(index, () => {
      this.writeId(1, value.timestamp);
      this.writeByte(2, value.value);
    });
  }

  writeLwwFloat(index: number, value: LwwValue<number>): void {
    this.writeSubblock(index, () => {
      this.writeId(1, value.timestamp);
      this.writeFloat(2, value.value);
    });
  }

  writeLwwId(index: number, value: LwwValue<CrdtId>): void {
    this.writeSubblock(index, () => {
      this.writeId(1, value.timestamp);
      this.writeId(2, value.value);
    });
  }

  writeLwwString(index: number, value: LwwValue<string>): void {
    this.writeSubblock(index, () => {
      this.writeId(1, value.timestamp);
      this.writeString(2, value.value);
    });
  }

  writeString(index: number, value: string): void {
    this.writeSubblock(index, () => {
      const bytes = new TextEncoder().encode(value);
      this.#data.writeVarUint(bytes.byteLength);
      this.#data.writeBool(true);
      this.#data.writeBytes(bytes);
    });
  }

  writeStringWithFormat(index: number, text: string, format: number): void {
    this.writeSubblock(index, () => {
      const bytes = new TextEncoder().encode(text);
      this.#data.writeVarUint(bytes.byteLength);
      this.#data.writeBool(true);
      this.#data.writeBytes(bytes);
      this.writeInt(2, format);
    });
  }

  writeIntPair(index: number, value: readonly [number, number]): void {
    this.writeSubblock(index, () => {
      this.#data.writeUint32(value[0]);
      this.#data.writeUint32(value[1]);
    });
  }

  toUint8Array(): Uint8Array {
    return this.#data.toUint8Array();
  }

  #writeTag(index: number, type: number): void {
    if (!Number.isSafeInteger(index) || index < 0)
      throw new RangeError(`Tag index must be a non-negative safe integer, got ${index}`);
    this.#data.writeVarUint(BigInt(index) * 16n + BigInt(type));
  }
}
