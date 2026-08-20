# Version 6 codec architecture

## Decision

The package is a byte-input and byte-output TypeScript port of `rmscene` 0.8.0. Its pinned Python
commit is the compatibility reference. Unknown firmware data is retained rather than guessed, and
the default writer preserves the exact serialized representation needed for lossless edits.

The source contains no Node APIs. Filesystem, document bundle, template, PNG, network, and credential
work belongs to `rmcommunication-ts`.

## Data flow

```text
Uint8Array
    |
BinaryReader <-> BinaryWriter
    |
TaggedBlockReader <-> TaggedBlockWriter
    |
readBlocks <-> writeBlocks
    |
readTree -> SceneTree -> readText
                         |
                      renderSvg
```

`writeBlocks` accepts blocks, not `SceneTree`. This keeps lossless editing tied to the append-only
block stream and avoids inventing CRDT operations when a caller has only a flattened tree.

## Read boundaries and recovery

Every top-level block and nested length-delimited field gets a bounded cursor. The parent advances to
the declared end before parsing the child. A malformed child therefore cannot consume a following
field, and default-mode recovery resumes at a known block boundary.

Lengths and counts are checked before slicing or allocating. Varuints are limited to the ten bytes
needed for uint64. Remaining bytes are copied to `extraData` or `extraValueData` and reported through
the caller's warning callback. Strict mode rejects structural corruption but deliberately accepts
retained trailing data because firmware extensions are expected.

If a file ends one to seven bytes into the next top-level header, tolerant mode stores those exact
bytes as `UnreadableBlock.partialHeaderData`. The writer emits them directly without inventing the
missing size, version, or type fields. Strict mode rejects the same input.

## Lossless writing

Parsed blocks retain the details that affect byte layout:

- top-level version and unknown header values
- absent versus present optional tagged fields
- CRDT sequence envelope extra bytes
- line timestamps
- unknown and truncated block declarations plus raw payloads
- incomplete final top-level header bytes
- top-level and nested trailing data

With no explicit target version, each known block writes its parsed header versions and field
presence. An `UnreadableBlock` writes its declared block header and retained payload unchanged, even
when the final payload was truncated.

With `WriteOptions.version`, known blocks follow the version-dependent field rules in the pinned
Python writer. This mode is for new output and intentional normalization, not byte-exact preservation.

## Open values and identities

Firmware-controlled numeric sets use `{ value, name? }`, not closed TypeScript enums. Known pen,
color, and paragraph style values receive a name; future values retain the number. `CrdtId.part2` is a
`bigint`, and maps use canonical string keys so object identity does not affect equality.

## Scene, text, and rendering

`readTree` applies append-only blocks to groups and CRDT child sequences. `readText` expands implicit
character IDs, orders concurrent items, applies inline formatting, and returns paragraph spans.

`renderSvg` walks visible groups deterministically. It draws lines, single-point strokes, glyph
rectangles, and typed root text. Page bounds come from `SceneInfo.paperSize` or an explicit caller
option. Content mode starts with the page and expands around off-page geometry. Paper Pro `colorRgba`
overrides palette display color, while unknown palette and pen values use non-fatal preview fallbacks.
Non-finite geometry and cyclic group references throw.

Missing stored glyph lengths are derived from Unicode code points, matching Python rather than UTF-16
code units. SVG text uses `xml:space="preserve"`, and the returned plain text is not trimmed.

The renderer is a preview. Proprietary brush textures, shaders, and exact device font metrics are not
reimplemented.

## Compatibility evidence

Reader goldens are generated only after verifying `rmscene` 0.8.0 and commit
`cf86cf0374ca43a53477dd27c65fe2e70e6b4750`. Writer goldens record Python SHA-256 output for explicit
target versions. All 17 fixtures also round-trip through the default writer byte-for-byte. SVG hashes
cover every fixture plus synthetic visibility, escaping, future values, single points, bounds, and
invalid geometry.

## Entry points

| File | Responsibility |
|---|---|
| `src/binary-reader.ts` | bounded little-endian primitive reads |
| `src/binary-writer.ts` | checked little-endian primitive writes |
| `src/tagged-block-reader.ts` | tagged fields and bounded subblocks |
| `src/tagged-block-writer.ts` | tagged fields and nested payload construction |
| `src/scene-stream.ts` | block types, parsing, recovery, and retained layout data |
| `src/scene-writer.ts` | exhaustive block serialization and simple text generation |
| `src/crdt-sequence.ts` | CRDT storage and deterministic ordering |
| `src/scene-tree.ts` | block application and tree traversal |
| `src/text.ts` | text expansion and paragraph extraction |
| `src/render-svg.ts` | pure deterministic SVG preview output |
| `src/index.ts` | supported package exports |

## Constraints

- Only `.rm` version 6 is supported.
- Inputs and outputs are complete in-memory byte arrays.
- Updating compatibility goldens requires updating the recorded upstream version and commit.
- Device document manifests and ownership paths are not encoded in `.rm` bytes and stay outside this
  package.
