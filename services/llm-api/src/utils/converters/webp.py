"""Convert WebP images to LLM-compatible formats (PNG or JPEG)."""

import io
import logging

from PIL import Image

logger = logging.getLogger(__name__)


def convert_webp(data: bytes, mime_type: str) -> tuple[bytes, str]:
    """
    Convert WebP to PNG (if alpha) or JPEG.

    Most LLM vision models do not accept WebP. This converts to a universally
    supported format while preserving transparency when present.
    """
    try:
        img = Image.open(io.BytesIO(data))
    except Exception as e:
        logger.warning(f"Failed to open WebP image for conversion: {e}")
        return data, mime_type

    has_alpha = img.mode in ('RGBA', 'LA', 'PA')

    buf = io.BytesIO()
    if has_alpha:
        img.save(buf, format='PNG', optimize=True)
        out_mime = 'image/png'
    else:
        if img.mode != 'RGB':
            img = img.convert('RGB')
        img.save(buf, format='JPEG', quality=92, optimize=True)
        out_mime = 'image/jpeg'

    result = buf.getvalue()
    logger.info(f"Converted WebP → {out_mime} ({len(data)} → {len(result)} bytes)")
    return result, out_mime
