from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import tomllib
from io import BytesIO
from pathlib import Path
from uuid import UUID


EXPECTED_VERSION = "0.8.0"
EXPECTED_COMMIT = "cf86cf0374ca43a53477dd27c65fe2e70e6b4750"
UPSTREAM_VERSIONS = {
    "Bold_Heading_Bullet_Normal.rm": "3.0",
    "Color_and_tool_v3.14.4.rm": "3.14",
    "Lines_v2.rm": "3.1",
    "Lines_v2_updated.rm": "3.2",
    "More_color_highlight_shader_v3.15.4.2.rm": "3.15",
    "Normal_AB.rm": "3.0",
    "Normal_A_stroke_2_layers.rm": "3.0",
    "Normal_A_stroke_2_layers_v3.2.2.rm": "3.2.2",
    "Normal_A_stroke_2_layers_v3.3.2.rm": "3.3.2",
    "Wikipedia_highlighted_p1.rm": "3.1",
    "Wikipedia_highlighted_p2.rm": "3.1",
    "With_SceneInfo_Block.rm": "3.4",
    "test-crdt-ordering.rm": "3.27.3.0",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Regenerate rmscene writer hashes")
    parser.add_argument("--rmscene", type=Path, required=True)
    parser.add_argument("--fixtures", type=Path, default=Path("tests/fixtures"))
    parser.add_argument(
        "--output", type=Path, default=Path("tests/goldens/writer-python.json")
    )
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


def descriptor(data: bytes, version: str) -> dict[str, str | int]:
    return {
        "length": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "version": version,
    }


def main() -> None:
    args = parse_args()
    reference = args.rmscene.resolve()
    verify_reference(reference)
    sys.path.insert(0, str(reference / "src"))
    from rmscene import read_blocks, simple_text_document, write_blocks

    fixtures = args.fixtures.resolve()
    files = {}
    for path in sorted(fixtures.rglob("*.rm")):
        relative = path.relative_to(fixtures).as_posix()
        version = (
            UPSTREAM_VERSIONS[path.name]
            if relative.startswith("rmscene/")
            else "3.27.3.0"
        )
        output = BytesIO()
        write_blocks(
            output,
            read_blocks(BytesIO(path.read_bytes())),
            options={"version": version},
        )
        files[relative] = descriptor(output.getvalue(), version)

    simple = BytesIO()
    write_blocks(
        simple,
        simple_text_document(
            "AB", UUID("495ba59f-c943-2b5c-b455-3682f6948906")
        ),
        options={"version": "3.0"},
    )
    result = {
        "files": files,
        "reference": {"commit": EXPECTED_COMMIT, "version": EXPECTED_VERSION},
        "simpleTextDocument": descriptor(simple.getvalue(), "3.0"),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(result, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"Generated {len(files)} writer hashes at {args.output}")


if __name__ == "__main__":
    main()
