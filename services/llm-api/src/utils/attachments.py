"""
Attachment handling utilities for LLM providers.
Provides a unified way to convert attachments (images, files) between provider formats.
"""

import io
import re
import base64
import logging
from enum import Enum
from typing import Dict, Any, List, Union

from PIL import Image

logger = logging.getLogger(__name__)

# Anthropic's 5MB limit applies to the base64-encoded string, not raw bytes.
# Base64 inflates size by ~33% (4/3), so max raw bytes = 5,242,880 * 3/4 = 3,932,160.
MAX_IMAGE_BYTES = 3_750_000  # ~3.75MB raw → ~5MB base64, with safety margin

# Max dimension on the longest side
MAX_IMAGE_DIMENSION = 2048


class AttachmentFormat(Enum):
    """Supported LLM provider formats for attachments."""
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    GOOGLE = "google"


def parse_nats_object_ref(ref: str) -> tuple[str, str] | None:
    """
    Parse a NATS object store reference.

    Args:
        ref: Reference like 'nats-obj://bucket-name/object-key'

    Returns:
        Tuple of (bucket_name, object_key) or None if not a valid reference
    """
    if not ref.startswith('nats-obj://'):
        return None

    path = ref[len('nats-obj://'):]
    parts = path.split('/', 1)
    if len(parts) != 2:
        return None

    return parts[0], parts[1]


def downscale_image_if_needed(data: bytes, mime_type: str) -> tuple[bytes, str]:
    """
    Downscale an image if it exceeds provider size limits.

    Strategy:
    1. If under MAX_IMAGE_BYTES, return as-is (no processing)
    2. Resize if any dimension exceeds MAX_IMAGE_DIMENSION
    3. Re-encode with progressive quality reduction until under limit

    Returns:
        Tuple of (image_bytes, mime_type) — mime_type may change if format conversion is needed
    """
    if len(data) <= MAX_IMAGE_BYTES:
        return data, mime_type

    logger.info(f"Image exceeds {MAX_IMAGE_BYTES} bytes ({len(data)} bytes), downscaling...")

    try:
        img = Image.open(io.BytesIO(data))
    except Exception as e:
        logger.warning(f"Failed to open image for downscaling: {e}")
        return data, mime_type

    has_alpha = img.mode in ('RGBA', 'LA', 'PA')

    # Resize if dimensions exceed the maximum
    width, height = img.size
    longest_side = max(width, height)
    if longest_side > MAX_IMAGE_DIMENSION:
        scale = MAX_IMAGE_DIMENSION / longest_side
        new_width = int(width * scale)
        new_height = int(height * scale)
        img = img.resize((new_width, new_height), Image.LANCZOS)
        logger.info(f"Resized from {width}x{height} to {new_width}x{new_height}")

    # Choose output format: keep PNG for transparency, otherwise JPEG
    if has_alpha:
        out_format = 'PNG'
        out_mime = 'image/png'
    else:
        out_format = 'JPEG'
        out_mime = 'image/jpeg'
        if img.mode != 'RGB':
            img = img.convert('RGB')

    # Try encoding with progressively lower quality
    quality_steps = [92, 85, 78, 70, 60] if out_format == 'JPEG' else [None]

    for quality in quality_steps:
        buf = io.BytesIO()
        save_kwargs = {'format': out_format}
        if quality is not None:
            save_kwargs['quality'] = quality
            save_kwargs['optimize'] = True
        else:
            save_kwargs['optimize'] = True
        img.save(buf, **save_kwargs)
        result = buf.getvalue()

        if len(result) <= MAX_IMAGE_BYTES:
            logger.info(f"Downscaled to {len(result)} bytes (format={out_format}, quality={quality})")
            return result, out_mime

    # PNG was still too large — convert to JPEG as last resort
    if has_alpha:
        logger.info("PNG still too large after optimization, converting to JPEG")
        rgb_img = Image.new('RGB', img.size, (255, 255, 255))
        rgb_img.paste(img, mask=img.split()[-1])
        for quality in [85, 78, 70, 60]:
            buf = io.BytesIO()
            rgb_img.save(buf, format='JPEG', quality=quality, optimize=True)
            result = buf.getvalue()
            if len(result) <= MAX_IMAGE_BYTES:
                logger.info(f"Converted PNG→JPEG, downscaled to {len(result)} bytes (quality={quality})")
                return result, 'image/jpeg'

    # If still too large, do a more aggressive resize
    width, height = img.size
    for scale in [0.75, 0.5]:
        new_w = int(width * scale)
        new_h = int(height * scale)
        resized = img.resize((new_w, new_h), Image.LANCZOS)
        if resized.mode != 'RGB':
            resized = resized.convert('RGB')
        buf = io.BytesIO()
        resized.save(buf, format='JPEG', quality=70, optimize=True)
        result = buf.getvalue()
        if len(result) <= MAX_IMAGE_BYTES:
            logger.info(f"Aggressively resized to {new_w}x{new_h}, {len(result)} bytes")
            return result, 'image/jpeg'

    logger.warning(f"Could not downscale image below {MAX_IMAGE_BYTES} bytes, returning best effort")
    return result, 'image/jpeg'


def _downscale_data_url_block(block: Dict) -> Dict:
    """Downscale an image in a data URL block if it exceeds size limits."""
    url = block.get('image_url', '')
    match = re.match(r'data:([^;]+);base64,(.+)', url, re.DOTALL)
    if not match:
        return block

    mime_type = match.group(1)
    raw_data = base64.b64decode(match.group(2))

    if len(raw_data) <= MAX_IMAGE_BYTES:
        return block

    new_data, new_mime = downscale_image_if_needed(raw_data, mime_type)
    new_b64 = base64.b64encode(new_data).decode('utf-8')
    return {
        **block,
        'image_url': f"data:{new_mime};base64,{new_b64}"
    }


async def resolve_image_urls(content: Union[str, List[Dict]], nats_client=None) -> Union[str, List[Dict]]:
    """
    Resolve image URLs in message content to base64 data URLs.

    Handles:
    - NATS object store references (nats-obj://bucket/key)
    - data: URLs (passed through unchanged)

    This function should be called BEFORE convert_attachments_for_provider.

    Args:
        content: Message content - either a string or list of content blocks
        nats_client: NATS client for object store access

    Returns:
        Content with image URLs resolved to base64 data URLs
    """
    if isinstance(content, str):
        return content

    if not isinstance(content, list):
        return content

    resolved_content = []

    for block in content:
        if not isinstance(block, dict):
            resolved_content.append(block)
            continue

        block_type = block.get('type')

        if block_type == 'input_image':
            url = block.get('image_url', '')

            # Already a data URL - downscale if needed
            if url.startswith('data:'):
                resolved_content.append(_downscale_data_url_block(block))
                continue

            # NATS object store reference
            parsed = parse_nats_object_ref(url)
            if parsed and nats_client:
                bucket_name, object_key = parsed
                try:
                    logger.info(f"Fetching image from NATS object store: {bucket_name}/{object_key}")

                    # Fetch the object data
                    data = await nats_client.get_object(bucket_name, object_key)

                    if data:
                        # Detect mime type from magic bytes
                        mime_type = 'image/png'
                        if len(data) > 4:
                            if data[:2] == b'\xff\xd8':
                                mime_type = 'image/jpeg'
                            elif data[:4] == b'GIF8':
                                mime_type = 'image/gif'
                            elif data[:4] == b'RIFF' and len(data) > 12 and data[8:12] == b'WEBP':
                                mime_type = 'image/webp'
                            elif data[:8] == b'\x89PNG\r\n\x1a\n':
                                mime_type = 'image/png'

                        # Convert to base64 data URL
                        data, mime_type = downscale_image_if_needed(data, mime_type)
                        base64_data = base64.b64encode(data).decode('utf-8')
                        data_url = f"data:{mime_type};base64,{base64_data}"

                        resolved_content.append({
                            **block,
                            'image_url': data_url
                        })
                        logger.info(f"Successfully resolved NATS object reference: {len(data)} bytes, mime: {mime_type}")
                        continue
                    else:
                        logger.warning(f"NATS object not found: {bucket_name}/{object_key}")

                except Exception as e:
                    logger.error(f"Failed to fetch from NATS object store: {e}")
            else:
                logger.warning(f"Unknown image URL format, skipping: {url[:100]}")

            # Fallback - pass through unchanged (will likely fail at provider level)
            resolved_content.append(block)
        else:
            resolved_content.append(block)

    return resolved_content


def parse_data_url(data_url: str) -> tuple[str, str]:
    """
    Parse a base64 data URL into media type and raw base64 data.

    Args:
        data_url: Data URL like 'data:image/jpeg;base64,/9j/4AAQ...'

    Returns:
        Tuple of (media_type, base64_data)

    Raises:
        ValueError: If the data URL format is invalid
    """
    match = re.match(r'data:([^;]+);base64,(.+)', data_url, re.DOTALL)
    if not match:
        raise ValueError(f"Invalid data URL format: {data_url[:50]}...")
    return match.group(1), match.group(2)


def _convert_image_block_to_anthropic(block: Dict) -> Dict:
    """
    Convert an input_image block (OpenAI Responses API format) to Anthropic format.

    Input format (OpenAI Responses API):
        {"type": "input_image", "image_url": "data:image/...;base64,...", "detail": "auto"}

    Output format (Anthropic):
        {"type": "image", "source": {"type": "base64", "media_type": "...", "data": "..."}}
    """
    url = block.get('image_url', '')

    if url.startswith('data:'):
        try:
            media_type, base64_data = parse_data_url(url)
            return {
                'type': 'image',
                'source': {
                    'type': 'base64',
                    'media_type': media_type,
                    'data': base64_data
                }
            }
        except ValueError as e:
            logger.warning(f"Failed to parse image data URL: {e}")
            return None
    else:
        # URL-based image
        return {
            'type': 'image',
            'source': {
                'type': 'url',
                'url': url
            }
        }


def _convert_file_block_to_anthropic(block: Dict) -> Dict:
    """
    Convert a file attachment block to Anthropic format.
    Currently supports document types that Anthropic can process.
    """
    file_obj = block.get('file', {})
    url = file_obj.get('url', '')
    mime_type = file_obj.get('mime_type', 'application/octet-stream')

    if url.startswith('data:'):
        try:
            media_type, base64_data = parse_data_url(url)
            return {
                'type': 'document',
                'source': {
                    'type': 'base64',
                    'media_type': media_type,
                    'data': base64_data
                }
            }
        except ValueError as e:
            logger.warning(f"Failed to parse file data URL: {e}")
            return None

    return None


def _convert_content_block_to_anthropic(block: Dict) -> Dict:
    """Convert a single content block from OpenAI Responses API format to Anthropic format."""
    block_type = block.get('type')

    if block_type == 'input_text':
        return {
            'type': 'text',
            'text': block.get('text', '')
        }
    elif block_type == 'input_image':
        return _convert_image_block_to_anthropic(block)
    elif block_type == 'file':
        return _convert_file_block_to_anthropic(block)
    else:
        logger.warning(f"Unknown content block type: {block_type}")
        return None


def convert_content_for_anthropic(content: Union[str, List[Dict]]) -> Union[str, List[Dict]]:
    """
    Convert OpenAI Responses API message content to Anthropic format.

    Input format (OpenAI Responses API):
        {"type": "input_text", "text": "..."}
        {"type": "input_image", "image_url": "data:...", "detail": "auto"}

    Output format (Anthropic):
        {"type": "text", "text": "..."}
        {"type": "image", "source": {"type": "base64", ...}}

    Args:
        content: Either a string or a list of content blocks in OpenAI format

    Returns:
        Content in Anthropic format (string or list of blocks)
    """
    if isinstance(content, str):
        return content

    if not isinstance(content, list):
        return content

    anthropic_content = []
    for block in content:
        if not isinstance(block, dict):
            continue

        converted = _convert_content_block_to_anthropic(block)
        if converted:
            anthropic_content.append(converted)

    return anthropic_content if anthropic_content else ''


def convert_content_for_openai(content: Union[str, List[Dict]]) -> Union[str, List[Dict]]:
    """
    Validate and pass through content in OpenAI Responses API format.

    Expected format (OpenAI Responses API):
        {"type": "input_text", "text": "..."}
        {"type": "input_image", "image_url": "...", "detail": "auto"}

    Args:
        content: Either a string or a list of content blocks

    Returns:
        Content in OpenAI Responses API format
    """
    if isinstance(content, str):
        return content

    if not isinstance(content, list):
        return content

    # OpenAI Responses API format - validate and pass through
    validated_content = []
    for block in content:
        if not isinstance(block, dict):
            continue

        block_type = block.get('type')

        if block_type == 'input_text':
            validated_content.append({
                'type': 'input_text',
                'text': block.get('text', '')
            })
        elif block_type == 'input_image':
            validated_content.append({
                'type': 'input_image',
                'image_url': block.get('image_url', ''),
                'detail': block.get('detail', 'auto')
            })
        elif block_type == 'file':
            # OpenAI supports file attachments
            validated_content.append(block)
        else:
            logger.warning(f"Unknown content block type for OpenAI: {block_type}")

    return validated_content if validated_content else ''


def convert_content_for_google(content: Union[str, List[Dict]]) -> Union[str, List[Dict]]:
    """
    Convert OpenAI Responses API message content to Google Gen AI format.

    Input format (OpenAI Responses API):
        {"type": "input_text", "text": "..."}
        {"type": "input_image", "image_url": "data:...", "detail": "auto"}

    Output format (Google Gen AI):
        {"text": "..."}
        {"inline_data": {"mime_type": "...", "data": "..."}}
    """
    if isinstance(content, str):
        return content

    if not isinstance(content, list):
        return content

    google_content = []
    for block in content:
        if not isinstance(block, dict):
            continue

        block_type = block.get('type')

        if block_type == 'input_text':
            google_content.append({
                'text': block.get('text', '')
            })
        elif block_type == 'input_image':
            url = block.get('image_url', '')
            if url.startswith('data:'):
                try:
                    media_type, base64_data = parse_data_url(url)
                    google_content.append({
                        'inline_data': {
                            'mime_type': media_type,
                            'data': base64_data
                        }
                    })
                except ValueError as e:
                    logger.warning(f"Failed to parse image data URL for Google: {e}")
            else:
                logger.warning(f"Unsupported image URL format for Google: {url[:50]}")
        else:
            logger.warning(f"Unknown content block type for Google: {block_type}")

    return google_content if google_content else ''


def convert_attachments_for_provider(
    content: Union[str, List[Dict]],
    target_format: AttachmentFormat
) -> Union[str, List[Dict]]:
    """
    Convert message content with attachments to the target provider format.

    This is the main entry point for attachment conversion. Use this function
    when you need to convert content between different LLM provider formats.

    Args:
        content: Message content - either a string or list of content blocks
        target_format: The target provider format (OPENAI or ANTHROPIC)

    Returns:
        Content converted to the target provider's format

    Example:
        # Convert OpenAI format to Anthropic
        anthropic_content = convert_attachments_for_provider(
            openai_content,
            AttachmentFormat.ANTHROPIC
        )
    """
    if target_format == AttachmentFormat.ANTHROPIC:
        return convert_content_for_anthropic(content)
    elif target_format == AttachmentFormat.OPENAI:
        return convert_content_for_openai(content)
    elif target_format == AttachmentFormat.GOOGLE:
        return convert_content_for_google(content)
    else:
        logger.warning(f"Unknown target format: {target_format}, returning content as-is")
        return content
