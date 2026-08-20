# SVG preview rendering

`renderSvg` is browser-safe and deterministic. Its viewport uses the scene coordinate system, with
the paper's left edge at `-paperWidth / 2` and top at zero. `viewport: "paper"` keeps the page box;
`viewport: "content"` expands it around scene geometry while retaining the full page.

RGBA wins over the palette when firmware stores both. Highlighter opacity is capped at 0.4. Unknown
future pens and colors remain renderable with stable fallback width and black rather than becoming
parser failures. Typed text and glyph rectangles are escaped and emitted in scene order. Text nodes
use `xml:space="preserve"`, and returned plain text retains leading and trailing whitespace. Hidden
groups are not traversed.

The output does not emulate brush textures or the proprietary `xochitl` shader engine. Device system
templates and PNG rasterization belong to `rmcommunication-ts`.
