import { CrdtSequence, type CrdtSequenceItem } from "./crdt-sequence.js";
import { crdtId, crdtIdKey, type CrdtId } from "./crdt.js";
import { RmParseError } from "./errors.js";
import { ReadContext, type ReadOptions } from "./read-context.js";
import type { Group, SceneItem, Text } from "./scene-items.js";
import { readBlocksWithContext, type Block, type SceneInfo } from "./scene-stream.js";

export const ROOT_ID = crdtId(0, 1);

export class SceneTree {
  readonly root: Group;
  sceneInfo: SceneInfo | null = null;
  rootText: Text | null = null;
  readonly #nodes = new Map<string, Group>();

  constructor() {
    this.root = {
      kind: "group",
      nodeId: ROOT_ID,
      children: new CrdtSequence(),
      label: { timestamp: crdtId(0, 0), value: "" },
      visible: { timestamp: crdtId(0, 0), value: true },
    };
    this.#nodes.set(crdtIdKey(ROOT_ID), this.root);
  }

  hasNode(nodeId: CrdtId): boolean {
    return this.#nodes.has(crdtIdKey(nodeId));
  }

  getNode(nodeId: CrdtId): Group {
    const node = this.#nodes.get(crdtIdKey(nodeId));
    if (node === undefined) throw new Error(`Unknown scene node ${crdtIdKey(nodeId)}`);
    return node;
  }

  addNode(nodeId: CrdtId): void {
    const key = crdtIdKey(nodeId);
    if (this.#nodes.has(key)) throw new Error(`Scene node ${key} already exists`);
    this.#nodes.set(key, {
      kind: "group",
      nodeId,
      children: new CrdtSequence(),
      label: { timestamp: crdtId(0, 0), value: "" },
      visible: { timestamp: crdtId(0, 0), value: true },
    });
  }

  addItem(item: CrdtSequenceItem<SceneItem | null>, parentId: CrdtId): void {
    this.getNode(parentId).children.add(item);
  }

  *walk(): IterableIterator<SceneItem> {
    yield* walkItem(this.root);
  }
}

export function readTree(data: Uint8Array, options: ReadOptions = {}): SceneTree {
  const context = new ReadContext(options);
  const tree = new SceneTree();
  buildTree(tree, readBlocksWithContext(data, context), context);
  return tree;
}

export function buildTree(tree: SceneTree, blocks: Iterable<Block>, context = new ReadContext()): void {
  for (const block of blocks) {
    try {
      if (block.kind === "sceneTree") tree.addNode(block.treeId);
      else if (block.kind === "treeNode") {
        const node = tree.getNode(block.group.nodeId);
        node.label = block.group.label;
        node.visible = block.group.visible;
        assignOptionalGroupFields(node, block.group);
      } else if (block.kind === "sceneGroupItem") {
        const nodeId = block.item.value;
        if (nodeId === null) continue;
        const node = tree.getNode(nodeId);
        tree.addItem({ ...block.item, value: node }, block.parentId);
      } else if (block.kind === "sceneLineItem" || block.kind === "sceneGlyphItem")
        tree.addItem(block.item, block.parentId);
      else if (block.kind === "sceneInfo") tree.sceneInfo = block;
      else if (block.kind === "rootText") {
        if (tree.rootText !== null)
          context.warn({
            kind: "tree-assembly",
            message: "A later RootText block replaced an earlier RootText block",
            blockType: block.blockType,
          });
        tree.rootText = block.value;
      } else if (block.kind === "unreadable") continue;
      else if (block.kind === "authorIds") continue;
      else if (block.kind === "migrationInfo") continue;
      else if (block.kind === "pageInfo") continue;
      else if (block.kind === "sceneTombstoneItem") continue;
      else if (block.kind === "sceneTextItem") continue;
      else throw new Error(`Unhandled block: ${JSON.stringify(block)}`);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      const error = new RmParseError("malformed-block", `Cannot assemble block type ${block.blockType}: ${detail}`, {
        offset: 0,
        blockType: block.blockType,
        cause,
      });
      context.structural(error, {
        kind: "tree-assembly",
        message: error.message,
        blockType: block.blockType,
      });
    }
  }
}

function assignOptionalGroupFields(target: Group, source: Group): void {
  if (source.anchorId === undefined) delete target.anchorId;
  else target.anchorId = source.anchorId;
  if (source.anchorType === undefined) delete target.anchorType;
  else target.anchorType = source.anchorType;
  if (source.anchorThreshold === undefined) delete target.anchorThreshold;
  else target.anchorThreshold = source.anchorThreshold;
  if (source.anchorOriginX === undefined) delete target.anchorOriginX;
  else target.anchorOriginX = source.anchorOriginX;
}

function* walkItem(item: SceneItem | null): IterableIterator<SceneItem> {
  if (item === null) return;
  if (item.kind === "group") {
    for (const child of item.children.values()) yield* walkItem(child);
  } else if (item.kind === "line") yield item;
  else if (item.kind === "text") yield item;
  else if (item.kind === "glyphRange") yield item;
  else throw new Error(`Unhandled scene item: ${JSON.stringify(item)}`);
}
