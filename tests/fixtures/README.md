# Binary fixture provenance

## `rmscene/`

These files come from `rmscene` v0.8.0 at commit
`cf86cf0374ca43a53477dd27c65fe2e70e6b4750`. They are redistributed under the upstream MIT
license. See the repository root `LICENSE` and the lineage section in `README.md`.

## `paper-pro/`

These files are sanitized derivatives of pages written by a reMarkable Paper Pro running software
3.27.3.0 in August 2026. They were regenerated with `scripts/create-paper-pro-fixtures.py`.

The sanitization replaces:

- author UUIDs with deterministic sequential test UUIDs starting at 1
- all typed and glyph text with `x` while retaining newlines and character counts
- layer labels with generic names
- every stroke coordinate and pen-dynamics value with a deterministic test pattern
- unknown trailing payloads with deterministic bytes of the same length

It retains block topology, CRDT relationships, block versions, tools, colors, RGBA values,
tombstones, paper dimensions, point counts, and the lengths and locations of unread data. The
coordinate pattern deliberately contains `(-900, -100)` and `(900, 2300)` to cover centered and
out-of-page coordinates without retaining handwriting.

| Fixture | Coverage |
|---|---|
| `paper-pro-empty.rm` | empty scene, 1620 x 2160 paper, 111 SceneInfo trailing bytes |
| `paper-pro-text-highlighter-overflow.rm` | RootText, 18 trailing bytes, highlighter RGBA, palette color, overflow coordinates |
| `paper-pro-shader-nested-extra.rm` | SHADER tool 23, alternate RGBA, tombstones, nine 5-byte nested trailing values |
| `paper-pro-text-formatting.rm` | raw inline codes 1 and 2, tombstone, 1404 x 1872 paper |

The original device files are not part of this repository and must never be committed.
