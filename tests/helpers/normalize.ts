import {
  compareCrdtIds,
  type Block,
  type CrdtId,
  type CrdtSequence,
  type CrdtSequenceItem,
  type GlyphRange,
  type Group,
  type Line,
  type LwwValue,
  type NamedNumericValue,
  type Point,
  type Rectangle,
  type SceneItem,
  type SceneTree,
  type Text,
  type TextDocument,
} from "../../src/index.js";

type JsonPrimitive = boolean | null | number | string;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export function normalizeResult(blocks: readonly Block[], tree: SceneTree, document: TextDocument | null): JsonValue {
  return {
    blocks: blocks.map(normalizeBlock),
    text: normalizeDocument(document),
    tree: normalizeTree(tree),
  };
}

export function canonicalStringify(value: JsonValue): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function normalizeBlock(block: Block): JsonValue {
  const result: Record<string, JsonValue> = {
    blockType: block.blockType,
    currentVersion: block.currentVersion,
    extraData: bytes(block.extraData),
    kind: block.kind,
    minVersion: block.minVersion,
  };
  if (block.kind === "unreadable") throw new Error(`Fixture contains unreadable block: ${block.error}`);
  else if (block.kind === "sceneInfo") {
    result.currentLayer = lww(block.currentLayer, id);
    if (block.backgroundVisible !== undefined) result.backgroundVisible = lww(block.backgroundVisible, identity);
    if (block.rootDocumentVisible !== undefined)
      result.rootDocumentVisible = lww(block.rootDocumentVisible, identity);
    if (block.paperSize !== undefined) result.paperSize = [...block.paperSize];
  } else if (block.kind === "authorIds")
    result.authorUuids = block.authorUuids.map((entry) => ({ authorId: entry.authorId, uuid: entry.uuid }));
  else if (block.kind === "migrationInfo") {
    result.isDevice = block.isDevice;
    result.migrationId = id(block.migrationId);
    result.unknown = block.unknown;
  } else if (block.kind === "treeNode") result.group = normalizeGroup(block.group, false);
  else if (block.kind === "pageInfo") {
    result.loadsCount = block.loadsCount;
    result.mergesCount = block.mergesCount;
    result.textCharsCount = block.textCharsCount;
    result.textLinesCount = block.textLinesCount;
    result.typeFolioUseCount = block.typeFolioUseCount;
  } else if (block.kind === "sceneTree") {
    result.isUpdate = block.isUpdate;
    result.nodeId = id(block.nodeId);
    result.parentId = id(block.parentId);
    result.treeId = id(block.treeId);
  } else if (block.kind === "sceneTombstoneItem") Object.assign(result, normalizeSceneItemBlock(block, identity));
  else if (block.kind === "sceneGlyphItem")
    Object.assign(result, normalizeSceneItemBlock(block, (value) => (value === null ? null : glyphRange(value))));
  else if (block.kind === "sceneGroupItem")
    Object.assign(result, normalizeSceneItemBlock(block, (value) => (value === null ? null : id(value))));
  else if (block.kind === "sceneLineItem")
    Object.assign(result, normalizeSceneItemBlock(block, (value) => (value === null ? null : line(value))));
  else if (block.kind === "sceneTextItem") Object.assign(result, normalizeSceneItemBlock(block, identity));
  else if (block.kind === "rootText") {
    result.blockId = id(block.blockId);
    result.value = rawText(block.value);
  } else throw new Error(`Unhandled block: ${JSON.stringify(block)}`);
  return result;
}

function normalizeSceneItemBlock<T>(
  block: { readonly parentId: CrdtId; readonly item: CrdtSequenceItem<T>; readonly extraValueData: Uint8Array },
  normalizeValue: (value: T) => JsonValue,
): Record<string, JsonValue> {
  return {
    extraValueData: bytes(block.extraValueData),
    item: sequenceItem(block.item, normalizeValue),
    parentId: id(block.parentId),
  };
}

function normalizeTree(tree: SceneTree): JsonValue {
  return {
    root: normalizeGroup(tree.root, true),
    rootText: tree.rootText !== null,
    sceneInfo:
      tree.sceneInfo === null
        ? null
        : {
            currentLayer: lww(tree.sceneInfo.currentLayer, id),
            paperSize: tree.sceneInfo.paperSize === undefined ? null : [...tree.sceneInfo.paperSize],
          },
  };
}

function normalizeDocument(document: TextDocument | null): JsonValue {
  if (document === null) return null;
  return {
    contents: document.contents.map((paragraph) => ({
      contents: paragraph.contents.map((span) => ({
        ids: span.ids.map(id),
        properties: { ...span.properties },
        text: span.text,
      })),
      startId: id(paragraph.startId),
      style: lww(paragraph.style, openValue),
    })),
  };
}

function normalizeGroup(value: Group, includeChildren: boolean): JsonValue {
  const result: Record<string, JsonValue> = {
    children: includeChildren
      ? sequence(value.children, treeItem)
      : {
          items: [],
          order: [],
        },
    kind: "group",
    label: lww(value.label, identity),
    nodeId: id(value.nodeId),
    visible: lww(value.visible, identity),
  };
  if (value.anchorId !== undefined) result.anchorId = lww(value.anchorId, id);
  if (value.anchorType !== undefined) result.anchorType = lww(value.anchorType, identity);
  if (value.anchorThreshold !== undefined) result.anchorThreshold = lww(value.anchorThreshold, float64);
  if (value.anchorOriginX !== undefined) result.anchorOriginX = lww(value.anchorOriginX, float64);
  return result;
}

function treeItem(value: SceneItem | null): JsonValue {
  if (value === null) return null;
  if (value.kind === "group") return normalizeGroup(value, true);
  else if (value.kind === "line") return { kind: "line" };
  else if (value.kind === "text") return { kind: "text" };
  else if (value.kind === "glyphRange") return { kind: "glyphRange" };
  else throw new Error(`Unhandled scene item: ${JSON.stringify(value)}`);
}

function rawText(value: Text): JsonValue {
  return {
    items: sequence(value.items, identity),
    kind: "text",
    posX: float64(value.posX),
    posY: float64(value.posY),
    styles: [...value.styles]
      .sort((left, right) => compareCrdtIds(left.characterId, right.characterId))
      .map((entry) => ({
        characterId: id(entry.characterId),
        style: lww(entry.style, openValue),
      })),
    width: float64(value.width),
  };
}

function line(value: Line): JsonValue {
  const result: Record<string, JsonValue> = {
    color: openValue(value.color),
    kind: "line",
    points: value.points.map(point),
    startingLength: float64(value.startingLength),
    thicknessScale: float64(value.thicknessScale),
    tool: openValue(value.tool),
  };
  if (value.moveId !== undefined) result.moveId = id(value.moveId);
  if (value.colorRgba !== undefined) result.colorRgba = [...value.colorRgba];
  return result;
}

function point(value: Point): JsonValue {
  return {
    direction: float64(value.direction),
    pressure: float64(value.pressure),
    speed: float64(value.speed),
    width: float64(value.width),
    x: float64(value.x),
    y: float64(value.y),
  };
}

function glyphRange(value: GlyphRange): JsonValue {
  const result: Record<string, JsonValue> = {
    color: openValue(value.color),
    kind: "glyphRange",
    length: value.length,
    rectangles: value.rectangles.map(rectangle),
    text: value.text,
  };
  if (value.start !== undefined) result.start = value.start;
  if (value.colorRgba !== undefined) result.colorRgba = [...value.colorRgba];
  return result;
}

function rectangle(value: Rectangle): JsonValue {
  return {
    height: float64(value.height),
    width: float64(value.width),
    x: float64(value.x),
    y: float64(value.y),
  };
}

function sequence<T>(value: CrdtSequence<T>, normalizeValue: (item: T) => JsonValue): JsonValue {
  return {
    items: value.sequenceItems().map((item) => sequenceItem(item, normalizeValue)),
    order: value.keys().map(id),
  };
}

function sequenceItem<T>(value: CrdtSequenceItem<T>, normalizeValue: (item: T) => JsonValue): JsonValue {
  return {
    deletedLength: value.deletedLength,
    itemId: id(value.itemId),
    leftId: id(value.leftId),
    rightId: id(value.rightId),
    value: normalizeValue(value.value),
  };
}

function lww<T>(value: LwwValue<T>, normalizeValue: (item: T) => JsonValue): JsonValue {
  return { timestamp: id(value.timestamp), value: normalizeValue(value.value) };
}

function openValue(value: NamedNumericValue<string>): JsonValue {
  return value.name === undefined ? { value: value.value } : { name: value.name, value: value.value };
}

function id(value: CrdtId): JsonValue {
  return { part1: value.part1, part2: value.part2.toString() };
}

function float64(value: number): JsonValue {
  const data = new Uint8Array(8);
  new DataView(data.buffer).setFloat64(0, value, false);
  return { $float64: hex(data) };
}

function bytes(value: Uint8Array): JsonValue {
  return { $bytes: hex(value) };
}

function hex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function identity(value: boolean | null | number | string): JsonValue {
  return value;
}

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortJson(item)]));
  return value;
}
