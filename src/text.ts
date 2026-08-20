import { CrdtSequence, type CrdtSequenceItem } from "./crdt-sequence.js";
import { crdtId, crdtIdKey, END_MARKER, type CrdtId, type LwwValue } from "./crdt.js";
import { RmParseError } from "./errors.js";
import { ReadContext, type ReadOptions } from "./read-context.js";
import { paragraphStyleFromValue, type ParagraphStyle, type Text } from "./scene-items.js";
import type { SceneTree } from "./scene-tree.js";

export interface TextProperties {
  readonly "font-weight": "normal" | "bold";
  readonly "font-style": "normal" | "italic";
}

export interface CrdtText {
  readonly text: string;
  readonly ids: readonly CrdtId[];
  readonly properties: TextProperties;
}

export interface Paragraph {
  readonly contents: readonly CrdtText[];
  readonly startId: CrdtId;
  readonly style: LwwValue<ParagraphStyle>;
}

export interface TextDocument {
  readonly contents: readonly Paragraph[];
}

export function readText(tree: SceneTree, options: ReadOptions = {}): TextDocument | null {
  if (tree.rootText === null) return null;
  try {
    return textDocumentFromSceneItem(tree.rootText, new ReadContext(options));
  } catch (cause) {
    if (cause instanceof RmParseError) throw cause;
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new RmParseError("malformed-block", `Cannot assemble root text: ${detail}`, { offset: 0, cause });
  }
}

export function expandTextItem(item: CrdtSequenceItem<string | number>): CrdtSequenceItem<string | number>[] {
  if (item.deletedLength > 0) {
    if (item.value !== "") throw new Error("A deleted text item must have an empty value");
    return expandCharacters(item, Array.from({ length: item.deletedLength }, () => ""), 1);
  } else if (typeof item.value === "number") return [item];
  else {
    const characters = Array.from(item.value);
    if (characters.length === 0) return [];
    return expandCharacters(item, characters, 0);
  }
}

export function expandTextItems(
  items: Iterable<CrdtSequenceItem<string | number>>,
): CrdtSequenceItem<string | number>[] {
  const result: CrdtSequenceItem<string | number>[] = [];
  for (const item of items) result.push(...expandTextItem(item));
  return result;
}

export function textDocumentFromSceneItem(text: Text, context = new ReadContext()): TextDocument {
  const styles = new Map(text.styles.map((entry) => [crdtIdKey(entry.characterId), entry.style]));
  if (!styles.has(crdtIdKey(END_MARKER)))
    styles.set(crdtIdKey(END_MARKER), {
      timestamp: crdtId(0, 0),
      value: paragraphStyleFromValue(1),
    });

  const characters = new CrdtSequence(expandTextItems(text.items.sequenceItems()));
  const keys = characters.keys();
  let properties: TextProperties = { "font-weight": "normal", "font-style": "normal" };
  const paragraphs: Paragraph[] = [];

  while (keys.length > 0) {
    const first = keys[0];
    if (first === undefined) break;
    let startId = END_MARKER;
    if (characters.get(first) === "\n") startId = keys.shift() ?? END_MARKER;
    const contents: Array<{ text: string; ids: CrdtId[]; properties: TextProperties }> = [];

    while (keys.length > 0) {
      const id = keys[0];
      if (id === undefined) break;
      const character = characters.get(id);
      if (typeof character === "number") properties = applyFormattingCode(properties, character, context);
      else if (character === "\n") break;
      else {
        const previous = contents.at(-1);
        if (previous === undefined || !propertiesEqual(previous.properties, properties))
          contents.push({ text: "", ids: [], properties: { ...properties } });
        const current = contents.at(-1);
        if (current === undefined) throw new Error("Text span was not created");
        current.text += character;
        current.ids.push(id);
      }
      keys.shift();
    }

    paragraphs.push({
      contents,
      startId,
      style:
        styles.get(crdtIdKey(startId)) ??
        ({ timestamp: crdtId(0, 0), value: paragraphStyleFromValue(1) } satisfies LwwValue<ParagraphStyle>),
    });
  }
  return { contents: paragraphs };
}

function expandCharacters(
  item: CrdtSequenceItem<string | number>,
  characters: readonly string[],
  deletedLength: number,
): CrdtSequenceItem<string>[] {
  if (characters.length === 0) return [];
  const result: CrdtSequenceItem<string>[] = [];
  let itemId = item.itemId;
  let leftId = item.leftId;
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index];
    if (character === undefined) throw new Error("Missing expanded character");
    const rightId = index === characters.length - 1 ? item.rightId : crdtId(itemId.part1, itemId.part2 + 1n);
    result.push({ itemId, leftId, rightId, deletedLength, value: character });
    leftId = itemId;
    itemId = rightId;
  }
  return result;
}

function applyFormattingCode(properties: TextProperties, code: number, context: ReadContext): TextProperties {
  let result = properties;
  if (code === 1) result = { ...result, "font-weight": "bold" };
  else if (code === 2) result = { ...result, "font-weight": "normal" };

  if (code === 3) result = { ...result, "font-style": "italic" };
  else if (code === 4) result = { ...result, "font-style": "normal" };
  else
    context.warnOnce(`text-format:${code}`, {
      kind: "unknown-text-format",
      message: `Unknown formatting code in text: ${code}; raw code retained`,
    });
  return result;
}

function propertiesEqual(left: TextProperties, right: TextProperties): boolean {
  return left["font-weight"] === right["font-weight"] && left["font-style"] === right["font-style"];
}
