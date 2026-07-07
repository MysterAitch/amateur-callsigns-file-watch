"""Mechanical xlsx -> CSV extraction for archived FOI workbooks (issue #139,
tier 3), per ADR 0004's derivation chain:

    raw .xlsx -> raw-extract-sheet-{n}-{slug}.csv (mechanical, committed,
    hash-pinned) -> normalised--*.csv (converter, authored binding in
    meta.json)

This script performs ONLY the first arrow. It is deliberately dumb: every
non-empty sheet is written in full - title rows, preamble, blanks and all -
and no interpretation happens here. Deciding which row is the header, which
columns matter and what they mean is the converter's job (src/shared/
foi-normalise.ts), where it is reviewed and golden-master tested.

Reader: openpyxl (vetted dependency, installed locally; ships as a pure
wheel so installation executes no package code). The extraction runs
locally when new workbooks arrive - CI only re-runs the converters against
these committed extracts, so the Node runtime gains no xlsx dependency.

Determinism and fidelity rules:
  - Output is UTF-8 without BOM, LF endings, minimal RFC-4180 quoting -
    the same framing as the repo's other derived CSVs.
  - Cell rendering is by stored type, verbatim: strings untouched (no
    trimming - hygiene is counted later, in the converter); integers as
    plain digits; datetimes as ISO (date-only when the time is midnight).
    This includes source artefacts: the 2015 exports genuinely store a few
    suffix cells AS dates (Excel's '20DEC' mangling, at export time) - the
    extract renders the date the file asserts, and the converter puts the
    anomaly on the record.
  - Any other cell type (float, bool, ...) aborts the extraction: a new
    value shape deserves review, never a silent str() guess.
  - Trailing all-empty rows and columns are Excel dimension noise (phantom
    cells with no stored value) and are dropped; leading and interior blank
    rows/cells are structure and are kept.
  - Empty sheets are skipped, loudly. Sheet numbering keeps the workbook
    position, so a skipped Sheet2 leaves sheet-1/sheet-3 names honest.

Usage:
    python tools/xlsx-extract.py <entry-dir> [...]

For each workbook found in each entry directory, writes the per-sheet
raw-extract CSVs alongside it and prints bytes/sha256 for meta.json's files
map.
"""

import csv
import hashlib
import io
import re
import sys
from datetime import datetime, date, time
from pathlib import Path

import openpyxl


def slugify(text: str) -> str:
    return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", text.lower()))


def render_cell(value, sheet_title: str, row_index: int) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, bool):  # bool is an int subclass: test first
        raise SystemExit(
            f"unexpected bool cell on sheet {sheet_title!r} row {row_index}: {value!r}"
        )
    if isinstance(value, int):
        return str(value)
    if isinstance(value, datetime):
        if value.time() == time(0, 0, 0):
            return value.date().isoformat()
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, date):
        return value.isoformat()
    raise SystemExit(
        f"unexpected {type(value).__name__} cell on sheet {sheet_title!r} "
        f"row {row_index}: {value!r} - extend the rendering rules (with review)"
    )


def extract_sheet(worksheet) -> list[list[str]] | None:
    rows: list[list[str]] = []
    for row_index, row in enumerate(worksheet.iter_rows(values_only=True), start=1):
        rows.append([render_cell(v, worksheet.title, row_index) for v in row])
    # Drop trailing all-empty rows, then trailing all-empty columns (Excel
    # dimension noise). Leading/interior blanks are structure and stay.
    while rows and all(cell == "" for cell in rows[-1]):
        rows.pop()
    if not rows:
        return None
    width = max(
        (max((i + 1 for i, cell in enumerate(r) if cell != ""), default=0) for r in rows),
    )
    if width == 0:
        return None
    return [r[:width] + [""] * (width - len(r)) for r in rows]


def to_csv_bytes(rows: list[list[str]]) -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n", quoting=csv.QUOTE_MINIMAL)
    writer.writerows(rows)
    return buffer.getvalue().encode("utf-8")


def extract_workbook(xlsx_path: Path) -> None:
    print(f"\n=== {xlsx_path}")
    workbook = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    try:
        for position, worksheet in enumerate(workbook.worksheets, start=1):
            rows = extract_sheet(worksheet)
            if rows is None:
                print(f"  sheet {position} ({worksheet.title!r}): empty - skipped")
                continue
            out_name = f"raw-extract-sheet-{position}-{slugify(worksheet.title)}.csv"
            payload = to_csv_bytes(rows)
            out_path = xlsx_path.parent / out_name
            out_path.write_bytes(payload)
            digest = hashlib.sha256(payload).hexdigest()
            print(f"  {out_name}")
            print(f"    rows: {len(rows)}, bytes: {len(payload)}, sha256: {digest}")
    finally:
        workbook.close()


def main(argv: list[str]) -> None:
    if not argv:
        raise SystemExit("usage: python tools/xlsx-extract.py <entry-dir> [...]")
    for entry in argv:
        workbooks = sorted(Path(entry).glob("*.xlsx"))
        if not workbooks:
            raise SystemExit(f"{entry}: no .xlsx files found")
        for xlsx_path in workbooks:
            extract_workbook(xlsx_path)


if __name__ == "__main__":
    main(sys.argv[1:])
