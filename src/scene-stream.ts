import { BinaryReader } from "./binary-reader.js";
import { CrdtSequence, type CrdtSequenceItem } from "./crdt-sequence.js";
import { crdtIdKey, crdtIdsEqual, END_MARKER, type CrdtId, type LwwValue } from "./crdt.js";
import { RmParseError } from "./errors.js";
import { ReadContext, type ReadOptions, type ReadWarning } from "./read-context.js";
import {
  paragraphStyleFromValue,
  penColorFromValue,
  penFromValue,
  type GlyphRange,
  type Group,
  type Line,
  type ParagraphStyle,
  type Pen,
  type PenColor,
  type Point,
  type Text,
  type TextStyle,
} from "./scene-items.js";
import { TaggedBlockReader } from "./tagged-block-reader.js";

export const HEADER_V6 = new TextEncoder().encode("reMarkable .lines file, version=6          ");

export const BlockType = {
  MigrationInfo: 0,
  SceneTree: 1,
  TreeNode: 2,
  SceneGlyphItem: 3,
  SceneGroupItem: 4,
  SceneLineItem: 5,
  SceneTextItem: 6,
  RootText: 7,
  SceneTombstoneItem: 8,
  AuthorIds: 9,
  PageInfo: 10,
  SceneInfo: 13,
} as const;

export interface MainBlockInfo {
  readonly offset: number;
  readonly size: number;
  readonly unknown: number;
  readonly blockType: number;
  readonly minVersion: number;
  readonly currentVersion: number;
}

interface BlockBase {
  readonly blockType: number;
  readonly minVersion: number;
  readonly currentVersion: number;
  readonly extraData: Uint8Array;
}

export interface UnreadableBlock extends BlockBase {
  readonly kind: "unreadable";
  readonly error: string;
  readonly data: Uint8Array;
  readonly info: MainBlockInfo;
  readonly partialHeaderData?: Uint8Array;
}

export interface SceneInfo extends BlockBase {
  readonly kind: "sceneInfo";
  readonly currentLayer: LwwValue<CrdtId>;
  readonly backgroundVisible?: LwwValue<boolean>;
  readonly rootDocumentVisible?: LwwValue<boolean>;
  readonly paperSize?: readonly [number, number];
}

export interface AuthorId {
  readonly authorId: number;
  readonly uuid: string;
}

export interface AuthorIdsBlock extends BlockBase {
  readonly kind: "authorIds";
  readonly authorUuids: readonly AuthorId[];
}

export interface MigrationInfoBlock extends BlockBase {
  readonly kind: "migrationInfo";
  readonly migrationId: CrdtId;
  readonly isDevice: boolean;
  readonly unknown: boolean;
  readonly unknownPresent?: boolean;
}

export interface TreeNodeBlock extends BlockBase {
  readonly kind: "treeNode";
  readonly group: Group;
}

export interface PageInfoBlock extends BlockBase {
  readonly kind: "pageInfo";
  readonly loadsCount: number;
  readonly mergesCount: number;
  readonly textCharsCount: number;
  readonly textLinesCount: number;
  readonly typeFolioUseCount: number;
  readonly typeFolioUseCountPresent?: boolean;
}

export interface SceneTreeBlock extends BlockBase {
  readonly kind: "sceneTree";
  readonly treeId: CrdtId;
  readonly nodeId: CrdtId;
  readonly isUpdate: boolean;
  readonly parentId: CrdtId;
}

interface SceneItemBlockBase<Value> extends BlockBase {
  readonly parentId: CrdtId;
  readonly item: CrdtSequenceItem<Value>;
  readonly extraValueData: Uint8Array;
}

export interface SceneTombstoneItemBlock extends SceneItemBlockBase<null> {
  readonly kind: "sceneTombstoneItem";
}

export interface SceneGlyphItemBlock extends SceneItemBlockBase<GlyphRange | null> {
  readonly kind: "sceneGlyphItem";
}

export interface SceneGroupItemBlock extends SceneItemBlockBase<CrdtId | null> {
  readonly kind: "sceneGroupItem";
}

export interface SceneLineItemBlock extends SceneItemBlockBase<Line | null> {
  readonly kind: "sceneLineItem";
}

export interface SceneTextItemBlock extends SceneItemBlockBase<null> {
  readonly kind: "sceneTextItem";
}

export interface RootTextBlock extends BlockBase {
  readonly kind: "rootText";
  readonly blockId: CrdtId;
  readonly value: Text;
}

export type Block =
  | UnreadableBlock
  | SceneInfo
  | AuthorIdsBlock
  | MigrationInfoBlock
  | TreeNodeBlock
  | PageInfoBlock
  | SceneTreeBlock
  | SceneTombstoneItemBlock
  | SceneGlyphItemBlock
  | SceneGroupItemBlock
  | SceneLineItemBlock
  | SceneTextItemBlock
  | RootTextBlock;

type ParsedBlock = Block extends infer Value
  ? Value extends Block
    ? Omit<Value, "extraData">
    : never
  : never;

export function readBlocks(data: Uint8Array, options: ReadOptions = {}): Block[] {
  return readBlocksWithContext(data, new ReadContext(options));
}

export function readBlocksWithContext(data: Uint8Array, context: ReadContext): Block[] {
  const reader = new BinaryReader(data);
  readHeader(reader);
  const blocks: Block[] = [];

  while (reader.remaining > 0) {
    const headerOffset = reader.position;
    if (reader.remaining < 8) {
      const error = new RmParseError(
        "truncated-block",
        `Truncated block header at offset ${headerOffset}: ${reader.remaining} bytes remain`,
        { offset: headerOffset },
      );
      context.structural(error, { kind: "truncated-block", message: error.message });
      const partialHeaderData = reader.readBytes(reader.remaining);
      blocks.push({
        ...unreadable(error.message, new Uint8Array(), {
          offset: headerOffset,
          size: 0,
          unknown: 0,
          blockType: -1,
          minVersion: 0,
          currentVersion: 0,
        }),
        partialHeaderData,
      });
      break;
    }

    const size = reader.readUint32();
    const unknown = reader.readUint8();
    const minVersion = reader.readUint8();
    const currentVersion = reader.readUint8();
    const blockType = reader.readUint8();
    const info: MainBlockInfo = {
      offset: reader.position,
      size,
      unknown,
      blockType,
      minVersion,
      currentVersion,
    };

    if (size > reader.remaining) {
      const data = reader.readBytes(reader.remaining);
      const error = new RmParseError(
        "truncated-block",
        `Block type ${blockType} at offset ${headerOffset} declares ${size} bytes, only ${data.byteLength} remain`,
        { offset: headerOffset, blockType },
      );
      context.structural(error, warning("truncated-block", error.message, blockType));
      blocks.push(unreadable(error.message, data, info));
      break;
    }

    const payload = reader.fork(size);
    const rawData = data.slice(payload.start, payload.end);
    if (unknown !== 0 || minVersion > currentVersion) {
      const message = `Invalid block header for type ${blockType} at offset ${headerOffset}`;
      const error = new RmParseError("malformed-block", message, { offset: headerOffset, blockType });
      context.structural(error, warning("unreadable-block", message, blockType));
      blocks.push(unreadable(message, rawData, info));
      continue;
    }

    const stream = new TaggedBlockReader(payload, context, blockType);
    const parse = parserFor(blockType);
    if (parse === undefined) {
      const message = `Unknown block type ${blockType}; skipped ${size} bytes`;
      context.warn(warning("unknown-block", message, blockType));
      blocks.push(unreadable(message, rawData, info));
      continue;
    }

    try {
      const block = parse(stream, info);
      const extraData = stream.finish(`block type ${blockType}`);
      blocks.push({ ...block, extraData } as Block);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      const message = `Error reading block type ${blockType} at offset ${headerOffset}: ${detail}`;
      const error = new RmParseError("malformed-block", message, { offset: headerOffset, blockType, cause });
      context.structural(error, warning("unreadable-block", message, blockType));
      blocks.push(unreadable(message, rawData, info));
    }
  }
  return blocks;
}

function readHeader(reader: BinaryReader): void {
  if (reader.remaining < HEADER_V6.byteLength)
    throw new RmParseError("invalid-header", "Data is shorter than the reMarkable v6 header", { offset: 0 });
  const actual = reader.readBytes(HEADER_V6.byteLength);
  for (let index = 0; index < HEADER_V6.byteLength; index++) {
    if (actual[index] !== HEADER_V6[index])
      throw new RmParseError("invalid-header", "Wrong reMarkable file header", { offset: index });
  }
}

function parserFor(
  blockType: number,
): ((stream: TaggedBlockReader, info: MainBlockInfo) => ParsedBlock) | undefined {
  if (blockType === BlockType.MigrationInfo) return readMigrationInfo;
  else if (blockType === BlockType.SceneTree) return readSceneTree;
  else if (blockType === BlockType.TreeNode) return readTreeNode;
  else if (blockType === BlockType.SceneGlyphItem) return readSceneGlyphItem;
  else if (blockType === BlockType.SceneGroupItem) return readSceneGroupItem;
  else if (blockType === BlockType.SceneLineItem) return readSceneLineItem;
  else if (blockType === BlockType.SceneTextItem) return readSceneTextItem;
  else if (blockType === BlockType.RootText) return readRootText;
  else if (blockType === BlockType.SceneTombstoneItem) return readSceneTombstoneItem;
  else if (blockType === BlockType.AuthorIds) return readAuthorIds;
  else if (blockType === BlockType.PageInfo) return readPageInfo;
  else if (blockType === BlockType.SceneInfo) return readSceneInfo;
  else return undefined;
}

function base(info: MainBlockInfo): Omit<BlockBase, "extraData"> {
  return {
    blockType: info.blockType,
    minVersion: info.minVersion,
    currentVersion: info.currentVersion,
  };
}

function unreadable(error: string, data: Uint8Array, info: MainBlockInfo): UnreadableBlock {
  return {
    kind: "unreadable",
    ...base(info),
    error,
    data,
    info,
    extraData: new Uint8Array(),
  };
}

function warning(kind: ReadWarning["kind"], message: string, blockType: number): ReadWarning {
  return { kind, message, blockType };
}

function readSceneInfo(stream: TaggedBlockReader, info: MainBlockInfo): ParsedBlock {
  const currentLayer = stream.readLwwId(1);
  const backgroundVisible = stream.remaining > 0 ? stream.readLwwBool(2) : undefined;
  const rootDocumentVisible = stream.remaining > 0 ? stream.readLwwBool(3) : undefined;
  const paperSize = stream.remaining > 0 ? stream.readIntPair(5) : undefined;
  return {
    kind: "sceneInfo",
    ...base(info),
    currentLayer,
    ...(backgroundVisible === undefined ? {} : { backgroundVisible }),
    ...(rootDocumentVisible === undefined ? {} : { rootDocumentVisible }),
    ...(paperSize === undefined ? {} : { paperSize }),
  };
}

function readAuthorIds(stream: TaggedBlockReader, info: MainBlockInfo): ParsedBlock {
  const count = stream.data.readVarUintNumber();
  if (count > stream.remaining)
    throw new RmParseError("invalid-length", `Author count ${count} exceeds remaining data`, {
      offset: stream.data.position,
      blockType: info.blockType,
    });
  const authorUuids: AuthorId[] = [];
  for (let index = 0; index < count; index++) {
    const entry = stream.readSubblock(0, (reader) => {
      const length = reader.data.readVarUintNumber();
      if (length !== 16)
        throw new RmParseError("invalid-length", `Expected a 16-byte UUID, got ${length}`, {
          offset: reader.data.position,
          blockType: info.blockType,
        });
      return { uuid: uuidFromLittleEndian(reader.data.readBytes(length)), authorId: reader.data.readUint16() };
    }).value;
    authorUuids.push(entry);
  }
  return { kind: "authorIds", ...base(info), authorUuids };
}

function uuidFromLittleEndian(data: Uint8Array): string {
  const order = [3, 2, 1, 0, 5, 4, 7, 6, 8, 9, 10, 11, 12, 13, 14, 15];
  const hex = order.map((index) => data[index]?.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function readMigrationInfo(stream: TaggedBlockReader, info: MainBlockInfo): ParsedBlock {
  const migrationId = stream.readId(1);
  const isDevice = stream.readBool(2);
  const unknownPresent = stream.remaining > 0;
  const unknown = unknownPresent ? stream.readBool(3) : false;
  return { kind: "migrationInfo", ...base(info), migrationId, isDevice, unknown, unknownPresent };
}

function readTreeNode(stream: TaggedBlockReader, info: MainBlockInfo): ParsedBlock {
  const group: Group = {
    kind: "group",
    nodeId: stream.readId(1),
    children: new CrdtSequence(),
    label: stream.readLwwString(2),
    visible: stream.readLwwBool(3),
  };
  if (stream.remaining > 0) {
    group.anchorId = stream.readLwwId(7);
    group.anchorType = stream.readLwwByte(8);
    group.anchorThreshold = stream.readLwwFloat(9);
    group.anchorOriginX = stream.readLwwFloat(10);
  }
  return { kind: "treeNode", ...base(info), group };
}

function readPageInfo(stream: TaggedBlockReader, info: MainBlockInfo): ParsedBlock {
  const loadsCount = stream.readInt(1);
  const mergesCount = stream.readInt(2);
  const textCharsCount = stream.readInt(3);
  const textLinesCount = stream.readInt(4);
  const typeFolioUseCountPresent = stream.remaining > 0;
  const typeFolioUseCount = typeFolioUseCountPresent ? stream.readInt(5) : 0;
  return {
    kind: "pageInfo",
    ...base(info),
    loadsCount,
    mergesCount,
    textCharsCount,
    textLinesCount,
    typeFolioUseCount,
    typeFolioUseCountPresent,
  };
}

function readSceneTree(stream: TaggedBlockReader, info: MainBlockInfo): ParsedBlock {
  const treeId = stream.readId(1);
  const nodeId = stream.readId(2);
  const isUpdate = stream.readBool(3);
  const parentId = stream.readSubblock(4, (reader) => reader.readId(1)).value;
  return { kind: "sceneTree", ...base(info), treeId, nodeId, isUpdate, parentId };
}

function readPoint(stream: TaggedBlockReader, version: number): Point {
  const x = stream.data.readFloat32();
  const y = stream.data.readFloat32();
  if (version === 1) {
    const speed = stream.data.readFloat32() * 4;
    const direction = (255 * stream.data.readFloat32()) / (Math.PI * 2);
    const width = Math.round(stream.data.readFloat32() * 4);
    const pressure = stream.data.readFloat32() * 255;
    return { x, y, speed, direction, width, pressure };
  } else if (version === 2) {
    const speed = stream.data.readUint16();
    const width = stream.data.readUint16();
    const direction = stream.data.readUint8();
    const pressure = stream.data.readUint8();
    return { x, y, speed, direction, width, pressure };
  } else
    throw new RmParseError("invalid-value", `Unknown point version ${version}`, {
      offset: stream.data.position,
      blockType: stream.blockType,
    });
}

function pointSize(version: number, stream: TaggedBlockReader): number {
  if (version === 1) return 0x18;
  else if (version === 2) return 0x0e;
  else
    throw new RmParseError("invalid-value", `Unknown point version ${version}`, {
      offset: stream.data.position,
      blockType: stream.blockType,
    });
}

function readLine(stream: TaggedBlockReader, version: number): Line {
  const tool = readPen(stream, stream.readInt(1));
  const color = readColor(stream, stream.readInt(2));
  const thicknessScale = stream.readDouble(3);
  const startingLength = stream.readFloat(4);
  const points = stream.readSubblock(5, (reader) => {
    const size = pointSize(version, reader);
    if (reader.remaining % size !== 0)
      throw new RmParseError(
        "invalid-length",
        `Point data size ${reader.remaining} is not a multiple of ${size}`,
        { offset: reader.data.position, blockType: reader.blockType },
      );
    const count = reader.remaining / size;
    return Array.from({ length: count }, () => readPoint(reader, version));
  }).value;
  const timestamp = stream.readId(6);
  const moveId = stream.remaining >= 3 ? stream.readIdOptional(7) : undefined;
  const colorRgba = stream.readColorOptional(8);
  return {
    kind: "line",
    color,
    tool,
    points,
    thicknessScale,
    startingLength,
    timestamp,
    ...(moveId === undefined ? {} : { moveId }),
    ...(colorRgba === undefined ? {} : { colorRgba }),
  };
}

function readPen(stream: TaggedBlockReader, value: number): Pen {
  const pen = penFromValue(value);
  if (pen.name === undefined)
    stream.context.warnOnce(
      `pen:${value}`,
      warning("unknown-pen", `Unknown pen value ${value}; retained as a numeric value`, stream.blockType ?? -1),
    );
  return pen;
}

function readColor(stream: TaggedBlockReader, value: number): PenColor {
  const color = penColorFromValue(value);
  if (color.name === undefined)
    stream.context.warnOnce(
      `color:${value}`,
      warning("unknown-color", `Unknown color value ${value}; retained as a numeric value`, stream.blockType ?? -1),
    );
  return color;
}

function readGlyphRange(stream: TaggedBlockReader): GlyphRange {
  const start = stream.readIntOptional(2);
  const storedLength = stream.readIntOptional(3);
  const color = readColor(stream, stream.readInt(4));
  const text = stream.readString(5);
  const length = storedLength ?? Array.from(text).length;
  const rectangles = stream.readSubblock(6, (reader) => {
    const count = reader.data.readVarUintNumber();
    if (count > Math.floor(reader.remaining / 32))
      throw new RmParseError("invalid-length", `Rectangle count ${count} exceeds remaining data`, {
        offset: reader.data.position,
        blockType: reader.blockType,
      });
    return Array.from({ length: count }, () => ({
      x: reader.data.readFloat64(),
      y: reader.data.readFloat64(),
      width: reader.data.readFloat64(),
      height: reader.data.readFloat64(),
    }));
  }).value;
  const colorRgba = stream.readColorOptional(10);
  return {
    kind: "glyphRange",
    ...(start === undefined ? {} : { start }),
    length,
    lengthPresent: storedLength !== undefined,
    text,
    color,
    rectangles,
    ...(colorRgba === undefined ? {} : { colorRgba }),
  };
}

interface SceneItemDescriptor<Value, Kind extends SceneItemBlockKind> {
  readonly kind: Kind;
  readonly itemType: number;
  readonly parseValue: (stream: TaggedBlockReader, info: MainBlockInfo) => Value;
}

type SceneItemBlockKind =
  | "sceneTombstoneItem"
  | "sceneGlyphItem"
  | "sceneGroupItem"
  | "sceneLineItem"
  | "sceneTextItem";

function readSceneItem<Value, Kind extends SceneItemBlockKind>(
  stream: TaggedBlockReader,
  info: MainBlockInfo,
  descriptor: SceneItemDescriptor<Value, Kind>,
): Omit<SceneItemBlockBase<Value | null>, "extraData"> & { readonly kind: Kind } {
  const parentId = stream.readId(1);
  const itemId = stream.readId(2);
  const leftId = stream.readId(3);
  const rightId = stream.readId(4);
  const deletedLength = stream.readInt(5);
  let value: Value | null = null;
  let valuePresent = false;
  let extraValueData: Uint8Array = new Uint8Array();
  if (stream.hasSubblock(6)) {
    valuePresent = true;
    const parsed = stream.readSubblock(6, (reader) => {
      const itemType = reader.data.readUint8();
      if (itemType !== descriptor.itemType)
        throw new RmParseError(
          "invalid-value",
          `Expected scene item type ${descriptor.itemType}, got ${itemType}`,
          { offset: reader.data.position - 1, blockType: info.blockType },
        );
      return descriptor.parseValue(reader, info);
    });
    value = parsed.value;
    extraValueData = parsed.extraData;
  }
  return {
    kind: descriptor.kind,
    ...base(info),
    parentId,
    item: { itemId, leftId, rightId, deletedLength, value, valuePresent },
    extraValueData,
  };
}

function readSceneTombstoneItem(stream: TaggedBlockReader, info: MainBlockInfo): ParsedBlock {
  return readSceneItem(stream, info, {
    kind: "sceneTombstoneItem",
    itemType: 0,
    parseValue: () => null,
  });
}

function readSceneGlyphItem(stream: TaggedBlockReader, info: MainBlockInfo): ParsedBlock {
  return readSceneItem(stream, info, {
    kind: "sceneGlyphItem",
    itemType: 1,
    parseValue: (reader) => readGlyphRange(reader),
  });
}

function readSceneGroupItem(stream: TaggedBlockReader, info: MainBlockInfo): ParsedBlock {
  return readSceneItem(stream, info, {
    kind: "sceneGroupItem",
    itemType: 2,
    parseValue: (reader) => reader.readId(2),
  });
}

function readSceneLineItem(stream: TaggedBlockReader, info: MainBlockInfo): ParsedBlock {
  return readSceneItem(stream, info, {
    kind: "sceneLineItem",
    itemType: 3,
    parseValue: (reader) => readLine(reader, info.currentVersion),
  });
}

function readSceneTextItem(stream: TaggedBlockReader, info: MainBlockInfo): ParsedBlock {
  return readSceneItem(stream, info, {
    kind: "sceneTextItem",
    itemType: 5,
    parseValue: () => null,
  });
}

function readTextItem(stream: TaggedBlockReader): CrdtSequenceItem<string | number> {
  const parsed = stream.readSubblock(0, (reader) => {
    const itemId = reader.readId(2);
    const leftId = reader.readId(3);
    const rightId = reader.readId(4);
    const deletedLength = reader.readInt(5);
    let value: string | number = "";
    let valuePresent = false;
    if (reader.hasSubblock(6)) {
      valuePresent = true;
      const result = reader.readStringWithFormat(6);
      value = result.format ?? result.text;
    }
    return { itemId, leftId, rightId, deletedLength, value, valuePresent };
  });
  return { ...parsed.value, extraData: parsed.extraData };
}

function readTextStyle(stream: TaggedBlockReader): TextStyle {
  const characterId = stream.data.readCrdtId();
  const timestamp = stream.readId(1);
  const value = stream.readSubblock(2, (reader) => {
    const marker = reader.data.readUint8();
    if (marker !== 17)
      throw new RmParseError("invalid-value", `Expected text style marker 17, got ${marker}`, {
        offset: reader.data.position - 1,
        blockType: reader.blockType,
      });
    return reader.data.readUint8();
  }).value;
  const style = paragraphStyleFromValue(value);
  if (style.name === undefined)
    stream.context.warnOnce(
      `paragraph-style:${value}`,
      warning(
        "unknown-paragraph-style",
        `Unknown paragraph style ${value}; retained as a numeric value`,
        stream.blockType ?? -1,
      ),
    );
  return { characterId, style: { timestamp, value: style } };
}

function readRootText(stream: TaggedBlockReader, info: MainBlockInfo): ParsedBlock {
  const blockId = stream.readId(1);
  if (!crdtIdsEqual(blockId, END_MARKER))
    throw new RmParseError("invalid-value", `Root text id must be 0:0, got ${crdtIdKey(blockId)}`, {
      offset: stream.data.position,
      blockType: info.blockType,
    });

  const content = stream.readSubblock(2, (contentReader) => {
    const items = contentReader.readSubblock(1, (outer) =>
      outer.readSubblock(1, (inner) => {
        const count = inner.data.readVarUintNumber();
        if (count > inner.remaining)
          throw new RmParseError("invalid-length", `Text item count ${count} exceeds remaining data`, {
            offset: inner.data.position,
            blockType: info.blockType,
          });
        return Array.from({ length: count }, () => readTextItem(inner));
      }).value,
    ).value;
    const styles = contentReader.readSubblock(2, (outer) =>
      outer.readSubblock(1, (inner) => {
        const count = inner.data.readVarUintNumber();
        if (count > inner.remaining)
          throw new RmParseError("invalid-length", `Text style count ${count} exceeds remaining data`, {
            offset: inner.data.position,
            blockType: info.blockType,
          });
        const byCharacter = new Map<string, TextStyle>();
        for (let index = 0; index < count; index++) {
          const style = readTextStyle(inner);
          byCharacter.set(crdtIdKey(style.characterId), style);
        }
        return [...byCharacter.values()];
      }).value,
    ).value;
    return { items, styles };
  }).value;
  const [posX, posY] = stream.readSubblock(3, (reader) => [reader.data.readFloat64(), reader.data.readFloat64()] as const)
    .value;
  const width = stream.readFloat(4);
  const value: Text = {
    kind: "text",
    items: new CrdtSequence(content.items),
    styles: content.styles,
    posX,
    posY,
    width,
  };
  return { kind: "rootText", ...base(info), blockId, value };
}
