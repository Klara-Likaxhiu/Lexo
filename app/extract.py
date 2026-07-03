"""Extract plain text from uploaded files (.txt, .md, .pdf)."""

from __future__ import annotations

import io


class UnsupportedFileType(Exception):
    pass


def extract_text(filename: str, data: bytes) -> str:
    name = (filename or "").lower()

    if name.endswith((".txt", ".md", ".markdown", ".text", "")):
        return _decode_text(data)

    if name.endswith(".pdf"):
        return _extract_pdf(data)

    # Best-effort: try decoding as text before giving up.
    try:
        return _decode_text(data)
    except Exception as exc:  # noqa: BLE001
        raise UnsupportedFileType(
            f"Unsupported file type for '{filename}'. Use .txt, .md, or .pdf."
        ) from exc


def _decode_text(data: bytes) -> str:
    for encoding in ("utf-8", "utf-16", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="ignore")


def _extract_pdf(data: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover
        raise UnsupportedFileType(
            "PDF support requires the 'pypdf' package."
        ) from exc

    reader = PdfReader(io.BytesIO(data))
    pages = []
    for page in reader.pages:
        try:
            pages.append(page.extract_text() or "")
        except Exception:  # noqa: BLE001
            continue
    return "\n\n".join(pages).strip()
