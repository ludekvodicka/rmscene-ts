import { BinaryReader } from "./binary-reader.js";
import type { CrdtId, LwwValue } from "./crdt.js";
import { RmParseError } from "./errors.js";
import { ReadContext } from "./read-context.js";

export const TagType = {
  Byte1: 0x1,
  Byte4: 0x4,
  Byte8: 0x8,
  Length4: 0xc,
  Id: 0xf,
} as const;

export type TagType = (typeof TagType)[keyof typeof TagType];
export type Rgba = readonly [number, number, number, number];

export interface ParsedSubblock<T> {
  readonly value: T;
  readonly extraData: Uint8Array;
}

export class TaggedBlockReader {
  readonly data: BinaryReader;
  readonly context: ReadContext;
  readonly blockType: number | undefined;

  constructor(data: BinaryReader, context: ReadContext, blockType?: number) {
    this.data = data;
    this.context = context;
    this.blockType = blockType;
  }

  get remaining(): number {
    return this.data.remaining;
  }

  readId(index: number): CrdtId {
    this.#readTag(index, TagType.Id);
    return this.data.readCrdtId();
  }

  readBool(index: number): boolean {
    this.#readTag(index, TagType.Byte1);
    return this.data.readBool();
  }

  readByte(index: number): number {
    this.#readTag(index, TagType.Byte1);
    return this.data.readUint8();
  }

  readInt(index: number): number {
    this.#readTag(index, TagType.Byte4);
    return this.data.readUint32();
  }

  readFloat(index: number): number {
    this.#readTag(index, TagType.Byte4);
    return this.data.readFloat32();
  }

  readDouble(index: number): number {
    this.#readTag(index, TagType.Byte8);
    return this.data.readFloat64();
  }

  readIdOptional(index: number): CrdtId | undefined {
    return this.checkTag(index, TagType.Id) ? this.readId(index) : undefined;
  }

  readBoolOptional(index: number): boolean | undefined {
    return this.checkTag(index, TagType.Byte1) ? this.readBool(index) : undefined;
  }

  readByteOptional(index: number): number | undefined {
    return this.checkTag(index, TagType.Byte1) ? this.readByte(index) : undefined;
  }

  readIntOptional(index: number): number | undefined {
    return this.checkTag(index, TagType.Byte4) ? this.readInt(index) : undefined;
  }

  readFloatOptional(index: number): number | undefined {
    return this.checkTag(index, TagType.Byte4) ? this.readFloat(index) : undefined;
  }

  readDoubleOptional(index: number): number | undefined {
    return this.checkTag(index, TagType.Byte8) ? this.readDouble(index) : undefined;
  }

  readColorOptional(index: number): Rgba | undefined {
    if (!this.checkTag(index, TagType.Byte4)) return undefined;
    const packed = this.readInt(index);
    return [(packed >> 16) & 0xff, (packed >> 8) & 0xff, packed & 0xff, (packed >>> 24) & 0xff];
  }

  readLwwBool(index: number): LwwValue<boolean> {
    return this.readSubblock(index, (reader) => ({ timestamp: reader.readId(1), value: reader.readBool(2) })).value;
  }

  readLwwByte(index: number): LwwValue<number> {
    return this.readSubblock(index, (reader) => ({ timestamp: reader.readId(1), value: reader.readByte(2) })).value;
  }

  readLwwFloat(index: number): LwwValue<number> {
    return this.readSubblock(index, (reader) => ({ timestamp: reader.readId(1), value: reader.readFloat(2) })).value;
  }

  readLwwId(index: number): LwwValue<CrdtId> {
    return this.readSubblock(index, (reader) => ({ timestamp: reader.readId(1), value: reader.readId(2) })).value;
  }

  readLwwString(index: number): LwwValue<string> {
    return this.readSubblock(index, (reader) => ({ timestamp: reader.readId(1), value: reader.readString(2) })).value;
  }

  readString(index: number): string {
    return this.readSubblock(index, (reader) => {
      const length = reader.data.readVarUintNumber();
      const encodedAsText = reader.data.readBool();
      if (!encodedAsText)
        throw new RmParseError("invalid-value", `String at offset ${reader.data.position} is not marked as text`, {
          offset: reader.data.position,
          blockType: reader.blockType,
        });
      return reader.data.readUtf8(length);
    }).value;
  }

  readStringWithFormat(index: number): { readonly text: string; readonly format: number | undefined } {
    return this.readSubblock(index, (reader) => {
      const length = reader.data.readVarUintNumber();
      const encodedAsText = reader.data.readBool();
      if (!encodedAsText)
        throw new RmParseError("invalid-value", `String at offset ${reader.data.position} is not marked as text`, {
          offset: reader.data.position,
          blockType: reader.blockType,
        });
      const text = reader.data.readUtf8(length);
      const format = reader.readIntOptional(2);
      return { text, format };
    }).value;
  }

  readIntPair(index: number): readonly [number, number] {
    return this.readSubblock(index, (reader) => [reader.data.readUint32(), reader.data.readUint32()] as const).value;
  }

  hasSubblock(index: number): boolean {
    return this.remaining > 0 && this.checkTag(index, TagType.Length4);
  }

  readSubblock<T>(index: number, parse: (reader: TaggedBlockReader) => T): ParsedSubblock<T> {
    this.#readTag(index, TagType.Length4);
    const length = this.data.readUint32();
    const payload = this.data.fork(length);
    const reader = new TaggedBlockReader(payload, this.context, this.blockType);
    const value = parse(reader);
    const extraData = reader.finish(`subblock ${index}`);
    return { value, extraData };
  }

  checkTag(expectedIndex: number, expectedType: TagType): boolean {
    const position = this.data.position;
    try {
      const { index, type } = this.#readTagValues();
      return index === expectedIndex && type === expectedType;
    } catch (error) {
      if (!(error instanceof RmParseError)) throw error;
      return false;
    } finally {
      this.data.seek(position);
    }
  }

  finish(location: string): Uint8Array {
    if (this.remaining === 0) return new Uint8Array();
    const extraData = this.data.readBytes(this.remaining);
    const warning = {
      kind: "trailing-data" as const,
      message: `${extraData.byteLength} unread bytes remain in ${location}`,
      ...(this.blockType === undefined ? {} : { blockType: this.blockType }),
    };
    this.context.warn(warning);
    return extraData;
  }

  #readTag(expectedIndex: number, expectedType: TagType): void {
    const position = this.data.position;
    const { index, type } = this.#readTagValues();
    if (index !== expectedIndex || type !== expectedType) {
      this.data.seek(position);
      throw new RmParseError(
        "unexpected-tag",
        `Expected tag ${expectedIndex}:0x${expectedType.toString(16)}, got ${index}:0x${type.toString(16)} at offset ${position}`,
        { offset: position, blockType: this.blockType },
      );
    }
  }

  #readTagValues(): { readonly index: number; readonly type: TagType } {
    const position = this.data.position;
    const value = this.data.readVarUintNumber();
    const index = Math.floor(value / 16);
    const type = value & 0xf;
    if (type === TagType.Byte1) return { index, type };
    else if (type === TagType.Byte4) return { index, type };
    else if (type === TagType.Byte8) return { index, type };
    else if (type === TagType.Length4) return { index, type };
    else if (type === TagType.Id) return { index, type };
    else
      throw new RmParseError("unexpected-tag", `Unknown tag type 0x${type.toString(16)} at offset ${position}`, {
        offset: position,
        blockType: this.blockType,
      });
  }
}
