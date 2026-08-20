from __future__ import annotations

import argparse
import json
import struct
import subprocess
import sys
import tomllib
from io import BytesIO
from pathlib import Path


EXPECTED_VERSION = "0.8.0"
EXPECTED_COMMIT = "cf86cf0374ca43a53477dd27c65fe2e70e6b4750"
HEADER_V6 = b"reMarkable .lines file, version=6          "


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Regenerate canonical JSON with rmscene 0.8.0")
    parser.add_argument("--rmscene", type=Path, required=True)
    parser.add_argument("--fixtures", type=Path, default=Path("tests/fixtures"))
    parser.add_argument("--output", type=Path, default=Path("tests/goldens"))
    return parser.parse_args()


def verify_reference(root: Path) -> None:
    with (root / "pyproject.toml").open("rb") as handle:
        version = tomllib.load(handle)["tool"]["poetry"]["version"]
    commit = subprocess.check_output(
        ["git", "-C", str(root), "rev-parse", "HEAD"], text=True
    ).strip()
    if version != EXPECTED_VERSION:
        raise RuntimeError(f"Expected rmscene {EXPECTED_VERSION}, got {version}")
    if commit != EXPECTED_COMMIT:
        raise RuntimeError(f"Expected rmscene commit {EXPECTED_COMMIT}, got {commit}")


def float64(value: float | int) -> dict[str, str]:
    return {"$float64": struct.pack(">d", float(value)).hex()}


def raw_bytes(value: bytes) -> dict[str, str]:
    return {"$bytes": value.hex()}


def crdt_id(value) -> dict:
    return {"part1": value.part1, "part2": str(value.part2)}


def lww(value, normalize_value) -> dict:
    return {"timestamp": crdt_id(value.timestamp), "value": normalize_value(value.value)}


def open_value(value) -> dict:
    return {"name": value.name, "value": int(value)}


def point(value) -> dict:
    return {
        "direction": float64(value.direction),
        "pressure": float64(value.pressure),
        "speed": float64(value.speed),
        "width": float64(value.width),
        "x": float64(value.x),
        "y": float64(value.y),
    }


def line(value) -> dict:
    result = {
        "color": open_value(value.color),
        "kind": "line",
        "points": [point(item) for item in value.points],
        "startingLength": float64(value.starting_length),
        "thicknessScale": float64(value.thickness_scale),
        "tool": open_value(value.tool),
    }
    if value.move_id is not None:
        result["moveId"] = crdt_id(value.move_id)
    if value.color_rgba is not None:
        result["colorRgba"] = list(value.color_rgba)
    return result


def rectangle(value) -> dict:
    return {
        "height": float64(value.h),
        "width": float64(value.w),
        "x": float64(value.x),
        "y": float64(value.y),
    }


def glyph_range(value) -> dict:
    result = {
        "color": open_value(value.color),
        "kind": "glyphRange",
        "length": value.length,
        "rectangles": [rectangle(item) for item in value.rectangles],
        "text": value.text,
    }
    if value.start is not None:
        result["start"] = value.start
    if value.color_rgba is not None:
        result["colorRgba"] = list(value.color_rgba)
    return result


def sequence_item(value, normalize_value) -> dict:
    return {
        "deletedLength": value.deleted_length,
        "itemId": crdt_id(value.item_id),
        "leftId": crdt_id(value.left_id),
        "rightId": crdt_id(value.right_id),
        "value": normalize_value(value.value),
    }


def sequence(value, normalize_value) -> dict:
    return {
        "items": [
            sequence_item(item, normalize_value) for item in value.sequence_items()
        ],
        "order": [crdt_id(item_id) for item_id in value],
    }


def raw_text(value) -> dict:
    styles = sorted(value.styles.items(), key=lambda item: item[0])
    return {
        "items": sequence(value.items, lambda item: item),
        "kind": "text",
        "posX": float64(value.pos_x),
        "posY": float64(value.pos_y),
        "styles": [
            {
                "characterId": crdt_id(character_id),
                "style": lww(style, open_value),
            }
            for character_id, style in styles
        ],
        "width": float64(value.width),
    }


def group(value, include_children: bool) -> dict:
    result = {
        "children": (
            sequence(value.children, tree_item)
            if include_children
            else {"items": [], "order": []}
        ),
        "kind": "group",
        "label": lww(value.label, lambda item: item),
        "nodeId": crdt_id(value.node_id),
        "visible": lww(value.visible, lambda item: item),
    }
    if value.anchor_id is not None:
        result["anchorId"] = lww(value.anchor_id, crdt_id)
    if value.anchor_type is not None:
        result["anchorType"] = lww(value.anchor_type, lambda item: item)
    if value.anchor_threshold is not None:
        result["anchorThreshold"] = lww(value.anchor_threshold, float64)
    if value.anchor_origin_x is not None:
        result["anchorOriginX"] = lww(value.anchor_origin_x, float64)
    return result


def tree_item(value):
    from rmscene import scene_items as items

    if value is None:
        return None
    if isinstance(value, items.Group):
        return group(value, True)
    if isinstance(value, items.Line):
        return {"kind": "line"}
    if isinstance(value, items.Text):
        return {"kind": "text"}
    if isinstance(value, items.GlyphRange):
        return {"kind": "glyphRange"}
    raise TypeError(f"Unknown tree item {type(value)}")


def block_headers(data: bytes) -> list[dict]:
    if not data.startswith(HEADER_V6):
        raise ValueError("Wrong fixture header")
    headers = []
    position = len(HEADER_V6)
    while position < len(data):
        if position + 8 > len(data):
            raise ValueError("Truncated fixture block header")
        size, unknown, min_version, current_version, block_type = struct.unpack_from(
            "<IBBBB", data, position
        )
        payload_offset = position + 8
        if unknown != 0 or payload_offset + size > len(data):
            raise ValueError("Invalid fixture block header")
        headers.append(
            {
                "blockType": block_type,
                "currentVersion": current_version,
                "minVersion": min_version,
                "offset": payload_offset,
                "size": size,
            }
        )
        position = payload_offset + size
    return headers


def block_base(block, header: dict) -> dict:
    return {
        "blockType": header["blockType"],
        "currentVersion": header["currentVersion"],
        "extraData": raw_bytes(block.extra_data),
        "minVersion": header["minVersion"],
    }


def normalize_block(block, header: dict) -> dict:
    from rmscene.scene_stream import (
        AuthorIdsBlock,
        MigrationInfoBlock,
        PageInfoBlock,
        RootTextBlock,
        SceneGlyphItemBlock,
        SceneGroupItemBlock,
        SceneInfo,
        SceneLineItemBlock,
        SceneTextItemBlock,
        SceneTombstoneItemBlock,
        SceneTreeBlock,
        TreeNodeBlock,
        UnreadableBlock,
    )

    if isinstance(block, UnreadableBlock):
        raise ValueError(f"Fixture contains unreadable block: {block.error}")
    result = block_base(block, header)
    if isinstance(block, SceneInfo):
        result.update(
            {
                "currentLayer": lww(block.current_layer, crdt_id),
                "kind": "sceneInfo",
            }
        )
        if block.background_visible is not None:
            result["backgroundVisible"] = lww(block.background_visible, lambda item: item)
        if block.root_document_visible is not None:
            result["rootDocumentVisible"] = lww(block.root_document_visible, lambda item: item)
        if block.paper_size is not None:
            result["paperSize"] = list(block.paper_size)
    elif isinstance(block, AuthorIdsBlock):
        result.update(
            {
                "authorUuids": [
                    {"authorId": author_id, "uuid": str(uuid)}
                    for author_id, uuid in block.author_uuids.items()
                ],
                "kind": "authorIds",
            }
        )
    elif isinstance(block, MigrationInfoBlock):
        result.update(
            {
                "isDevice": block.is_device,
                "kind": "migrationInfo",
                "migrationId": crdt_id(block.migration_id),
                "unknown": block._unknown,
            }
        )
    elif isinstance(block, TreeNodeBlock):
        result.update({"group": group(block.group, False), "kind": "treeNode"})
    elif isinstance(block, PageInfoBlock):
        result.update(
            {
                "kind": "pageInfo",
                "loadsCount": block.loads_count,
                "mergesCount": block.merges_count,
                "textCharsCount": block.text_chars_count,
                "textLinesCount": block.text_lines_count,
                "typeFolioUseCount": block.type_folio_use_count,
            }
        )
    elif isinstance(block, SceneTreeBlock):
        result.update(
            {
                "isUpdate": block.is_update,
                "kind": "sceneTree",
                "nodeId": crdt_id(block.node_id),
                "parentId": crdt_id(block.parent_id),
                "treeId": crdt_id(block.tree_id),
            }
        )
    elif isinstance(block, SceneTombstoneItemBlock):
        result.update(scene_item_block(block, "sceneTombstoneItem", lambda item: item))
    elif isinstance(block, SceneGlyphItemBlock):
        result.update(scene_item_block(block, "sceneGlyphItem", lambda item: None if item is None else glyph_range(item)))
    elif isinstance(block, SceneGroupItemBlock):
        result.update(scene_item_block(block, "sceneGroupItem", lambda item: None if item is None else crdt_id(item)))
    elif isinstance(block, SceneLineItemBlock):
        result.update(scene_item_block(block, "sceneLineItem", lambda item: None if item is None else line(item)))
    elif isinstance(block, SceneTextItemBlock):
        result.update(scene_item_block(block, "sceneTextItem", lambda item: item))
    elif isinstance(block, RootTextBlock):
        result.update(
            {
                "blockId": crdt_id(block.block_id),
                "kind": "rootText",
                "value": raw_text(block.value),
            }
        )
    else:
        raise TypeError(f"Unknown block {type(block)}")
    return result


def scene_item_block(block, kind: str, normalize_value) -> dict:
    return {
        "extraValueData": raw_bytes(block.extra_value_data),
        "item": sequence_item(block.item, normalize_value),
        "kind": kind,
        "parentId": crdt_id(block.parent_id),
    }


def normalize_tree(tree) -> dict:
    result = {
        "root": group(tree.root, True),
        "rootText": tree.root_text is not None,
        "sceneInfo": None,
    }
    if tree.scene_info is not None:
        result["sceneInfo"] = {
            "currentLayer": lww(tree.scene_info.current_layer, crdt_id),
            "paperSize": None if tree.scene_info.paper_size is None else list(tree.scene_info.paper_size),
        }
    return result


def normalize_document(document) -> dict | None:
    if document is None:
        return None
    return {
        "contents": [
            {
                "contents": [
                    {
                        "ids": [crdt_id(item_id) for item_id in span.i],
                        "properties": dict(span.properties),
                        "text": span.s,
                    }
                    for span in paragraph.contents
                ],
                "startId": crdt_id(paragraph.start_id),
                "style": lww(paragraph.style, open_value),
            }
            for paragraph in document.contents
        ]
    }


def normalize_fixture(path: Path) -> dict:
    from rmscene import read_blocks, read_tree
    from rmscene.text import TextDocument

    data = path.read_bytes()
    blocks = list(read_blocks(BytesIO(data)))
    headers = block_headers(data)
    if len(blocks) != len(headers):
        raise ValueError(f"Block count mismatch in {path}")
    tree = read_tree(BytesIO(data))
    document = None if tree.root_text is None else TextDocument.from_scene_item(tree.root_text)
    return {
        "blocks": [normalize_block(block, header) for block, header in zip(blocks, headers)],
        "text": normalize_document(document),
        "tree": normalize_tree(tree),
    }


def main() -> None:
    args = parse_args()
    reference = args.rmscene.resolve()
    verify_reference(reference)
    sys.path.insert(0, str(reference / "src"))
    fixtures = args.fixtures.resolve()
    output = args.output.resolve()
    paths = sorted(fixtures.rglob("*.rm"))
    for path in paths:
        relative = path.relative_to(fixtures)
        target = output / relative.parent / f"{relative.name}.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        normalized = normalize_fixture(path)
        target.write_text(
            json.dumps(normalized, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        print(f"{relative} -> {target.relative_to(output)}")
    print(f"Generated {len(paths)} golden files with rmscene {EXPECTED_VERSION} ({EXPECTED_COMMIT[:7]})")


if __name__ == "__main__":
    main()
