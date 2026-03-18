"""Convert unsupported image formats to LLM-compatible PNG or JPEG."""

import io
import logging

from PIL import Image

logger = logging.getLogger(__name__)

# Formats that all major LLM vision APIs accept natively
LLM_SAFE_MIME_TYPES = {'image/png', 'image/jpeg', 'image/gif'}


class ImageConverter:
    """
    Converts images in unsupported formats to PNG (alpha) or JPEG (opaque).

    Reusable across any source format that Pillow can decode — register
    additional MIME types by calling `ImageConverter().convert` as the
    converter function for that type.
    """

    def convert(self, data: bytes, mime_type: str) -> tuple[bytes, str]:
        try:
            img = Image.open(io.BytesIO(data))
        except Exception as e:
            logger.warning(f"Failed to open image for conversion ({mime_type}): {e}")
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
        logger.info(f"Converted {mime_type} → {out_mime} ({len(data)} → {len(result)} bytes)")
        return result, out_mime


image_converter = ImageConverter()
