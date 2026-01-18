"""
Attachment handling utilities for LLM providers.
Provides a unified way to convert attachments (images, files) between provider formats.
"""

import re
import logging
from enum import Enum
from typing import Dict, Any, List, Union

logger = logging.getLogger(__name__)


class AttachmentFormat(Enum):
    """Supported LLM provider formats for attachments."""
    OPENAI = "openai"
    ANTHROPIC = "anthropic"


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
    else:
        logger.warning(f"Unknown target format: {target_format}, returning content as-is")
        return content
