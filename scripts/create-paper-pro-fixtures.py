from __future__ import annotations

import argparse
import sys
from dataclasses import replace
from pathlib import Path
from uuid import UUID


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create sanitized Paper Pro .rm fixtures")
    parser.add_argument("--rmscene", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--empty", type=Path, required=True)
    parser.add_argument("--text-highlighter", type=Path, required=True)
    parser.add_argument("--shader", type=Path, required=True)
    parser.add_argument("--text-formatting", type=Path, required=True)
    return parser.parse_args()


def sanitize_string(value: str) -> str:
    return "".join("\n" if character == "\n" else "x" for character in value)


def sanitize_blocks(blocks):
    from rmscene.crdt_sequence import CrdtSequence
    from rmscene.scene_items import GlyphRange, Line, Point, Text
    from rmscene.scene_stream import AuthorIdsBlock, RootTextBlock, SceneGlyphItemBlock, SceneLineItemBlock, TreeNodeBlock
    from rmscene.tagged_block_common import LwwValue

    sanitized = []
    line_index = 0
    for block in blocks:
        block.extra_data = bytes([0xA5]) * len(block.extra_data)
        if hasattr(block, "extra_value_data"):
            length = len(block.extra_value_data)
            block.extra_value_data = bytes.fromhex("9f01010000") if length == 5 else bytes([0xA5]) * length

        if isinstance(block, AuthorIdsBlock):
            block.author_uuids = {
                author_id: UUID(int=index + 1)
                for index, author_id in enumerate(sorted(block.author_uuids))
            }
        elif isinstance(block, TreeNodeBlock):
            block.group.label = LwwValue(block.group.label.timestamp, f"Layer {line_index + 1}")
        elif isinstance(block, SceneLineItemBlock) and isinstance(block.item.value, Line):
            line = block.item.value
            points = []
            for point_index, _ in enumerate(line.points):
                if line_index == 0 and point_index == 0:
                    x, y = -900.0, -100.0
                elif line_index == 0 and point_index == 1:
                    x, y = 900.0, 2300.0
                else:
                    x = float(-700 + ((line_index * 37 + point_index * 13) % 1401))
                    y = float(50 + ((line_index * 73 + point_index * 17) % 2001))
                points.append(
                    Point(
                        x=x,
                        y=y,
                        speed=(line_index * 11 + point_index * 7) % 65536,
                        direction=(line_index * 13 + point_index * 5) % 256,
                        width=20 + ((line_index + point_index) % 80),
                        pressure=40 + ((line_index * 3 + point_index) % 180),
                    )
                )
            block.item = replace(
                block.item,
                value=replace(line, points=points, thickness_scale=1.0, starting_length=0.0),
            )
            line_index += 1
        elif isinstance(block, SceneGlyphItemBlock) and isinstance(block.item.value, GlyphRange):
            block.item = replace(block.item, value=replace(block.item.value, text=sanitize_string(block.item.value.text)))
        elif isinstance(block, RootTextBlock) and isinstance(block.value, Text):
            items = [
                replace(item, value=sanitize_string(item.value) if isinstance(item.value, str) else item.value)
                for item in block.value.items.sequence_items()
            ]
            block.value = replace(
                block.value,
                items=CrdtSequence(items),
                pos_x=-810.0,
                pos_y=100.0,
                width=1620.0,
            )
        sanitized.append(block)
    return sanitized


def write_fixture(source: Path, target: Path) -> None:
    from rmscene import read_blocks, write_blocks

    with source.open("rb") as handle:
        blocks = list(read_blocks(handle))
    with target.open("wb") as handle:
        write_blocks(handle, sanitize_blocks(blocks), options={"version": "3.27.3"})


def main() -> None:
    args = parse_args()
    source_root = args.rmscene.resolve()
    sys.path.insert(0, str(source_root / "src"))
    args.output.mkdir(parents=True, exist_ok=True)
    sources = {
        "paper-pro-empty.rm": args.empty,
        "paper-pro-text-highlighter-overflow.rm": args.text_highlighter,
        "paper-pro-shader-nested-extra.rm": args.shader,
        "paper-pro-text-formatting.rm": args.text_formatting,
    }
    for name, source in sources.items():
        target = args.output / name
        write_fixture(source.resolve(), target)
        print(f"{target}: {target.stat().st_size} bytes")


if __name__ == "__main__":
    main()
