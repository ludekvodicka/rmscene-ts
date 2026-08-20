export interface CrdtId {
  readonly part1: number;
  readonly part2: bigint;
}

export interface LwwValue<T> {
  readonly timestamp: CrdtId;
  readonly value: T;
}

export function crdtId(part1: number, part2: bigint | number): CrdtId {
  if (!Number.isInteger(part1) || part1 < 0 || part1 > 0xff)
    throw new RangeError(`CrdtId part1 must be a uint8, got ${part1}`);
  const value = typeof part2 === "bigint" ? part2 : BigInt(part2);
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn)
    throw new RangeError(`CrdtId part2 must be a uint64, got ${value}`);
  return { part1, part2: value };
}

export function crdtIdKey(value: CrdtId): string {
  return `${value.part1}:${value.part2}`;
}

export function crdtIdsEqual(left: CrdtId, right: CrdtId): boolean {
  return left.part1 === right.part1 && left.part2 === right.part2;
}

export function compareCrdtIds(left: CrdtId, right: CrdtId): number {
  if (left.part1 !== right.part1) return left.part1 - right.part1;
  if (left.part2 < right.part2) return -1;
  else if (left.part2 > right.part2) return 1;
  else return 0;
}

export const END_MARKER = crdtId(0, 0);
