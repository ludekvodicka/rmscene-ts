import { CrdtSequence, type CrdtSequenceItem } from "./crdt-sequence.js";
import { crdtId, END_MARKER, type CrdtId } from "./crdt.js";
import {
  ParagraphStyle,
  paragraphStyleFromValue,
  type GlyphRange,
  type Group,
  type Line,
  type Point,
  type Text,
  type TextStyle,
} from "./scene-items.js";
import {
  BlockType,
  type AuthorIdsBlock,
  type Block,
  type MigrationInfoBlock,
  type PageInfoBlock,
  type RootTextBlock,
  type SceneGlyphItemBlock,
  type SceneGroupItemBlock,
  type SceneInfo,
  type SceneLineItemBlock,
  type SceneTextItemBlock,
  type SceneTombstoneItemBlock,
  type SceneTreeBlock,
  type TreeNodeBlock,
} from "./scene-stream.js";
import { TaggedBlockWriter } from "./tagged-block-writer.js";

export interface WriteOptions {
  readonly version?: string;
}

type TargetVersion = readonly number[];
type SceneItemBlock =
  | SceneTombstoneItemBlock
  | SceneGlyphItemBlock
  | SceneGroupItemBlock
  | SceneLineItemBlock
  | SceneTextItemBlock;

export function writeBlocks(blocks: Iterable<Block>, options: WriteOptions = {}): Uint8Array {
  const targetVersion = options.version === undefined ? undefined : parseVersion(options.version);
  const writer = new TaggedBlockWriter();
  writer.writeHeader();
  for (const block of blocks) writeBlock(writer, block, targetVersion);
  return writer.toUint8Array();
}

export function simpleTextDocument(
  text: string,
  options: { readonly version: string; readonly authorUuid?: string },
): Block[] {
  if (typeof text !== "string") throw new TypeError(`Text must be a string, got ${String(text)}`);
  const targetVersion = parseVersion(options.version);
  const authorUuid = options.authorUuid ?? randomUuid();
  uuidToLittleEndian(authorUuid);
  const textLength = [...text].length;
  const rootId = crdtId(0, 1);
  const layerId = crdtId(0, 11);
  const textValue: Text = {
    kind: "text",
    items: new CrdtSequence([
      {
        itemId: crdtId(1, 16),
        leftId: END_MARKER,
        rightId: END_MARKER,
        deletedLength: 0,
        value: text,
        valuePresent: text.length > 0,
        extraData: emptyBytes(),
      },
    ]),
    styles: [
      {
        characterId: END_MARKER,
        style: { timestamp: crdtId(1, 15), value: paragraphStyleFromValue(ParagraphStyle.PLAIN) },
      },
    ],
    posX: -468,
    posY: 234,
    width: 936,
  };
  const blocks: Block[] = [
    {
      kind: "authorIds",
      ...base(BlockType.AuthorIds, versionInfoForKind("authorIds", targetVersion)),
      authorUuids: [{ authorId: 1, uuid: authorUuid }],
    },
    {
      kind: "migrationInfo",
      ...base(BlockType.MigrationInfo, versionInfoForKind("migrationInfo", targetVersion)),
      migrationId: crdtId(1, 1),
      isDevice: true,
      unknown: false,
      unknownPresent: atLeast(targetVersion, [3, 2, 2]),
    },
    {
      kind: "pageInfo",
      ...base(BlockType.PageInfo, versionInfoForKind("pageInfo", targetVersion)),
      loadsCount: 1,
      mergesCount: 0,
      textCharsCount: textLength + 1,
      textLinesCount: (text.match(/\n/g)?.length ?? 0) + 1,
      typeFolioUseCount: 0,
      typeFolioUseCountPresent: atLeast(targetVersion, [3, 2, 2]),
    },
    {
      kind: "sceneTree",
      ...base(BlockType.SceneTree, versionInfoForKind("sceneTree", targetVersion)),
      treeId: layerId,
      nodeId: END_MARKER,
      isUpdate: true,
      parentId: rootId,
    },
    {
      kind: "rootText",
      ...base(BlockType.RootText, versionInfoForKind("rootText", targetVersion)),
      blockId: END_MARKER,
      value: textValue,
    },
    {
      kind: "treeNode",
      ...base(BlockType.TreeNode, versionInfoForKind("treeNode", targetVersion)),
      group: group(rootId),
    },
    {
      kind: "treeNode",
      ...base(BlockType.TreeNode, versionInfoForKind("treeNode", targetVersion)),
      group: group(layerId, { timestamp: crdtId(0, 12), value: "Layer 1" }),
    },
    {
      kind: "sceneGroupItem",
      ...base(BlockType.SceneGroupItem, versionInfoForKind("sceneGroupItem", targetVersion)),
      parentId: rootId,
      item: {
        itemId: crdtId(0, 13),
        leftId: END_MARKER,
        rightId: END_MARKER,
        deletedLength: 0,
        value: layerId,
        valuePresent: true,
      },
      extraValueData: emptyBytes(),
    },
  ];
  return blocks;
}

function writeBlock(writer: TaggedBlockWriter, block: Block, targetVersion: TargetVersion | undefined): void {
  if (block.kind === "unreadable") {
    if (block.partialHeaderData !== undefined) {
      if (block.partialHeaderData.byteLength < 1 || block.partialHeaderData.byteLength >= 8)
        throw new RangeError("Partial block header must contain from 1 to 7 bytes");
      if (block.data.byteLength > 0 || block.extraData.byteLength > 0)
        throw new Error("Partial block header cannot also contain block payload data");
      writer.data.writeBytes(block.partialHeaderData);
      return;
    }
    writer.writeRawBlock(
      block.info.blockType,
      block.info.minVersion,
      block.info.currentVersion,
      block.data,
      block.info.unknown,
      block.info.size,
    );
    return;
  }
  const expectedType = blockTypeForKind(block.kind);
  if (block.blockType !== expectedType)
    throw new Error(`Block kind ${block.kind} requires type ${expectedType}, got ${block.blockType}`);
  const [minVersion, currentVersion] =
    targetVersion === undefined
      ? validateHeaderVersions(block.minVersion, block.currentVersion)
      : versionInfoForKind(block.kind, targetVersion);
  writer.writeBlock(block.blockType, minVersion, currentVersion, () => {
    writePayload(writer, block, targetVersion, currentVersion);
    writer.data.writeBytes(block.extraData);
  });
}

function writePayload(
  writer: TaggedBlockWriter,
  block: Exclude<Block, { readonly kind: "unreadable" }>,
  targetVersion: TargetVersion | undefined,
  currentVersion: number,
): void {
  if (block.kind === "sceneInfo") writeSceneInfo(writer, block);
  else if (block.kind === "authorIds") writeAuthorIds(writer, block);
  else if (block.kind === "migrationInfo") writeMigrationInfo(writer, block, targetVersion);
  else if (block.kind === "treeNode") writeTreeNode(writer, block);
  else if (block.kind === "pageInfo") writePageInfo(writer, block, targetVersion);
  else if (block.kind === "sceneTree") writeSceneTree(writer, block);
  else if (block.kind === "sceneTombstoneItem") writeSceneItem(writer, block, currentVersion);
  else if (block.kind === "sceneGlyphItem") writeSceneItem(writer, block, currentVersion);
  else if (block.kind === "sceneGroupItem") writeSceneItem(writer, block, currentVersion);
  else if (block.kind === "sceneLineItem") writeSceneItem(writer, block, currentVersion);
  else if (block.kind === "sceneTextItem") writeSceneItem(writer, block, currentVersion);
  else if (block.kind === "rootText") writeRootText(writer, block);
  else throw new Error(`Unhandled block kind ${String((block as { readonly kind?: unknown }).kind)}`);
}

function writeSceneInfo(writer: TaggedBlockWriter, block: SceneInfo): void {
  writer.writeLwwId(1, block.currentLayer);
  if (block.backgroundVisible !== undefined) writer.writeLwwBool(2, block.backgroundVisible);
  if (block.rootDocumentVisible !== undefined) writer.writeLwwBool(3, block.rootDocumentVisible);
  if (block.paperSize !== undefined) writer.writeIntPair(5, block.paperSize);
}

function writeAuthorIds(writer: TaggedBlockWriter, block: AuthorIdsBlock): void {
  writer.data.writeVarUint(block.authorUuids.length);
  for (const entry of block.authorUuids) {
    writer.writeSubblock(0, () => {
      const uuid = uuidToLittleEndian(entry.uuid);
      writer.data.writeVarUint(uuid.byteLength);
      writer.data.writeBytes(uuid);
      writer.data.writeUint16(entry.authorId);
    });
  }
}

function writeMigrationInfo(
  writer: TaggedBlockWriter,
  block: MigrationInfoBlock,
  targetVersion: TargetVersion | undefined,
): void {
  writer.writeId(1, block.migrationId);
  writer.writeBool(2, block.isDevice);
  const present =
    targetVersion === undefined ? (block.unknownPresent ?? true) : atLeast(targetVersion, [3, 2, 2]);
  if (present) writer.writeBool(3, block.unknown);
}

function writeTreeNode(writer: TaggedBlockWriter, block: TreeNodeBlock): void {
  const group = block.group;
  writer.writeId(1, group.nodeId);
  writer.writeLwwString(2, group.label);
  writer.writeLwwBool(3, group.visible);
  const anchors = [group.anchorId, group.anchorType, group.anchorThreshold, group.anchorOriginX];
  const present = anchors.filter((value) => value !== undefined).length;
  if (present !== 0 && present !== anchors.length) throw new Error("Tree node anchor fields must be all present or absent");
  if (group.anchorId !== undefined) {
    writer.writeLwwId(7, group.anchorId);
    writer.writeLwwByte(8, requirePresent(group.anchorType, "anchorType"));
    writer.writeLwwFloat(9, requirePresent(group.anchorThreshold, "anchorThreshold"));
    writer.writeLwwFloat(10, requirePresent(group.anchorOriginX, "anchorOriginX"));
  }
}

function writePageInfo(
  writer: TaggedBlockWriter,
  block: PageInfoBlock,
  targetVersion: TargetVersion | undefined,
): void {
  writer.writeInt(1, block.loadsCount);
  writer.writeInt(2, block.mergesCount);
  writer.writeInt(3, block.textCharsCount);
  writer.writeInt(4, block.textLinesCount);
  const present =
    targetVersion === undefined
      ? (block.typeFolioUseCountPresent ?? true)
      : atLeast(targetVersion, [3, 2, 2]);
  if (present) writer.writeInt(5, block.typeFolioUseCount);
}

function writeSceneTree(writer: TaggedBlockWriter, block: SceneTreeBlock): void {
  writer.writeId(1, block.treeId);
  writer.writeId(2, block.nodeId);
  writer.writeBool(3, block.isUpdate);
  writer.writeSubblock(4, () => writer.writeId(1, block.parentId));
}

function writeSceneItem(writer: TaggedBlockWriter, block: SceneItemBlock, lineVersion: number): void {
  writer.writeId(1, block.parentId);
  writer.writeId(2, block.item.itemId);
  writer.writeId(3, block.item.leftId);
  writer.writeId(4, block.item.rightId);
  writer.writeInt(5, block.item.deletedLength);
  const valuePresent = block.item.valuePresent ?? block.item.value !== null;
  if (!valuePresent) {
    if (block.extraValueData.byteLength > 0) throw new Error("Scene item has extra value data without a value subblock");
    return;
  }
  writer.writeSubblock(6, () => {
    if (block.kind === "sceneTombstoneItem") writer.data.writeUint8(0);
    else if (block.kind === "sceneGlyphItem") {
      writer.data.writeUint8(1);
      writeGlyphRange(writer, requirePresent(block.item.value, "glyph value"));
    } else if (block.kind === "sceneGroupItem") {
      writer.data.writeUint8(2);
      writer.writeId(2, requirePresent(block.item.value, "group value"));
    } else if (block.kind === "sceneLineItem") {
      writer.data.writeUint8(3);
      writeLine(writer, requirePresent(block.item.value, "line value"), lineVersion);
    } else if (block.kind === "sceneTextItem") writer.data.writeUint8(5);
    else throw new Error(`Unhandled scene item kind ${String((block as { readonly kind?: unknown }).kind)}`);
    writer.data.writeBytes(block.extraValueData);
  });
}

function writeGlyphRange(writer: TaggedBlockWriter, value: GlyphRange): void {
  if (value.start !== undefined) writer.writeInt(2, value.start);
  if (value.lengthPresent ?? value.start !== undefined) writer.writeInt(3, value.length);
  writer.writeInt(4, value.color.value);
  writer.writeString(5, value.text);
  writer.writeSubblock(6, () => {
    writer.data.writeVarUint(value.rectangles.length);
    for (const rectangle of value.rectangles) {
      writer.data.writeFloat64(rectangle.x);
      writer.data.writeFloat64(rectangle.y);
      writer.data.writeFloat64(rectangle.width);
      writer.data.writeFloat64(rectangle.height);
    }
  });
  if (value.colorRgba !== undefined) writer.writeColor(10, value.colorRgba);
}

function writeLine(writer: TaggedBlockWriter, line: Line, version: number): void {
  writer.writeInt(1, line.tool.value);
  writer.writeInt(2, line.color.value);
  writer.writeDouble(3, line.thicknessScale);
  writer.writeFloat(4, line.startingLength);
  writer.writeSubblock(5, () => {
    for (const point of line.points) writePoint(writer, point, version);
  });
  writer.writeId(6, line.timestamp);
  if (line.moveId !== undefined) writer.writeId(7, line.moveId);
  if (line.colorRgba !== undefined) writer.writeColor(8, line.colorRgba);
}

function writePoint(writer: TaggedBlockWriter, point: Point, version: number): void {
  writer.data.writeFloat32(point.x);
  writer.data.writeFloat32(point.y);
  if (version === 1) {
    writer.data.writeFloat32(point.speed / 4);
    writer.data.writeFloat32((point.direction * Math.PI * 2) / 255);
    writer.data.writeFloat32(point.width / 4);
    writer.data.writeFloat32(point.pressure / 255);
  } else if (version === 2) {
    writer.data.writeUint16(point.speed);
    writer.data.writeUint16(point.width);
    writer.data.writeUint8(point.direction);
    writer.data.writeUint8(point.pressure);
  } else throw new RangeError(`Unknown point version ${version}`);
}

function writeRootText(writer: TaggedBlockWriter, block: RootTextBlock): void {
  writer.writeId(1, block.blockId);
  writer.writeSubblock(2, () => {
    writer.writeSubblock(1, () => {
      writer.writeSubblock(1, () => {
        const items = block.value.items.sequenceItems();
        writer.data.writeVarUint(items.length);
        for (const item of items) writeTextItem(writer, item);
      });
    });
    writer.writeSubblock(2, () => {
      writer.writeSubblock(1, () => {
        writer.data.writeVarUint(block.value.styles.length);
        for (const style of block.value.styles) writeTextStyle(writer, style);
      });
    });
  });
  writer.writeSubblock(3, () => {
    writer.data.writeFloat64(block.value.posX);
    writer.data.writeFloat64(block.value.posY);
  });
  writer.writeFloat(4, block.value.width);
}

function writeTextItem(writer: TaggedBlockWriter, item: CrdtSequenceItem<string | number>): void {
  writer.writeSubblock(0, () => {
    writer.writeId(2, item.itemId);
    writer.writeId(3, item.leftId);
    writer.writeId(4, item.rightId);
    writer.writeInt(5, item.deletedLength);
    const valuePresent = item.valuePresent ?? (typeof item.value === "number" || item.value.length > 0);
    if (valuePresent) {
      if (typeof item.value === "string") writer.writeString(6, item.value);
      else if (typeof item.value === "number") writer.writeStringWithFormat(6, "", item.value);
      else throw new TypeError(`Text item must contain a string or number`);
    }
    writer.data.writeBytes(item.extraData ?? emptyBytes());
  });
}

function writeTextStyle(writer: TaggedBlockWriter, value: TextStyle): void {
  writer.data.writeCrdtId(value.characterId);
  writer.writeId(1, value.style.timestamp);
  writer.writeSubblock(2, () => {
    writer.data.writeUint8(17);
    writer.data.writeUint8(value.style.value.value);
  });
}

function versionInfoForKind(kind: Exclude<Block["kind"], "unreadable">, version: TargetVersion): readonly [number, number] {
  if (kind === "sceneInfo") return [0, 1];
  else if (kind === "pageInfo") return [0, 1];
  else if (kind === "treeNode") return atLeast(version, [3, 4]) ? [1, 2] : [1, 1];
  else if (kind === "sceneLineItem") return greaterThan(version, [3, 0]) ? [2, 2] : [1, 1];
  else if (kind === "authorIds") return [1, 1];
  else if (kind === "migrationInfo") return [1, 1];
  else if (kind === "sceneTree") return [1, 1];
  else if (kind === "sceneTombstoneItem") return [1, 1];
  else if (kind === "sceneGlyphItem") return [1, 1];
  else if (kind === "sceneGroupItem") return [1, 1];
  else if (kind === "sceneTextItem") return [1, 1];
  else if (kind === "rootText") return [1, 1];
  else throw new Error(`Unhandled block kind ${String(kind)}`);
}

function blockTypeForKind(kind: Exclude<Block["kind"], "unreadable">): number {
  if (kind === "sceneInfo") return BlockType.SceneInfo;
  else if (kind === "authorIds") return BlockType.AuthorIds;
  else if (kind === "migrationInfo") return BlockType.MigrationInfo;
  else if (kind === "treeNode") return BlockType.TreeNode;
  else if (kind === "pageInfo") return BlockType.PageInfo;
  else if (kind === "sceneTree") return BlockType.SceneTree;
  else if (kind === "sceneTombstoneItem") return BlockType.SceneTombstoneItem;
  else if (kind === "sceneGlyphItem") return BlockType.SceneGlyphItem;
  else if (kind === "sceneGroupItem") return BlockType.SceneGroupItem;
  else if (kind === "sceneLineItem") return BlockType.SceneLineItem;
  else if (kind === "sceneTextItem") return BlockType.SceneTextItem;
  else if (kind === "rootText") return BlockType.RootText;
  else throw new Error(`Unhandled block kind ${String(kind)}`);
}

function validateHeaderVersions(minVersion: number, currentVersion: number): readonly [number, number] {
  if (!Number.isInteger(minVersion) || minVersion < 0 || minVersion > 0xff)
    throw new RangeError(`Block minimum version must be a uint8, got ${minVersion}`);
  if (!Number.isInteger(currentVersion) || currentVersion < minVersion || currentVersion > 0xff)
    throw new RangeError(`Block current version must be a uint8 not below ${minVersion}, got ${currentVersion}`);
  return [minVersion, currentVersion];
}

function parseVersion(value: string): TargetVersion {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)*$/.test(value))
    throw new RangeError(`Version must contain dot-separated non-negative integers, got ${String(value)}`);
  return value.split(".").map((part) => {
    const number = Number(part);
    if (!Number.isSafeInteger(number)) throw new RangeError(`Version component is too large: ${part}`);
    return number;
  });
}

function atLeast(value: TargetVersion, expected: TargetVersion): boolean {
  return compareVersions(value, expected) >= 0;
}

function greaterThan(value: TargetVersion, expected: TargetVersion): boolean {
  return compareVersions(value, expected) > 0;
}

function compareVersions(left: TargetVersion, right: TargetVersion): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function uuidToLittleEndian(value: string): Uint8Array {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    throw new RangeError(`Invalid UUID: ${value}`);
  const canonical = Uint8Array.from(value.replaceAll("-", "").match(/../g) ?? [], (part) => Number.parseInt(part, 16));
  const order = [3, 2, 1, 0, 5, 4, 7, 6, 8, 9, 10, 11, 12, 13, 14, 15];
  return Uint8Array.from(order, (index) => requirePresent(canonical[index], `UUID byte ${index}`));
}

function group(nodeId: CrdtId, label = { timestamp: END_MARKER, value: "" }): Group {
  return {
    kind: "group",
    nodeId,
    children: new CrdtSequence(),
    label,
    visible: { timestamp: END_MARKER, value: true },
  };
}

function base(
  blockType: number,
  versions: readonly [number, number],
): { readonly blockType: number; readonly minVersion: number; readonly currentVersion: number; readonly extraData: Uint8Array } {
  return { blockType, minVersion: versions[0], currentVersion: versions[1], extraData: emptyBytes() };
}

function randomUuid(): string {
  if (globalThis.crypto?.randomUUID === undefined)
    throw new Error("crypto.randomUUID() is required when authorUuid is omitted");
  return globalThis.crypto.randomUUID();
}

function emptyBytes(): Uint8Array {
  return new Uint8Array();
}

function requirePresent<T>(value: T | undefined | null, name: string): T {
  if (value === undefined || value === null) throw new Error(`${name} is required`);
  return value;
}
