import { CrdtSequence } from "./crdt-sequence.js";
import type { CrdtId, LwwValue } from "./crdt.js";
import type { Rgba } from "./tagged-block-reader.js";

export interface NamedNumericValue<Name extends string> {
  readonly value: number;
  readonly name?: Name;
}

export const Pen = {
  PAINTBRUSH_1: 0,
  PENCIL_1: 1,
  BALLPOINT_1: 2,
  MARKER_1: 3,
  FINELINER_1: 4,
  HIGHLIGHTER_1: 5,
  ERASER: 6,
  MECHANICAL_PENCIL_1: 7,
  ERASER_AREA: 8,
  PAINTBRUSH_2: 12,
  MECHANICAL_PENCIL_2: 13,
  PENCIL_2: 14,
  BALLPOINT_2: 15,
  MARKER_2: 16,
  FINELINER_2: 17,
  HIGHLIGHTER_2: 18,
  CALIGRAPHY: 21,
  SHADER: 23,
} as const;

export type PenName = keyof typeof Pen;
export type Pen = NamedNumericValue<PenName>;

export const PenColor = {
  BLACK: 0,
  GRAY: 1,
  WHITE: 2,
  YELLOW: 3,
  GREEN: 4,
  PINK: 5,
  BLUE: 6,
  RED: 7,
  GRAY_OVERLAP: 8,
  HIGHLIGHT: 9,
  GREEN_2: 10,
  CYAN: 11,
  MAGENTA: 12,
  YELLOW_2: 13,
} as const;

export type PenColorName = keyof typeof PenColor;
export type PenColor = NamedNumericValue<PenColorName>;

export const ParagraphStyle = {
  BASIC: 0,
  PLAIN: 1,
  HEADING: 2,
  BOLD: 3,
  BULLET: 4,
  BULLET2: 5,
  CHECKBOX: 6,
  CHECKBOX_CHECKED: 7,
} as const;

export type ParagraphStyleName = keyof typeof ParagraphStyle;
export type ParagraphStyle = NamedNumericValue<ParagraphStyleName>;

function namesByValue<const Values extends Record<string, number>>(values: Values): ReadonlyMap<number, keyof Values> {
  return new Map(Object.entries(values).map(([name, value]) => [value, name as keyof Values]));
}

const PEN_NAMES = namesByValue(Pen);
const COLOR_NAMES = namesByValue(PenColor);
const PARAGRAPH_STYLE_NAMES = namesByValue(ParagraphStyle);

function namedValue<Name extends string>(value: number, names: ReadonlyMap<number, Name>): NamedNumericValue<Name> {
  const name = names.get(value);
  return name === undefined ? { value } : { value, name };
}

export function penFromValue(value: number): Pen {
  return namedValue(value, PEN_NAMES);
}

export function penColorFromValue(value: number): PenColor {
  return namedValue(value, COLOR_NAMES);
}

export function paragraphStyleFromValue(value: number): ParagraphStyle {
  return namedValue(value, PARAGRAPH_STYLE_NAMES);
}

export function isHighlighter(value: Pen | number): boolean {
  const number = typeof value === "number" ? value : value.value;
  return number === Pen.HIGHLIGHTER_1 || number === Pen.HIGHLIGHTER_2;
}

export interface Point {
  readonly x: number;
  readonly y: number;
  readonly speed: number;
  readonly direction: number;
  readonly width: number;
  readonly pressure: number;
}

export interface Line {
  readonly kind: "line";
  readonly color: PenColor;
  readonly tool: Pen;
  readonly points: readonly Point[];
  readonly thicknessScale: number;
  readonly startingLength: number;
  readonly timestamp: CrdtId;
  readonly moveId?: CrdtId;
  readonly colorRgba?: Rgba;
}

export interface TextStyle {
  readonly characterId: CrdtId;
  readonly style: LwwValue<ParagraphStyle>;
}

export interface Text {
  readonly kind: "text";
  readonly items: CrdtSequence<string | number>;
  readonly styles: readonly TextStyle[];
  readonly posX: number;
  readonly posY: number;
  readonly width: number;
}

export interface Rectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface GlyphRange {
  readonly kind: "glyphRange";
  readonly start?: number;
  readonly length: number;
  readonly lengthPresent?: boolean;
  readonly text: string;
  readonly color: PenColor;
  readonly rectangles: readonly Rectangle[];
  readonly colorRgba?: Rgba;
}

export interface Group {
  readonly kind: "group";
  readonly nodeId: CrdtId;
  readonly children: CrdtSequence<SceneItem | null>;
  label: LwwValue<string>;
  visible: LwwValue<boolean>;
  anchorId?: LwwValue<CrdtId>;
  anchorType?: LwwValue<number>;
  anchorThreshold?: LwwValue<number>;
  anchorOriginX?: LwwValue<number>;
}

export type SceneItem = Group | Line | Text | GlyphRange;
