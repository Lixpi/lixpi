import json
import logging
from dataclasses import dataclass
from typing import Optional, Any, List

logger = logging.getLogger(__name__)

TOOL_NAME = "generate_image"

TOOL_DESCRIPTION = (
    "Generate an image based on a text prompt. "
    "When the user requests an image, illustration, diagram, logo, or any visual content, "
    "call this tool with a detailed, descriptive prompt optimized for image generation. "
    "The prompt should be vivid, specific, and describe the desired style, composition, "
    "colors, lighting, and mood. Do NOT include any harmful, violent, or explicit content "
    "in the prompt. Always craft a safe, moderation-compliant prompt."
)

TOOL_PARAMETERS = {
    "type": "object",
    "properties": {
        "prompt": {
            "type": "string",
            "description": (
                "A detailed, descriptive prompt for image generation. "
                "Be specific about style, composition, colors, lighting, and mood. "
                "Must be safe and moderation-compliant."
            )
        }
    },
    "required": ["prompt"]
}


@dataclass
class ImageToolCall:
    prompt: str
    tool_call_id: Optional[str] = None


def get_tool_for_provider(provider: str) -> dict:
    if provider == "OpenAI":
        return {
            "type": "function",
            "name": TOOL_NAME,
            "description": TOOL_DESCRIPTION,
            "parameters": TOOL_PARAMETERS,
        }

    if provider == "Anthropic":
        return {
            "name": TOOL_NAME,
            "description": TOOL_DESCRIPTION,
            "input_schema": TOOL_PARAMETERS,
        }

    if provider == "Google":
        return {
            "name": TOOL_NAME,
            "description": TOOL_DESCRIPTION,
            "parameters": TOOL_PARAMETERS,
        }

    raise ValueError(f"Unsupported provider: {provider}")


def extract_tool_call_openai(response) -> Optional[ImageToolCall]:
    if not hasattr(response, 'output') or not response.output:
        return None

    for item in response.output:
        if getattr(item, 'type', None) == 'function_call' and getattr(item, 'name', None) == TOOL_NAME:
            try:
                args = json.loads(item.arguments)
                return ImageToolCall(
                    prompt=args.get('prompt', ''),
                    tool_call_id=getattr(item, 'call_id', None)
                )
            except (json.JSONDecodeError, AttributeError) as e:
                logger.error(f"Failed to parse OpenAI tool call: {e}")
    return None


def extract_tool_call_anthropic(final_message) -> Optional[ImageToolCall]:
    if not hasattr(final_message, 'content') or not final_message.content:
        return None

    for block in final_message.content:
        if getattr(block, 'type', None) == 'tool_use' and getattr(block, 'name', None) == TOOL_NAME:
            args = getattr(block, 'input', {})
            return ImageToolCall(
                prompt=args.get('prompt', ''),
                tool_call_id=getattr(block, 'id', None)
            )
    return None


def extract_tool_call_google(response) -> Optional[ImageToolCall]:
    if not response.candidates:
        return None

    for candidate in response.candidates:
        if not candidate.content or not candidate.content.parts:
            continue

        for part in candidate.content.parts:
            fn_call = getattr(part, 'function_call', None)
            if fn_call and getattr(fn_call, 'name', None) == TOOL_NAME:
                args = dict(fn_call.args) if fn_call.args else {}
                return ImageToolCall(
                    prompt=args.get('prompt', '')
                )
    return None


def extract_tool_call(provider: str, response: Any) -> Optional[ImageToolCall]:
    if provider == "OpenAI":
        return extract_tool_call_openai(response)
    if provider == "Anthropic":
        return extract_tool_call_anthropic(response)
    if provider == "Google":
        return extract_tool_call_google(response)
    return None


def extract_reference_images(messages: list) -> List[str]:
    images = []
    for msg in messages:
        if msg.get('role') != 'user':
            continue
        content = msg.get('content', '')
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict):
                continue
            block_type = block.get('type', '')
            # OpenAI format: input_image with image_url
            if block_type == 'input_image':
                url = block.get('image_url', '')
                if url:
                    images.append(url)
            # Anthropic format: image with source
            elif block_type == 'image':
                source = block.get('source', {})
                if source.get('type') == 'base64':
                    media_type = source.get('media_type', 'image/png')
                    data = source.get('data', '')
                    if data:
                        images.append(f"data:{media_type};base64,{data}")
            # Google format: inline_data
            elif block_type == 'inline_data':
                mime = block.get('mime_type', 'image/png')
                data = block.get('data', '')
                if data:
                    images.append(f"data:{mime};base64,{data}")
    if images:
        logger.info(f"Extracted {len(images)} reference image(s) from conversation")
    return images
