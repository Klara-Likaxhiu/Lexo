"""Download, validate, and store book cover images in Supabase Storage."""

from __future__ import annotations

import io
import logging
import re
import struct
from typing import Any

import httpx

from app.supabase_client import supabase_anon_key, supabase_service_role_key, supabase_url
from app.supabase_rest import SupabaseRestError, require_service_role

logger = logging.getLogger(__name__)

BUCKET = "book-covers"
MIN_WIDTH = 40
MIN_HEIGHT = 60
MIN_BYTES = 400

_BUCKET_READY = False


def is_hosted_cover_url(url: str | None) -> bool:
    if not url or not isinstance(url, str):
        return False
    base = supabase_url().rstrip("/")
    if not base:
        return False
    marker = f"{base}/storage/v1/object/public/{BUCKET}/"
    return url.startswith(marker)


def storage_object_path(book_id: str, *, placeholder: bool = False) -> str:
    safe = re.sub(r"[^a-zA-Z0-9._-]", "_", book_id)
    suffix = "-placeholder.jpg" if placeholder else ".jpg"
    return f"book-covers/{safe}{suffix}"


def public_storage_url(object_path: str) -> str:
    base = supabase_url().rstrip("/")
    return f"{base}/storage/v1/object/public/{BUCKET}/{object_path}"


def _storage_headers(*, content_type: str, upsert: bool = True) -> dict[str, str]:
    service = require_service_role()
    headers = {
        "apikey": supabase_anon_key(),
        "Authorization": f"Bearer {service}",
        "Content-Type": content_type,
    }
    if upsert:
        headers["x-upsert"] = "true"
    return headers


def ensure_bucket() -> None:
    global _BUCKET_READY
    if _BUCKET_READY:
        return
    base = supabase_url().rstrip("/")
    if not base:
        raise SupabaseRestError("SUPABASE_URL is not configured.", status_code=503)

    service = require_service_role()
    headers = {
        "apikey": supabase_anon_key(),
        "Authorization": f"Bearer {service}",
        "Content-Type": "application/json",
    }

    with httpx.Client(timeout=20.0) as client:
        probe = client.get(f"{base}/storage/v1/bucket/{BUCKET}", headers=headers)
        if probe.status_code == 200:
            _BUCKET_READY = True
            return

        response = client.post(
            f"{base}/storage/v1/bucket",
            headers=headers,
            json={"id": BUCKET, "name": BUCKET, "public": True},
        )
        if response.status_code in {200, 201, 409}:
            _BUCKET_READY = True
            return

        raise SupabaseRestError(
            f"Could not ensure storage bucket {BUCKET!r}: {response.status_code} {response.text[:200]}",
            status_code=response.status_code,
        )


def upload_bytes(object_path: str, data: bytes, content_type: str) -> str:
    ensure_bucket()
    base = supabase_url().rstrip("/")
    url = f"{base}/storage/v1/object/{BUCKET}/{object_path}"

    with httpx.Client(timeout=30.0) as client:
        response = client.post(
            url,
            headers=_storage_headers(content_type=content_type),
            content=data,
        )
        if response.status_code >= 400:
            raise SupabaseRestError(
                response.text or "Cover upload failed.",
                status_code=response.status_code,
            )

    return public_storage_url(object_path)


def _sniff_image_content_type(data: bytes) -> str | None:
    if len(data) >= 2 and data[:2] == b"\xff\xd8":
        return "image/jpeg"
    if len(data) >= 8 and data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if len(data) >= 6 and data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if len(data) >= 12 and data[0:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def download_image(url: str) -> tuple[bytes, str]:
    with httpx.Client(timeout=20.0, follow_redirects=True) as client:
        response = client.get(url)
        if response.status_code >= 400:
            raise SupabaseRestError(
                f"Cover download failed with status {response.status_code}.",
                status_code=response.status_code,
            )

    data = response.content
    if len(data) < MIN_BYTES:
        raise SupabaseRestError("Cover image too small.")

    header_type = (response.headers.get("content-type") or "").split(";")[0].strip().lower()
    if header_type.startswith("image/"):
        content_type = header_type
    else:
        sniffed = _sniff_image_content_type(data)
        if not sniffed:
            raise SupabaseRestError(
                f"Cover download returned non-image content-type: {header_type or 'unknown'}",
            )
        content_type = sniffed

    return data, content_type


def image_dimensions(data: bytes) -> tuple[int, int] | None:
    if len(data) >= 24 and data[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack(">II", data[16:24])

    if len(data) >= 10 and data[:6] in (b"GIF87a", b"GIF89a"):
        return struct.unpack("<HH", data[6:10])

    if len(data) >= 4 and data[:2] == b"\xff\xd8":
        index = 2
        while index < len(data) - 8:
            if data[index] != 0xFF:
                index += 1
                continue
            marker = data[index + 1]
            if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
                height, width = struct.unpack(">HH", data[index + 5 : index + 9])
                return width, height
            if marker in {0xD8, 0xD9}:
                break
            segment_length = struct.unpack(">H", data[index + 2 : index + 4])[0]
            index += 2 + segment_length
        return None

    if len(data) >= 30 and data[0:4] == b"RIFF" and data[8:12] == b"WEBP":
        if data[12:16] == b"VP8 ":
            width, height = struct.unpack("<HH", data[26:30])
            return width & 0x3FFF, height & 0x3FFF

    return None


def validate_image_bytes(data: bytes) -> bool:
    dims = image_dimensions(data)
    if not dims:
        return len(data) >= MIN_BYTES
    width, height = dims
    return width >= MIN_WIDTH and height >= MIN_HEIGHT


def normalize_to_jpeg(data: bytes, content_type: str) -> bytes:
    if content_type in {"image/jpeg", "image/jpg"}:
        return data

    try:
        from PIL import Image
    except ImportError:
        return data

    image = Image.open(io.BytesIO(data))
    if image.mode not in {"RGB", "L"}:
        image = image.convert("RGB")
    out = io.BytesIO()
    image.save(out, format="JPEG", quality=88, optimize=True)
    return out.getvalue()


def generate_placeholder_jpeg(title: str, author: str | None) -> bytes:
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError as exc:
        raise SupabaseRestError("Pillow is required to generate placeholder covers.") from exc

    width, height = 400, 600
    image = Image.new("RGB", (width, height), color=(243, 239, 232))
    draw = ImageDraw.Draw(image)

    draw.rectangle([(0, 0), (width - 1, height - 1)], outline=(47, 62, 79), width=2)

    title_text = (title or "Untitled Book").strip()[:80]
    author_text = (author or "Unknown Author").strip()[:60]

    title_font = ImageFont.load_default()
    author_font = ImageFont.load_default()

    y = 48
    for line in _wrap_text(title_text, 28):
        draw.text((24, y), line, fill=(47, 62, 79), font=title_font)
        y += 22
    y += 10
    for line in _wrap_text(author_text.upper(), 32):
        draw.text((24, y), line, fill=(120, 112, 100), font=author_font)
        y += 18

    out = io.BytesIO()
    image.save(out, format="JPEG", quality=88, optimize=True)
    return out.getvalue()


def _wrap_text(text: str, max_chars: int) -> list[str]:
    words = text.split()
    if not words:
        return [""]
    lines: list[str] = []
    current: list[str] = []
    for word in words:
        candidate = " ".join([*current, word]).strip()
        if len(candidate) > max_chars and current:
            lines.append(" ".join(current))
            current = [word]
        else:
            current.append(word)
    if current:
        lines.append(" ".join(current))
    return lines[:6]


def host_cover_from_url(book_id: str, source_url: str, *, placeholder: bool = False) -> dict[str, Any]:
    data, content_type = download_image(source_url)
    if not validate_image_bytes(data):
        raise SupabaseRestError("Downloaded cover failed dimension validation.")

    jpeg = normalize_to_jpeg(data, content_type)
    object_path = storage_object_path(book_id, placeholder=placeholder)
    public_url = upload_bytes(object_path, jpeg, "image/jpeg")
    return {
        "cover_url": public_url,
        "object_path": object_path,
        "bytes": len(jpeg),
        "external_source_url": source_url,
    }


def host_placeholder(book_id: str, title: str, author: str | None) -> dict[str, Any]:
    jpeg = generate_placeholder_jpeg(title, author)
    object_path = storage_object_path(book_id, placeholder=True)
    public_url = upload_bytes(object_path, jpeg, "image/jpeg")
    return {
        "cover_url": public_url,
        "object_path": object_path,
        "bytes": len(jpeg),
        "external_source_url": None,
    }
