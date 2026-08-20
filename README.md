# rmscene-ts

`rmscene-ts` reads, writes, and renders reMarkable `.rm` version 6 scene files in TypeScript. It is a
browser-safe port of [`rmscene` 0.8.0](https://github.com/ricklupton/rmscene/tree/v0.8.0), pinned to
commit [`cf86cf0374ca43a53477dd27c65fe2e70e6b4750`](https://github.com/ricklupton/rmscene/commit/cf86cf0374ca43a53477dd27c65fe2e70e6b4750).
The Python project remains the behavioral reference.

The package has no runtime dependencies, accepts and returns `Uint8Array`, works in Node 20+ and
ES2022 browsers, and ships ESM, CommonJS, and TypeScript declarations. It performs no filesystem,
network, credential, tablet, or cloud operations.

## Install

```sh
npm install rmscene-ts
```

## Read a scene

```ts
import { readBlocks, readText, readTree, type ReadWarning } from "rmscene-ts";

const data = new Uint8Array(await file.arrayBuffer());
const warnings: ReadWarning[] = [];
const options = { onWarning: (warning: ReadWarning) => warnings.push(warning) };

const blocks = readBlocks(data, options);
const tree = readTree(data, options);
const document = readText(tree, options);

console.log(tree.sceneInfo?.paperSize, document);
for (const item of tree.walk()) {
  if (item.kind === "line") console.log(item.tool, item.color, item.colorRgba, item.points);
}
```

Warnings are delivered only through `onWarning`; the library does not write to the console. Set
`strict: true` to throw on malformed known blocks. Forward-compatible trailing bytes and unknown
numeric values remain retained in both modes.

## Write `.rm` bytes

```ts
import { readBlocks, writeBlocks } from "rmscene-ts";

const blocks = readBlocks(data);
const unchanged = writeBlocks(blocks);
```

The default writer preserves parsed block versions, optional-field presence, line timestamps,
unknown blocks, incomplete final block headers, `extraData`, and nested `extraValueData`. For every included fixture,
`writeBlocks(readBlocks(data))` returns the exact original bytes.

Pass an explicit target software version when generating new content or intentionally normalizing
field layout according to the Python writer:

```ts
import { simpleTextDocument, writeBlocks } from "rmscene-ts";

const blocks = simpleTextDocument("Hello", { version: "3.27.3.0" });
const data = writeBlocks(blocks, { version: "3.27.3.0" });
```

The writer serializes blocks. It does not flatten a modified `SceneTree` back into blocks or update a
tablet's document manifests. Keep the original block array when making lossless edits.

## Render SVG previews

```ts
import { readTree, renderSvg } from "rmscene-ts";

const tree = readTree(data);
const preview = renderSvg(tree, {
  viewport: "content",
  background: "white",
});

preview.svg;
preview.viewBox;
preview.strokeCount;
preview.text;
```

The renderer reads page dimensions from `SceneInfo`, keeps the horizontally centered stroke
coordinate system, expands a content viewport beyond page bounds, uses Paper Pro RGBA colors when
present, escapes typed text, and preserves leading and trailing typed whitespace. A scene without `SceneInfo.paperSize` requires an explicit
`paperSize: [width, height]`; no device size is guessed.

This is a deterministic preview renderer. It preserves geometry, ordering, colors, text, visibility,
and bounds, but does not emulate every proprietary brush texture, pressure shader, or font metric in
`xochitl`.

## Reader behavior

| Condition | Default mode | Strict mode |
|---|---|---|
| Wrong version 6 header | throws `RmParseError` | throws `RmParseError` |
| Malformed known block | returns `UnreadableBlock`, warns, continues at its declared end | throws `RmParseError` |
| Truncated final block header or payload | retains the incomplete bytes in an `UnreadableBlock`, warns | throws `RmParseError` |
| Unknown block type | retains raw payload in `UnreadableBlock`, warns | same |
| Unknown pen, color, paragraph style, or text code | retains numeric value, warns | same |
| Unread trailing data | retains bytes in `extraData` or `extraValueData`, warns | same |

Pens, colors, and paragraph styles are open numeric values. A known tool is represented as
`{ value: 23, name: "SHADER" }`; a future tool remains observable as `{ value: 255 }`.
`CrdtId.part2` is a `bigint`.

## Paper Pro compatibility

| Input or environment | Support |
|---|---|
| `.rm` version 6 | Yes |
| reMarkable Paper Pro, software 3.27.3.0 | Tested with sanitized fixtures |
| Files in the `rmscene` 0.8.0 test suite | All 13 fixtures match Python goldens |
| Browser | ES2022 with `TextEncoder`, `TextDecoder`, `DataView`, and `BigInt` |
| Node | 20 and newer |
| Older `.rm` versions | No |

Tested Paper Pro scenes contain both 1620 x 2160 and 1404 x 1872 pages. Coordinates can be negative
or exceed the page after the infinite canvas is scrolled. Highlighters can carry both a palette index
and an actual RGBA color.

Forward-compatible trailing data is expected. Sanitized fixtures retain 111 unread bytes in Paper Pro
`SceneInfo`, 18 in `RootText`, and five nested bytes on each of nine SHADER lines.

## Verification and development

The test suite contains all 13 upstream fixtures and four sanitized Paper Pro fixtures. It compares
reader output and explicit writer versions with goldens produced by the pinned Python implementation,
requires byte-exact lossless round trips, and snapshots deterministic SVG output. It also covers
corruption, truncation, random input, unknown values, field presence, ESM, CommonJS, declarations,
and the packed package surface.

```sh
npm ci
npm run check
npm audit
npm pack --dry-run
```

Use `npm run goldens` for reader goldens and `npm run goldens:writer` for writer hashes with the exact
pinned `../rmscene` checkout. Fixture provenance is in
[`tests/fixtures/README.md`](tests/fixtures/README.md). The codec design is in
[`docs/architecture/rm-v6-codec.md`](docs/architecture/rm-v6-codec.md).

## Related package and exclusions

Direct SSH/SFTP, document bundles, backups, templates, PNG output, mirror, and guarded page writeback
belong to the separate `rmcommunication-ts` package. Neither package implements the reMarkable Cloud
protocol.

## License and lineage

MIT. This port is derived from `rmscene`; its original copyright and MIT license are preserved in
[`LICENSE`](LICENSE).
