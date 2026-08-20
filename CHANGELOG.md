# Changelog

Every release records the exact `rmscene` revision it follows.

## 0.1.0 - unreleased

Tracks [`rmscene` 0.8.0](https://github.com/ricklupton/rmscene/tree/v0.8.0) at commit
[`cf86cf0374ca43a53477dd27c65fe2e70e6b4750`](https://github.com/ricklupton/rmscene/commit/cf86cf0374ca43a53477dd27c65fe2e70e6b4750).

- Ports the version 6 reader, writer, scene tree assembly, CRDT ordering, and typed text extraction.
- Makes the default read/write path byte-exact for all 17 upstream and sanitized Paper Pro fixtures.
- Matches Python target-version output and `simple_text_document` behavior.
- Adds a deterministic browser-safe SVG preview renderer with scene page sizes, centered and
  overflowing coordinates, visibility, palette and RGBA colors, highlighters, glyph ranges, and typed
  text.
- Retains unknown block data, unknown numeric values, field presence, line timestamps, and unread
  trailing bytes.
- Preserves incomplete final block headers byte-for-byte in tolerant read and write flows.
- Counts fallback glyph lengths by Unicode code point and preserves typed whitespace in SVG output.
- Ships ESM and CommonJS builds with declarations and no runtime dependencies.
- Adds Node 20 and 22 CI with type, unit, package, audit, and dry-pack checks.
- Excludes filesystem access, device communication, templates, PNG conversion, and cloud access.
