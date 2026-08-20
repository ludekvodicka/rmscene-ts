import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CrdtSequence,
  END_MARKER,
  ROOT_ID,
  SceneTree,
  crdtId,
  readTree,
  renderSvg,
  type CrdtSequenceItem,
  type Group,
  type Line,
  type SceneItem,
  type Text,
} from "../src/index.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
const GOLDENS = JSON.parse(readFileSync(join(import.meta.dirname, "goldens", "render-svg.json"), "utf8")) as Readonly<
  Record<
    string,
    {
      readonly sha256: string;
      readonly viewBox: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
      readonly strokeCount: number;
    }
  >
>;

describe("renderSvg fixtures", () => {
  for (const suite of ["rmscene", "paper-pro"]) {
    const directory = join(FIXTURES, suite);
    for (const filename of readdirSync(directory).filter((name) => name.endsWith(".rm")).sort()) {
      const relative = `${suite}/${filename}`;
      it(`matches ${relative}`, () => {
        const tree = readTree(readFileSync(join(directory, filename)));
        const output = renderSvg(
          tree,
          tree.sceneInfo?.paperSize === undefined ? { paperSize: [1404, 1872] } : {},
        );
        const expected = GOLDENS[relative];
        if (expected === undefined) throw new Error(`Missing render golden for ${relative}`);
        expect(createHash("sha256").update(output.svg).digest("hex")).toBe(expected.sha256);
        expect(output.viewBox).toEqual(expected.viewBox);
        expect(output.strokeCount).toBe(expected.strokeCount);
        expect(renderSvg(tree, tree.sceneInfo?.paperSize === undefined ? { paperSize: [1404, 1872] } : {})).toEqual(
          output,
        );
      });
    }
  }

  it("uses the Paper Pro page size stored in each scene", () => {
    const empty = readTree(readFileSync(join(FIXTURES, "paper-pro", "paper-pro-empty.rm")));
    const text = readTree(readFileSync(join(FIXTURES, "paper-pro", "paper-pro-text-formatting.rm")));
    expect(renderSvg(empty, { viewport: "paper" }).viewBox).toEqual({ x: -810, y: 0, width: 1620, height: 2160 });
    expect(renderSvg(text, { viewport: "paper" }).viewBox).toEqual({ x: -702, y: 0, width: 1404, height: 1872 });
  });

  it("expands content bounds around Paper Pro overflow", () => {
    const tree = readTree(readFileSync(join(FIXTURES, "paper-pro", "paper-pro-text-highlighter-overflow.rm")));
    expect(renderSvg(tree, { viewport: "content" }).viewBox).toEqual({ x: -923, y: -123, width: 1846, height: 2446 });
    expect(renderSvg(tree, { viewport: "paper" }).viewBox).toEqual({ x: -810, y: 0, width: 1620, height: 2160 });
  });

  it("uses Paper Pro RGBA highlighter colors", () => {
    const tree = readTree(readFileSync(join(FIXTURES, "paper-pro", "paper-pro-text-highlighter-overflow.rm")));
    const output = renderSvg(tree);
    expect(output.svg).toContain('stroke="#ffed75"');
    expect(output.svg).toContain('stroke-opacity="0.4"');
  });
});

describe("renderSvg synthetic scenes", () => {
  it("renders only visible groups", () => {
    const tree = new SceneTree();
    tree.sceneInfo = sceneInfo(100, 200);
    const visible = addGroup(tree, 2, true);
    const hidden = addGroup(tree, 3, false);
    tree.addItem(sequenceItem(4, line(10, 10, 7)), visible.nodeId);
    tree.addItem(sequenceItem(5, line(20, 20, 8)), hidden.nodeId);
    const output = renderSvg(tree);
    expect(output.strokeCount).toBe(1);
    expect(output.svg).toContain('cx="10"');
    expect(output.svg).not.toContain('cx="20"');
  });

  it("uses a safe fallback for future pen and color values", () => {
    const tree = new SceneTree();
    tree.sceneInfo = sceneInfo(100, 200);
    tree.addItem(sequenceItem(2, line(10, 20, 999, 999)), ROOT_ID);
    expect(renderSvg(tree).svg).toContain('<circle cx="10" cy="20" r="0.5" fill="#000000"');
  });

  it("escapes typed text and retains inline formatting", () => {
    const tree = new SceneTree();
    tree.sceneInfo = sceneInfo(100, 200);
    tree.rootText = text('<&"\'>');
    const output = renderSvg(tree, { background: "transparent" });
    expect(output.text).toBe('<&"\'>');
    expect(output.svg).toContain("&lt;&amp;&quot;&apos;&gt;");
    expect(output.svg).not.toContain("<rect");
  });

  it("preserves leading and trailing typed whitespace", () => {
    const tree = new SceneTree();
    tree.sceneInfo = sceneInfo(100, 200);
    tree.rootText = text("  spaced  ");
    const output = renderSvg(tree, { background: "transparent" });
    expect(output.text).toBe("  spaced  ");
    expect(output.svg).toContain('xml:space="preserve"');
    expect(output.svg).toContain("<tspan>  spaced  </tspan>");
  });

  it("requires a page size when the scene does not provide one", () => {
    expect(() => renderSvg(new SceneTree())).toThrow("provide RenderOptions.paperSize");
    expect(renderSvg(new SceneTree(), { paperSize: [100, 200] }).viewBox).toEqual({
      x: -50,
      y: 0,
      width: 100,
      height: 200,
    });
  });

  it("rejects non-finite geometry", () => {
    const tree = new SceneTree();
    tree.sceneInfo = sceneInfo(100, 200);
    tree.addItem(sequenceItem(2, line(Number.NaN, 20, 0)), ROOT_ID);
    expect(() => renderSvg(tree)).toThrow("point x must be finite");
  });

  it("rejects cyclic group references", () => {
    const tree = new SceneTree();
    tree.sceneInfo = sceneInfo(100, 200);
    const group = addGroup(tree, 2, true);
    group.children.add(sequenceItem(3, group));
    expect(() => renderSvg(tree)).toThrow("cyclic group reference");
  });
});

function sceneInfo(width: number, height: number): SceneTree["sceneInfo"] {
  return {
    kind: "sceneInfo",
    blockType: 9,
    minVersion: 1,
    currentVersion: 1,
    extraData: new Uint8Array(),
    currentLayer: { timestamp: END_MARKER, value: ROOT_ID },
    backgroundVisible: { timestamp: END_MARKER, value: true },
    paperSize: [width, height],
  };
}

function addGroup(tree: SceneTree, part2: number, visible: boolean): Group {
  const id = crdtId(1, part2);
  tree.addNode(id);
  const group = tree.getNode(id);
  group.visible = { timestamp: END_MARKER, value: visible };
  tree.addItem(sequenceItem(part2, group), ROOT_ID);
  return group;
}

function sequenceItem<T extends SceneItem>(part2: number, value: T): CrdtSequenceItem<T> {
  return {
    itemId: crdtId(1, part2),
    leftId: END_MARKER,
    rightId: END_MARKER,
    deletedLength: 0,
    value,
  };
}

function line(x: number, y: number, color: number, tool = 2): Line {
  return {
    kind: "line",
    color: { value: color },
    tool: { value: tool },
    points: [{ x, y, speed: 0, direction: 0, width: 10, pressure: 0 }],
    thicknessScale: 1,
    startingLength: 0,
    timestamp: END_MARKER,
  };
}

function text(value: string): Text {
  return {
    kind: "text",
    items: new CrdtSequence([
      {
        itemId: crdtId(1, 1),
        leftId: END_MARKER,
        rightId: END_MARKER,
        deletedLength: 0,
        value,
      },
    ]),
    styles: [],
    posX: -40,
    posY: 50,
    width: 80,
  };
}
