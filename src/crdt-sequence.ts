import { crdtIdKey, crdtIdsEqual, END_MARKER, type CrdtId } from "./crdt.js";

export interface CrdtSequenceItem<T> {
  readonly itemId: CrdtId;
  readonly leftId: CrdtId;
  readonly rightId: CrdtId;
  readonly deletedLength: number;
  readonly value: T;
  readonly valuePresent?: boolean;
  readonly extraData?: Uint8Array;
}

type GraphNode = CrdtId | "start" | "end";

class MinHeap<T> {
  readonly #items: T[] = [];
  readonly #compare: (left: T, right: T) => number;

  constructor(compare: (left: T, right: T) => number) {
    this.#compare = compare;
  }

  get size(): number {
    return this.#items.length;
  }

  push(value: T): void {
    this.#items.push(value);
    let index = this.#items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      const parentValue = this.#items[parent];
      if (parentValue === undefined || this.#compare(parentValue, value) <= 0) break;
      this.#items[index] = parentValue;
      index = parent;
    }
    this.#items[index] = value;
  }

  pop(): T {
    const root = this.#items[0];
    if (root === undefined) throw new Error("Cannot pop an empty heap");
    const tail = this.#items.pop();
    if (tail === undefined || this.#items.length === 0) return root;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.#items.length) break;
      const leftValue = this.#items[left];
      const rightValue = this.#items[right];
      if (leftValue === undefined) break;
      const child = rightValue !== undefined && this.#compare(rightValue, leftValue) < 0 ? right : left;
      const childValue = this.#items[child];
      if (childValue === undefined || this.#compare(tail, childValue) <= 0) break;
      this.#items[index] = childValue;
      index = child;
    }
    this.#items[index] = tail;
    return root;
  }
}

export class CrdtSequence<T> implements Iterable<CrdtId> {
  readonly #items = new Map<string, CrdtSequenceItem<T>>();

  constructor(items: Iterable<CrdtSequenceItem<T>> = []) {
    for (const item of items) this.add(item);
  }

  get size(): number {
    return this.#items.size;
  }

  add(item: CrdtSequenceItem<T>): void {
    const key = crdtIdKey(item.itemId);
    if (this.#items.has(key)) throw new Error(`Already have CRDT item ${key}`);
    this.#items.set(key, item);
  }

  has(id: CrdtId): boolean {
    return this.#items.has(crdtIdKey(id));
  }

  get(id: CrdtId): T {
    const item = this.#items.get(crdtIdKey(id));
    if (item === undefined) throw new Error(`Unknown CRDT item ${crdtIdKey(id)}`);
    return item.value;
  }

  keys(): CrdtId[] {
    return [...this];
  }

  values(): T[] {
    return this.keys().map((id) => this.get(id));
  }

  entries(): Array<readonly [CrdtId, T]> {
    return this.keys().map((id) => [id, this.get(id)] as const);
  }

  sequenceItems(): CrdtSequenceItem<T>[] {
    return [...this.#items.values()];
  }

  [Symbol.iterator](): Iterator<CrdtId> {
    return topologicalSort(this.#items.values())[Symbol.iterator]();
  }
}

export function topologicalSort<T>(items: Iterable<CrdtSequenceItem<T>>): CrdtId[] {
  const itemMap = new Map<string, CrdtSequenceItem<T>>();
  for (const item of items) itemMap.set(crdtIdKey(item.itemId), item);
  if (itemMap.size === 0) return [];

  const nodes = new Map<string, GraphNode>([
    ["@start", "start"],
    ["@end", "end"],
  ]);
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  const nodeKey = (node: GraphNode): string => {
    if (node === "start") return "@start";
    else if (node === "end") return "@end";
    else return crdtIdKey(node);
  };
  const sideNode = (id: CrdtId, side: "left" | "right"): GraphNode => {
    if (crdtIdsEqual(id, END_MARKER) || !itemMap.has(crdtIdKey(id))) return side === "left" ? "start" : "end";
    return id;
  };
  const addEdge = (from: GraphNode, to: GraphNode): void => {
    const fromKey = nodeKey(from);
    const toKey = nodeKey(to);
    nodes.set(fromKey, from);
    nodes.set(toKey, to);
    inDegree.set(toKey, (inDegree.get(toKey) ?? 0) + 1);
    const list = dependents.get(fromKey);
    if (list === undefined) dependents.set(fromKey, [toKey]);
    else list.push(toKey);
  };

  for (const item of itemMap.values()) {
    nodes.set(crdtIdKey(item.itemId), item.itemId);
    addEdge(sideNode(item.leftId, "left"), item.itemId);
    addEdge(item.itemId, sideNode(item.rightId, "right"));
  }
  for (const key of nodes.keys()) if (!inDegree.has(key)) inDegree.set(key, 0);

  const compareNodes = (left: GraphNode, right: GraphNode): number => {
    const category = (node: GraphNode): number => (node === "start" ? 0 : node === "end" ? 2 : 1);
    const categoryDifference = category(left) - category(right);
    if (categoryDifference !== 0) return categoryDifference;
    if (typeof left === "string" || typeof right === "string") return 0;
    if (left.part1 !== right.part1) return right.part1 - left.part1;
    if (left.part2 < right.part2) return -1;
    else if (left.part2 > right.part2) return 1;
    else return 0;
  };

  const ready = new MinHeap<GraphNode>(compareNodes);
  for (const [key, degree] of inDegree) {
    const node = nodes.get(key);
    if (degree === 0 && node !== undefined) ready.push(node);
  }

  const result: CrdtId[] = [];
  while (ready.size > 0) {
    const node = ready.pop();
    if (node === "end") break;
    if (node !== "start") result.push(node);
    for (const dependentKey of dependents.get(nodeKey(node)) ?? []) {
      const degree = (inDegree.get(dependentKey) ?? 0) - 1;
      inDegree.set(dependentKey, degree);
      const dependent = nodes.get(dependentKey);
      if (degree === 0 && dependent !== undefined) ready.push(dependent);
    }
  }

  const remaining = [...inDegree].filter(([key, degree]) => degree > 0 && key !== "@end");
  if (remaining.length > 0) throw new Error("Cyclic CRDT dependency");
  return result;
}
