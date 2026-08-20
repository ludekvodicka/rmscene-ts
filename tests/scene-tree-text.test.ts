import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CrdtSequence,
  crdtId,
  readText,
  readTree,
  type CrdtSequenceItem,
  type Text,
  type TextDocument,
} from "../src/index.js";
import { expandTextItem, textDocumentFromSceneItem } from "../src/text.js";

const fixtureDirectory = fileURLToPath(new URL("fixtures/rmscene", import.meta.url));

function fixture(name: string): Uint8Array {
  return readFileSync(`${fixtureDirectory}/${name}`);
}

function formattedLines(document: TextDocument): Array<readonly [string | undefined, string]> {
  return document.contents.map((paragraph) => [
    paragraph.style.value.name,
    paragraph.contents
      .map((span) => {
        let text = span.text;
        if (span.properties["font-weight"] === "bold") text = `<b>${text}</b>`;
        if (span.properties["font-style"] === "italic") text = `<i>${text}</i>`;
        return text;
      })
      .join(""),
  ]);
}

describe("readTree", () => {
  it("assembles layers and lines", () => {
    const tree = readTree(fixture("Normal_A_stroke_2_layers.rm"));
    expect(tree.root.children.values().map((item) => (item?.kind === "group" ? item.label.value : null))).toEqual([
      "Layer 1",
      "Layer 2",
    ]);
    expect([...tree.walk()].filter((item) => item.kind === "line")).toHaveLength(2);
  });

  it("exposes SceneInfo paper size", () => {
    const tree = readTree(fixture("Color_and_tool_v3.14.4.rm"));
    expect(tree.sceneInfo?.paperSize).toEqual([1620, 2160]);
  });
});

describe("readText", () => {
  it("extracts a basic document", () => {
    const document = readText(readTree(fixture("Normal_AB.rm")));
    expect(document === null ? null : formattedLines(document)).toEqual([["PLAIN", "AB"]]);
  });

  it("extracts paragraph styles", () => {
    const document = readText(readTree(fixture("Bold_Heading_Bullet_Normal.rm")));
    expect(document === null ? null : formattedLines(document)).toEqual([
      ["BOLD", "A"],
      ["HEADING", "new line"],
      ["BULLET", "B is a letter of the alphabet"],
      ["PLAIN", "C"],
    ]);
  });

  it("extracts inline formatting", () => {
    const document = readText(readTree(fixture("Normal_A_stroke_2_layers_v3.3.2.rm")));
    expect(document === null ? null : formattedLines(document)).toEqual([
      ["PLAIN", "A"],
      ["PLAIN", "v3.2.2"],
      ["PLAIN", "Normal <b>bold</b> <i>italic</i>"],
      ["PLAIN", "<b>Bold</b> <i>italic</i> normal"],
      ["BOLD", "Bold line"],
      ["PLAIN", "Normal line"],
      ["HEADING", "Heading line"],
    ]);
  });

  it("matches concurrent author ordering", () => {
    const document = readText(readTree(fixture("test-crdt-ordering.rm")));
    expect(document === null ? null : formattedLines(document)).toEqual([["HEADING", "A12_Z"]]);
  });

  it("retains and warns for raw codes 1 and 2", () => {
    const warnings: string[] = [];
    const tree = readTree(fixture("Normal_A_stroke_2_layers_v3.3.2.rm"));
    const document = readText(tree, { onWarning: (warning) => warnings.push(`${warning.kind}:${warning.message}`) });
    expect(document).not.toBeNull();
    expect(warnings).toContain("unknown-text-format:Unknown formatting code in text: 1; raw code retained");
    expect(warnings).toContain("unknown-text-format:Unknown formatting code in text: 2; raw code retained");
    const rawCodes = tree.rootText?.items.sequenceItems().flatMap((item) =>
      typeof item.value === "number" ? [item.value] : [],
    );
    expect(rawCodes).toEqual(expect.arrayContaining([1, 2]));
  });
});

describe("text item expansion", () => {
  const item = (
    itemId: number,
    leftId: number,
    rightId: number,
    deletedLength: number,
    value: string | number,
  ): CrdtSequenceItem<string | number> => ({
    itemId: crdtId(itemId === 0 ? 0 : 1, itemId),
    leftId: crdtId(leftId === 0 ? 0 : 1, leftId),
    rightId: crdtId(rightId === 0 ? 0 : 1, rightId),
    deletedLength,
    value,
  });

  it("expands implicit character ids", () => {
    expect(expandTextItem(item(17, 0, 0, 0, "AAAA"))).toEqual([
      item(17, 0, 18, 0, "A"),
      item(18, 17, 19, 0, "A"),
      item(19, 18, 20, 0, "A"),
      item(20, 19, 0, 0, "A"),
    ]);
  });

  it("keeps formatting codes as sequence items", () => {
    const code = item(17, 0, 0, 0, 1);
    expect(expandTextItem(code)).toEqual([code]);
  });

  it("carries italic formatting across paragraphs", () => {
    const text: Text = {
      kind: "text",
      items: new CrdtSequence([
        item(20, 0, 0, 0, "A"),
        item(21, 20, 0, 0, "B\nC"),
        item(24, 23, 0, 0, "D"),
        item(30, 20, 21, 0, 3),
        item(31, 23, 24, 0, 4),
      ]),
      styles: [],
      posX: -468,
      posY: 234,
      width: 936,
    };
    expect(formattedLines(textDocumentFromSceneItem(text))).toEqual([
      ["PLAIN", "A<i>B</i>"],
      ["PLAIN", "<i>C</i>D"],
    ]);
  });
});
