import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { CrdtSequence, crdtId, type CrdtSequenceItem } from "../src/index.js";

const id = (value: number) => crdtId(value === 0 ? 0 : 1, value);
const item = <T>(itemId: number, leftId: number, rightId: number, value: T): CrdtSequenceItem<T> => ({
  itemId: id(itemId),
  leftId: id(leftId),
  rightId: id(rightId),
  deletedLength: 0,
  value,
});

describe("CrdtSequence", () => {
  it("orders an empty sequence", () => {
    expect(new CrdtSequence().keys()).toEqual([]);
  });

  it("orders a linear sequence independent of insertion order", () => {
    const items = [item(1, 0, 0, "A"), item(2, 1, 0, "B")];
    expect(new CrdtSequence(items).keys()).toEqual([id(1), id(2)]);
    expect(new CrdtSequence([...items].reverse()).keys()).toEqual([id(1), id(2)]);
  });

  it("puts the higher author first for concurrent inserts", () => {
    const items: CrdtSequenceItem<string>[] = [
      { itemId: crdtId(1, 1), leftId: crdtId(0, 0), rightId: crdtId(0, 0), deletedLength: 0, value: "A" },
      { itemId: crdtId(1, 2), leftId: crdtId(1, 1), rightId: crdtId(0, 0), deletedLength: 0, value: "Z" },
      { itemId: crdtId(2, 1), leftId: crdtId(1, 1), rightId: crdtId(1, 2), deletedLength: 0, value: "12" },
      { itemId: crdtId(1, 3), leftId: crdtId(1, 1), rightId: crdtId(1, 2), deletedLength: 0, value: "_" },
    ];
    expect(new CrdtSequence(items).values().join("")).toBe("A12_Z");
    expect(new CrdtSequence([...items].reverse()).values().join("")).toBe("A12_Z");
  });

  it("sorts overlapping inserts from one author by id", () => {
    const items = [item(8, 0, 0, "A"), item(9, 8, 0, "B"), item(3, 0, 0, "C")];
    expect(new CrdtSequence(items).keys()).toEqual([id(3), id(8), id(9)]);
  });

  it("tolerates missing left and right references", () => {
    const items: CrdtSequenceItem<string>[] = [
      { ...item(28, 0, 15, "A") },
      { ...item(31, 30, 15, ""), deletedLength: 2 },
      { ...item(33, 32, 15, "B") },
      item(15, 0, 0, "C"),
    ];
    expect(new CrdtSequence(items).keys()).toEqual([id(28), id(31), id(33), id(15)]);
  });

  it("rejects cycles", () => {
    const items = [item(1, 2, 0, "A"), item(2, 1, 0, "B")];
    expect(() => new CrdtSequence(items).keys()).toThrowError(/Cyclic/);
  });

  it("rejects duplicate ids", () => {
    expect(() => new CrdtSequence([item(1, 0, 0, "A"), item(1, 0, 0, "B")])).toThrowError(/Already have/);
  });

  it("agrees with an insertion and deletion model", () => {
    const operation = fc.oneof(
      fc.record({ kind: fc.constant("add" as const), position: fc.nat(), value: fc.constantFrom("a", "Z", "×") }),
      fc.record({ kind: fc.constant("empty" as const), position: fc.nat() }),
      fc.record({ kind: fc.constant("delete" as const), position: fc.nat() }),
    );
    fc.assert(
      fc.property(fc.array(operation, { maxLength: 100 }), (operations) => {
        const all = new Map<number, CrdtSequenceItem<string>>();
        const live: CrdtSequenceItem<string>[] = [];
        const expected: string[] = [];
        let nextId = 1;

        for (const operation of operations) {
          if (operation.kind === "delete") {
            if (live.length === 0) continue;
            const position = operation.position % live.length;
            const current = live[position];
            if (current === undefined) throw new Error("Missing model item");
            all.set(Number(current.itemId.part2), { ...current, deletedLength: 1, value: "" });
            live.splice(position, 1);
            expected.splice(position, 1);
            continue;
          }

          const position = operation.position % (live.length + 1);
          const current: CrdtSequenceItem<string> = {
            itemId: id(nextId),
            leftId: live[position - 1]?.itemId ?? id(0),
            rightId: live[position]?.itemId ?? id(0),
            deletedLength: 0,
            value: operation.kind === "add" ? operation.value : "",
          };
          all.set(nextId, current);
          nextId++;
          if (operation.kind === "add") {
            live.splice(position, 0, current);
            expected.splice(position, 0, operation.value);
          }
        }

        expect(new CrdtSequence(all.values()).values().join("")).toBe(expected.join(""));
      }),
      { numRuns: 250 },
    );
  });
});
