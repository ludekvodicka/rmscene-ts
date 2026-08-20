import { isHighlighter, Pen, PenColor, type GlyphRange, type Group, type Line, type SceneItem } from "./scene-items.js";
import type { SceneTree } from "./scene-tree.js";
import { readText, type Paragraph, type TextDocument } from "./text.js";

export interface RenderOptions {
  readonly viewport?: "paper" | "content";
  readonly background?: "white" | "transparent";
  readonly paperSize?: readonly [number, number];
}

export interface SvgViewBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SvgRender {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
  readonly viewBox: SvgViewBox;
  readonly strokeCount: number;
  readonly text: string;
}

const CONTENT_MARGIN = 20;
const TEXT_FONT_SIZE = 42;
const TEXT_LINE_HEIGHT = 70;
const HEADING_FONT_SIZE = 56;
const HIGHLIGHTER_OPACITY = 0.4;

const PALETTE: Readonly<Record<number, string>> = {
  [PenColor.BLACK]: "#000000",
  [PenColor.GRAY]: "#808080",
  [PenColor.WHITE]: "#ffffff",
  [PenColor.YELLOW]: "#ffff00",
  [PenColor.GREEN]: "#00ff00",
  [PenColor.PINK]: "#ff00ff",
  [PenColor.BLUE]: "#0000ff",
  [PenColor.RED]: "#ff0000",
  [PenColor.GRAY_OVERLAP]: "#808080",
  [PenColor.HIGHLIGHT]: "#ffed75",
  [PenColor.GREEN_2]: "#00ff00",
  [PenColor.CYAN]: "#00ffff",
  [PenColor.MAGENTA]: "#ff00ff",
  [PenColor.YELLOW_2]: "#ffff00",
};

const TOOL_WIDTH: Readonly<Record<number, number>> = {
  [Pen.HIGHLIGHTER_1]: 1,
  [Pen.HIGHLIGHTER_2]: 1,
  [Pen.MARKER_1]: 0.9,
  [Pen.MARKER_2]: 0.9,
  [Pen.PAINTBRUSH_1]: 0.8,
  [Pen.PAINTBRUSH_2]: 0.8,
  [Pen.CALIGRAPHY]: 0.8,
  [Pen.PENCIL_1]: 0.7,
  [Pen.PENCIL_2]: 0.7,
  [Pen.MECHANICAL_PENCIL_1]: 0.6,
  [Pen.MECHANICAL_PENCIL_2]: 0.6,
};

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface RenderState {
  readonly elements: string[];
  readonly visitedGroups: Set<Group>;
  bounds: Bounds;
  strokeCount: number;
}

export function renderSvg(tree: SceneTree, options: RenderOptions = {}): SvgRender {
  const viewport = options.viewport ?? "content";
  const background = options.background ?? "white";
  if (viewport !== "paper" && viewport !== "content") throw new RangeError(`Unknown viewport ${String(viewport)}`);
  if (background !== "white" && background !== "transparent")
    throw new RangeError(`Unknown background ${String(background)}`);
  const paperSize = options.paperSize ?? tree.sceneInfo?.paperSize;
  if (paperSize === undefined)
    throw new Error("Scene does not contain a paper size; provide RenderOptions.paperSize");
  const [paperWidth, paperHeight] = paperSize;
  requirePositiveFinite(paperWidth, "paper width");
  requirePositiveFinite(paperHeight, "paper height");
  const pageBounds: Bounds = {
    minX: -paperWidth / 2,
    minY: 0,
    maxX: paperWidth / 2,
    maxY: paperHeight,
  };
  const state: RenderState = {
    elements: [],
    visitedGroups: new Set(),
    bounds: { ...pageBounds },
    strokeCount: 0,
  };
  renderGroup(tree.root, state, true);
  const document = readText(tree);
  const text = document === null ? "" : textContent(document);
  if (document !== null && tree.rootText !== null) renderText(document, tree.rootText, state);
  const sourceBounds = viewport === "paper" ? pageBounds : state.bounds;
  const viewBox = roundBounds(sourceBounds);
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${formatNumber(viewBox.width)}" height="${formatNumber(viewBox.height)}" viewBox="${formatNumber(viewBox.x)} ${formatNumber(viewBox.y)} ${formatNumber(viewBox.width)} ${formatNumber(viewBox.height)}">`,
  ];
  if (background === "white")
    parts.push(
      `<rect x="${formatNumber(viewBox.x)}" y="${formatNumber(viewBox.y)}" width="${formatNumber(viewBox.width)}" height="${formatNumber(viewBox.height)}" fill="#ffffff"/>`,
    );
  parts.push(...state.elements, "</svg>");
  return {
    svg: parts.join("\n"),
    width: viewBox.width,
    height: viewBox.height,
    viewBox,
    strokeCount: state.strokeCount,
    text,
  };
}

function renderGroup(group: Group, state: RenderState, ancestorsVisible: boolean): void {
  if (state.visitedGroups.has(group)) throw new Error("Scene contains a cyclic group reference");
  state.visitedGroups.add(group);
  const visible = ancestorsVisible && group.visible.value;
  if (visible) {
    for (const item of group.children.values()) renderItem(item, state);
  }
  state.visitedGroups.delete(group);
}

function renderItem(item: SceneItem | null, state: RenderState): void {
  if (item === null) return;
  if (item.kind === "group") renderGroup(item, state, true);
  else if (item.kind === "line") renderLine(item, state);
  else if (item.kind === "glyphRange") renderGlyphRange(item, state);
  else if (item.kind === "text") return;
  else throw new Error(`Unhandled scene item ${String((item as { readonly kind?: unknown }).kind)}`);
}

function renderLine(line: Line, state: RenderState): void {
  if (line.points.length === 0) return;
  for (const point of line.points) {
    requireFinite(point.x, "point x");
    requireFinite(point.y, "point y");
    requireNonNegativeFinite(point.width, "point width");
  }
  const width = strokeWidth(line);
  const { color, opacity } = lineColor(line);
  for (const point of line.points) {
    extendBounds(state.bounds, point.x, point.y, width / 2 + CONTENT_MARGIN);
  }
  if (line.points.length === 1) {
    const point = line.points[0];
    if (point === undefined) throw new Error("Missing line point");
    state.elements.push(
      `<circle cx="${formatNumber(point.x)}" cy="${formatNumber(point.y)}" r="${formatNumber(width / 2)}" fill="${color}" fill-opacity="${formatOpacity(opacity)}"/>`,
    );
  } else {
    const points = line.points.map((point) => `${formatNumber(point.x)},${formatNumber(point.y)}`).join(" ");
    state.elements.push(
      `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="${formatNumber(width)}" stroke-opacity="${formatOpacity(opacity)}" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
  }
  state.strokeCount++;
}

function renderGlyphRange(value: GlyphRange, state: RenderState): void {
  const { color, opacity } = rgbaOrPalette(value.color.value, value.colorRgba, true);
  for (const rectangle of value.rectangles) {
    requireFinite(rectangle.x, "rectangle x");
    requireFinite(rectangle.y, "rectangle y");
    requireNonNegativeFinite(rectangle.width, "rectangle width");
    requireNonNegativeFinite(rectangle.height, "rectangle height");
    state.bounds.minX = Math.min(state.bounds.minX, rectangle.x - CONTENT_MARGIN);
    state.bounds.minY = Math.min(state.bounds.minY, rectangle.y - CONTENT_MARGIN);
    state.bounds.maxX = Math.max(state.bounds.maxX, rectangle.x + rectangle.width + CONTENT_MARGIN);
    state.bounds.maxY = Math.max(state.bounds.maxY, rectangle.y + rectangle.height + CONTENT_MARGIN);
    state.elements.push(
      `<rect x="${formatNumber(rectangle.x)}" y="${formatNumber(rectangle.y)}" width="${formatNumber(rectangle.width)}" height="${formatNumber(rectangle.height)}" fill="${color}" fill-opacity="${formatOpacity(opacity)}"/>`,
    );
  }
}

function renderText(document: TextDocument, value: { readonly posX: number; readonly posY: number; readonly width: number }, state: RenderState): void {
  requireFinite(value.posX, "text x");
  requireFinite(value.posY, "text y");
  requireNonNegativeFinite(value.width, "text width");
  let y = value.posY;
  for (const paragraph of document.contents) {
    const style = paragraphStyle(paragraph);
    const spans = paragraph.contents
      .map((span) => {
        const weight = span.properties["font-weight"] === "bold" || style.bold ? " font-weight=\"bold\"" : "";
        const italic = span.properties["font-style"] === "italic" ? " font-style=\"italic\"" : "";
        return `<tspan${weight}${italic}>${escapeXml(span.text)}</tspan>`;
      })
      .join("");
    state.elements.push(
      `<text x="${formatNumber(value.posX)}" y="${formatNumber(y)}" font-family="sans-serif" font-size="${style.fontSize}" fill="#000000" xml:space="preserve">${escapeXml(style.prefix)}${spans}</text>`,
    );
    state.bounds.minX = Math.min(state.bounds.minX, value.posX - CONTENT_MARGIN);
    state.bounds.maxX = Math.max(state.bounds.maxX, value.posX + value.width + CONTENT_MARGIN);
    state.bounds.minY = Math.min(state.bounds.minY, y - style.fontSize - CONTENT_MARGIN);
    state.bounds.maxY = Math.max(state.bounds.maxY, y + CONTENT_MARGIN);
    y += style.lineHeight;
  }
}

function paragraphStyle(paragraph: Paragraph): { readonly prefix: string; readonly fontSize: number; readonly lineHeight: number; readonly bold: boolean } {
  const style = paragraph.style.value.value;
  if (style === 0) return { prefix: "", fontSize: TEXT_FONT_SIZE, lineHeight: TEXT_LINE_HEIGHT, bold: false };
  else if (style === 1) return { prefix: "", fontSize: TEXT_FONT_SIZE, lineHeight: TEXT_LINE_HEIGHT, bold: false };
  else if (style === 2) return { prefix: "", fontSize: HEADING_FONT_SIZE, lineHeight: 84, bold: true };
  else if (style === 3) return { prefix: "", fontSize: TEXT_FONT_SIZE, lineHeight: TEXT_LINE_HEIGHT, bold: true };
  else if (style === 4) return { prefix: "• ", fontSize: TEXT_FONT_SIZE, lineHeight: TEXT_LINE_HEIGHT, bold: false };
  else if (style === 5) return { prefix: "◦ ", fontSize: TEXT_FONT_SIZE, lineHeight: TEXT_LINE_HEIGHT, bold: false };
  else if (style === 6) return { prefix: "☐ ", fontSize: TEXT_FONT_SIZE, lineHeight: TEXT_LINE_HEIGHT, bold: false };
  else if (style === 7) return { prefix: "☑ ", fontSize: TEXT_FONT_SIZE, lineHeight: TEXT_LINE_HEIGHT, bold: false };
  else return { prefix: "", fontSize: TEXT_FONT_SIZE, lineHeight: TEXT_LINE_HEIGHT, bold: false };
}

function textContent(document: TextDocument): string {
  return document.contents.map((paragraph) => paragraph.contents.map((span) => span.text).join("")).join("\n");
}

function strokeWidth(line: Line): number {
  requireFinite(line.thicknessScale, "line thickness scale");
  const widths = line.points.map((point) => point.width).filter((width) => width !== 0);
  const base = widths.length === 0 ? line.thicknessScale * 10 : widths.reduce((sum, width) => sum + width, 0) / widths.length;
  const factor = TOOL_WIDTH[line.tool.value] ?? 0.7;
  const width = Math.max((base * factor) / 10, 1);
  requirePositiveFinite(width, "stroke width");
  return width;
}

function lineColor(line: Line): { readonly color: string; readonly opacity: number } {
  const result = rgbaOrPalette(line.color.value, line.colorRgba, false);
  return isHighlighter(line.tool) ? { ...result, opacity: Math.min(result.opacity, HIGHLIGHTER_OPACITY) } : result;
}

function rgbaOrPalette(
  paletteIndex: number,
  rgba: readonly [number, number, number, number] | undefined,
  highlight: boolean,
): { readonly color: string; readonly opacity: number } {
  if (rgba === undefined)
    return { color: PALETTE[paletteIndex] ?? "#000000", opacity: highlight ? HIGHLIGHTER_OPACITY : 1 };
  const [red, green, blue, alpha] = rgba;
  for (const channel of rgba) {
    if (!Number.isInteger(channel) || channel < 0 || channel > 0xff)
      throw new RangeError(`RGBA channels must be uint8 values, got ${JSON.stringify(rgba)}`);
  }
  return {
    color: `#${hex(red)}${hex(green)}${hex(blue)}`,
    opacity: highlight ? Math.min(alpha / 255, HIGHLIGHTER_OPACITY) : alpha / 255,
  };
}

function roundBounds(bounds: Bounds): SvgViewBox {
  const x = Math.floor(bounds.minX);
  const y = Math.floor(bounds.minY);
  const maxX = Math.ceil(bounds.maxX);
  const maxY = Math.ceil(bounds.maxY);
  return { x, y, width: maxX - x, height: maxY - y };
}

function extendBounds(bounds: Bounds, x: number, y: number, radius: number): void {
  bounds.minX = Math.min(bounds.minX, x - radius);
  bounds.minY = Math.min(bounds.minY, y - radius);
  bounds.maxX = Math.max(bounds.maxX, x + radius);
  bounds.maxY = Math.max(bounds.maxY, y + radius);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatNumber(value: number): string {
  requireFinite(value, "SVG number");
  if (Object.is(value, -0)) return "0";
  return Number(value.toFixed(3)).toString();
}

function formatOpacity(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(`Opacity must be from 0 to 1, got ${value}`);
  return Number(value.toFixed(3)).toString();
}

function hex(value: number): string {
  return value.toString(16).padStart(2, "0");
}

function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite, got ${value}`);
}

function requirePositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive and finite, got ${value}`);
}

function requireNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError(`${name} must be non-negative and finite, got ${value}`);
}
