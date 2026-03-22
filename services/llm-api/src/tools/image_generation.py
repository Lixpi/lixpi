import json
import logging
from dataclasses import dataclass
from math import ceil
from typing import Optional, Any, Dict, List

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

# Fallback maximum prompt length per image provider (characters).
# The selected image model metadata is the source of truth when available.
IMAGE_PROVIDER_MAX_PROMPT_LENGTH_FALLBACK: Dict[str, int] = {
    'Stability': 10000,
}


def get_image_prompt_max_chars(
    image_model_meta_info: Optional[Dict[str, Any]] = None,
    image_provider: Optional[str] = None
) -> Optional[int]:
    if image_model_meta_info:
        value = image_model_meta_info.get('imagePromptMaxChars')
        if isinstance(value, int) and value > 0:
            return value

        if isinstance(value, str) and value.isdigit():
            parsed_value = int(value)
            if parsed_value > 0:
                return parsed_value

        if not image_provider:
            provider_value = image_model_meta_info.get('provider')
            if isinstance(provider_value, str):
                image_provider = provider_value

    if not image_provider:
        return None

    return IMAGE_PROVIDER_MAX_PROMPT_LENGTH_FALLBACK.get(image_provider)


def build_image_prompt_limit_instruction(
    image_model_meta_info: Optional[Dict[str, Any]] = None,
    image_provider: Optional[str] = None
) -> Optional[str]:
    max_len = get_image_prompt_max_chars(image_model_meta_info, image_provider)
    if not max_len:
        return None

    return (
        f"IMPORTANT: The generate_image tool prompt MUST NOT exceed {max_len} characters. "
        "Stay under the limit during generation. Do not emit an overlong prompt that would need truncation."
    )


def apply_image_prompt_limit_to_system_prompt(
    system_prompt: Optional[str],
    image_model_meta_info: Optional[Dict[str, Any]] = None,
    image_provider: Optional[str] = None
) -> Optional[str]:
    limit_instruction = build_image_prompt_limit_instruction(image_model_meta_info, image_provider)
    if not limit_instruction:
        return system_prompt

    if system_prompt:
        return f"{system_prompt}\n\n{limit_instruction}"

    return limit_instruction


def get_image_prompt_output_token_limit(
    current_max_tokens: Optional[int],
    image_model_meta_info: Optional[Dict[str, Any]] = None,
    image_provider: Optional[str] = None
) -> Optional[int]:
    max_chars = get_image_prompt_max_chars(image_model_meta_info, image_provider)
    if not max_chars:
        return current_max_tokens

    constrained_limit = max(256, ceil(max_chars / 4) + 192)
    if current_max_tokens and current_max_tokens > 0:
        return min(current_max_tokens, constrained_limit)

    return constrained_limit


def validate_image_prompt(
    prompt: str,
    image_model_meta_info: Optional[Dict[str, Any]] = None,
    image_provider: Optional[str] = None
) -> Optional[str]:
    max_chars = get_image_prompt_max_chars(image_model_meta_info, image_provider)
    if not max_chars:
        return None

    prompt_length = len(prompt or '')
    if prompt_length <= max_chars:
        return None

    return (
        f"Image prompt exceeds the selected image model limit: {prompt_length} characters > {max_chars} characters."
    )


def build_image_prompt_rewrite_instruction(max_chars: int) -> str:
    return (
        "Rewrite the image generation prompt so it stays within the required character limit while preserving the "
        "same visual intent, composition, subject details, style, lighting, color, and constraints. "
        f"Return only the rewritten prompt text. It must be no more than {max_chars} characters. "
        "Do not add commentary, XML tags, markdown, or quotes."
    )


def _build_tool_description(
    image_model_meta_info: Optional[Dict[str, Any]] = None,
    image_provider: Optional[str] = None
) -> str:
    max_chars = get_image_prompt_max_chars(image_model_meta_info, image_provider)
    if not max_chars:
        return TOOL_DESCRIPTION

    return (
        f"{TOOL_DESCRIPTION} "
        f"CRITICAL CONSTRAINT: The prompt MUST NOT exceed {max_chars} characters. "
        "Prioritize the most impactful visual details when approaching the limit."
    )


def _build_tool_parameters(
    image_model_meta_info: Optional[Dict[str, Any]] = None,
    image_provider: Optional[str] = None
) -> dict:
    max_chars = get_image_prompt_max_chars(image_model_meta_info, image_provider)
    if not max_chars:
        return TOOL_PARAMETERS

    return {
        "type": "object",
        "properties": {
            "prompt": {
                "type": "string",
                "maxLength": max_chars,
                "description": (
                    f"A detailed, descriptive prompt for image generation (max {max_chars} characters). "
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


def get_tool_for_provider(
    provider: str,
    image_model_meta_info: Optional[Dict[str, Any]] = None,
    image_provider: Optional[str] = None
) -> dict:
    description = _build_tool_description(image_model_meta_info, image_provider)
    parameters = _build_tool_parameters(image_model_meta_info, image_provider)

    if provider == "OpenAI":
        return {
            "type": "function",
            "name": TOOL_NAME,
            "description": description,
            "parameters": parameters,
        }

    if provider == "Anthropic":
        return {
            "name": TOOL_NAME,
            "description": description,
            "input_schema": parameters,
        }

    if provider == "Google":
        return {
            "name": TOOL_NAME,
            "description": description,
            "parameters": parameters,
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
    total_user_msgs = 0
    multimodal_msgs = 0

    for msg_idx, msg in enumerate(messages):
        if msg.get('role') != 'user':
            continue
        total_user_msgs += 1
        content = msg.get('content', '')
        if not isinstance(content, list):
            continue
        multimodal_msgs += 1

        for block in content:
            if not isinstance(block, dict):
                continue
            block_type = block.get('type', '')
            # OpenAI format: input_image with image_url
            if block_type == 'input_image':
                url = block.get('image_url', '')
                if url:
                    images.append(url)
                else:
                    logger.warning("[RefImages] input_image block has empty image_url")
            # Anthropic format: image with source
            elif block_type == 'image':
                source = block.get('source', {})
                source_type = source.get('type')
                if source_type == 'base64':
                    media_type = source.get('media_type', 'image/png')
                    data = source.get('data', '')
                    if data:
                        images.append(f"data:{media_type};base64,{data}")
                    else:
                        logger.warning("[RefImages] Anthropic image block has empty data")
                elif source_type == 'url':
                    url = source.get('url', '')
                    logger.warning(
                        "[RefImages] Anthropic URL-based image NOT supported urlPrefix=%s",
                        url[:60],
                    )
                else:
                    logger.warning("[RefImages] Anthropic image block unknown sourceType=%s", source_type)
            # Google format: inline_data
            elif block_type == 'inline_data':
                mime = block.get('mime_type', 'image/png')
                data = block.get('data', '')
                if data:
                    images.append(f"data:{mime};base64,{data}")
                else:
                    logger.warning("[RefImages] Google inline_data block has empty data")

    logger.info(
        "[RefImages] Scan complete totalMsgs=%d userMsgs=%d multimodalMsgs=%d extractedImages=%d",
        len(messages), total_user_msgs, multimodal_msgs, len(images),
    )
    return images
