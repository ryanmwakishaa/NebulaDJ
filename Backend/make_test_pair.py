"""Create a temporary two-track library for deterministic NebulaDJ testing."""
from __future__ import annotations

import argparse
import csv
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?", default="library.csv")
    parser.add_argument("--out", default="test_pair.csv")
    parser.add_argument("--first", default="Malacosta")
    parser.add_argument("--second", default="ZENZELE")
    args = parser.parse_args()

    source = Path(args.source)
    output = Path(args.out)
    if not source.is_file():
        raise SystemExit(f"Library not found: {source}")

    with source.open("r", newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        fields = list(reader.fieldnames or [])
        rows = list(reader)

    if not fields:
        raise SystemExit("The source CSV has no header.")
    if "path" not in fields and "file_path" in fields:
        fields[fields.index("file_path")] = "path"
        for row in rows:
            row["path"] = row.pop("file_path", "")

    if "duration" not in fields and "duration_sec" in fields:
        fields[fields.index("duration_sec")] = "duration"
        for row in rows:
            row["duration"] = row.pop("duration_sec", "")

    if "first_downbeat" not in fields and "first_downbeat_sec" in fields:
        fields[fields.index("first_downbeat_sec")] = "first_downbeat"
        for row in rows:
            row["first_downbeat"] = row.pop("first_downbeat_sec", "")

    def find_one(term: str) -> dict:
        matches = [
            row for row in rows
            if term.casefold() in (row.get("title") or "").casefold()
        ]
        if len(matches) != 1:
            names = [row.get("title", "") for row in matches]
            raise SystemExit(
                f"Expected exactly one title containing {term!r}; "
                f"found {len(matches)}: {names}"
            )
        return matches[0]

    first = find_one(args.first)
    second = find_one(args.second)

    if not {"title", "artist", "bpm", "key", "energy", "genre", "duration"} <= set(fields):
        raise SystemExit("CSV is missing one or more required track columns.")

    for row in (first, second):
        audio_path = (row.get("path") or "").strip()
        if not audio_path:
            raise SystemExit(f"Missing audio path for {row.get('title')!r}.")

    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows((first, second))

    print(f"Created {output.resolve()}")
    print(f"1. {first['title']}")
    print(f"2. {second['title']}")
    print("Original library was not changed.")


if __name__ == "__main__":
    main()
