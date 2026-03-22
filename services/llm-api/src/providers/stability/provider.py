"""
Stability AI provider for image generation via the v2beta REST API.
Image-only provider — no text generation. Always called with enable_image_generation=True
via ImageRouter when a text model's tool call routes image generation here.

When reference images are present the provider routes to the control/style
endpoint which extracts stylistic elements from the reference and applies them
to the new generation. Without references, the model-specific generate/*
endpoint is used for pure text-to-image.
"""

import base64
import logging
import uuid
from typing import Dict, Any, Optional

import httpx

from config import settings
from providers.base import BaseLLMProvider, ProviderState
from tools.image_generation import validate_image_prompt

logger = logging.getLogger(__name__)

# Map model IDs to their v2beta API endpoints (text-to-image)
MODEL_ENDPOINT_MAP = {
    'stability-ultra': '/v2beta/stable-image/generate/ultra',
    'sd3.5-large': '/v2beta/stable-image/generate/sd3',
}

# Models that use the /sd3 endpoint and require a `model` field in the request
SD3_MODELS = {'sd3.5-large'}

# Style control endpoint — used when reference images are provided.
# Extracts style from the reference and guides generation accordingly.
STYLE_CONTROL_ENDPOINT = '/v2beta/stable-image/control/style'

# Style transfer endpoint — used when TWO reference images are provided.
# Transforms init_image content using style_image visual characteristics.
STYLE_TRANSFER_ENDPOINT = '/v2beta/stable-image/control/style-transfer'

# Default fidelity for style control (0 = loose match, 1 = strict match)
STYLE_CONTROL_FIDELITY = 0.7


class StabilityProvider(BaseLLMProvider):
    """
    Stability AI image generation provider.
    Uses the v2beta REST API (multipart/form-data).
    """

    def __init__(self, instance_key: str, nats_client, usage_reporter):
        super().__init__(instance_key, nats_client, usage_reporter)

    def get_provider_name(self) -> str:
        return "Stability"

    async def _stream_impl(self, state: ProviderState) -> ProviderState:
        if not state.get('enable_image_generation'):
            raise ValueError("Stability AI is an image-only provider and requires enable_image_generation=True")

        model_version = state['model_version']
        workspace_id = state['workspace_id']
        ai_chat_thread_id = state['ai_chat_thread_id']
        image_size = state.get('image_size', '1:1')
        instance_key = state.get('instance_key', f"{workspace_id}:{ai_chat_thread_id}")

        # --- Inspect incoming messages ---
        messages = state['messages']
        for msg_idx, msg in enumerate(messages):
            content = msg.get('content', '')
            if isinstance(content, list):
                block_types = [b.get('type', '?') if isinstance(b, dict) else type(b).__name__ for b in content]
                logger.debug(
                    "[Stability:%s] msg[%d] role=%s multimodal blockCount=%d blockTypes=%s",
                    instance_key, msg_idx, msg.get('role'), len(content), block_types,
                )

        prompt = self._extract_prompt(messages)
        if not prompt:
            raise ValueError("No prompt found in messages")
        logger.debug("[Stability:%s] Extracted prompt len=%d preview=%s", instance_key, len(prompt), prompt[:120])

        prompt_validation_error = validate_image_prompt(
            prompt,
            state.get('ai_model_meta_info'),
            self.get_provider_name()
        )
        if prompt_validation_error:
            raise ValueError(prompt_validation_error)

        aspect_ratio = self._resolve_aspect_ratio(image_size)

        # --- Extract ALL reference images with detailed logging ---
        all_refs = self._extract_all_reference_images(messages)
        logger.info(
            "[Stability:%s] Found %d reference image(s) in messages",
            instance_key, len(all_refs),
        )

        if len(all_refs) >= 2:
            # Sort by size descending — largest is likely the primary subject
            all_refs.sort(key=lambda r: len(r[0]), reverse=True)
            primary_ref = all_refs[0]  # largest → init_image (subject)
            style_ref = all_refs[1]    # second → style_image (style source)
            logger.debug(
                "[Stability:%s] Two references: init_image=%d bytes (%s), style_image=%d bytes (%s)",
                instance_key,
                len(primary_ref[0]), primary_ref[1],
                len(style_ref[0]), style_ref[1],
            )
            if len(all_refs) > 2:
                logger.warning(
                    "[Stability:%s] %d extra reference(s) skipped — style-transfer accepts max 2",
                    instance_key, len(all_refs) - 2,
                )
        elif len(all_refs) == 1:
            primary_ref = all_refs[0]
            style_ref = None
        else:
            primary_ref = None
            style_ref = None

        await self._publish_image_partial(workspace_id, ai_chat_thread_id, '', 0)

        api_key = settings.STABLE_DIFFUSION_API_KEY
        if not api_key:
            raise ValueError("STABLE_DIFFUSION_API_KEY is not configured")

        request_id = str(uuid.uuid4())

        if primary_ref and style_ref:
            # Two references → style-transfer endpoint
            endpoint = STYLE_TRANSFER_ENDPOINT
            init_bytes, init_mime = primary_ref
            style_bytes, style_mime = style_ref
            init_ext = init_mime.split('/')[-1] if '/' in init_mime else 'png'
            style_ext = style_mime.split('/')[-1] if '/' in style_mime else 'png'
            form_data: Dict[str, Any] = {
                'prompt': prompt,
                'output_format': 'png',
            }
            files = {
                'init_image': (f'init.{init_ext}', init_bytes, init_mime),
                'style_image': (f'style.{style_ext}', style_bytes, style_mime),
            }
        elif primary_ref:
            # Single reference → style control endpoint
            endpoint = STYLE_CONTROL_ENDPOINT
            ref_bytes, ref_mime = primary_ref
            ref_ext = ref_mime.split('/')[-1] if '/' in ref_mime else 'png'
            form_data = {
                'prompt': prompt,
                'output_format': 'png',
                'aspect_ratio': aspect_ratio,
                'fidelity': str(STYLE_CONTROL_FIDELITY),
            }
            files = {
                'image': (f'reference.{ref_ext}', ref_bytes, ref_mime),
            }
        else:
            endpoint = MODEL_ENDPOINT_MAP.get(model_version)
            if not endpoint:
                raise ValueError(f"Unknown Stability model: {model_version}")

            form_data = {
                'prompt': prompt,
                'output_format': 'png',
                'aspect_ratio': aspect_ratio,
            }
            if model_version in SD3_MODELS:
                form_data['model'] = model_version
            files = {'none': (None, '')}

        ref_count = (1 if primary_ref and not style_ref else 2 if style_ref else 0)
        logger.info(
            "[Stability:%s] API request endpoint=%s model=%s aspect=%s "
            "refCount=%d fidelity=%s promptLen=%d formFields=%s",
            instance_key, endpoint, model_version, aspect_ratio,
            ref_count, form_data.get('fidelity', 'N/A'), len(prompt),
            list(form_data.keys()),
        )

        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"https://api.stability.ai{endpoint}",
                headers={
                    'authorization': f'Bearer {api_key}',
                    'accept': 'application/json',
                },
                data=form_data,
                files=files,
            )

        logger.info(
            "[Stability:%s] API response status=%d contentType=%s",
            instance_key, response.status_code,
            response.headers.get('content-type', 'unknown'),
        )

        if response.status_code != 200:
            error_body = response.json() if response.headers.get('content-type', '').startswith('application/json') else {}
            errors = error_body.get('errors', [str(response.status_code)])
            error_name = error_body.get('name', 'api_error')
            logger.error(
                "[Stability:%s] API error name=%s errors=%s body=%s",
                instance_key, error_name, errors, error_body,
            )
            raise RuntimeError(f"Stability API error ({error_name}): {'; '.join(errors)}")

        result = response.json()
        image_base64 = result.get('image', '')
        finish_reason = result.get('finish_reason', '')
        seed = result.get('seed', '')

        logger.info(
            "[Stability:%s] Generation complete finishReason=%s seed=%s imageLen=%d",
            instance_key, finish_reason, seed, len(image_base64),
        )

        if finish_reason == 'CONTENT_FILTERED':
            raise RuntimeError("Image was filtered by Stability AI content moderation. Please try a different prompt.")

        if not image_base64:
            raise RuntimeError("Stability API returned empty image data")

        await self._publish_image_complete(
            workspace_id,
            ai_chat_thread_id,
            image_base64,
            request_id,
            prompt,
            image_model_id=model_version
        )

        state['usage'] = {
            'promptTokens': 0,
            'promptAudioTokens': 0,
            'promptCachedTokens': 0,
            'completionTokens': 0,
            'completionAudioTokens': 0,
            'completionReasoningTokens': 0,
            'totalTokens': 0,
        }
        state['ai_vendor_request_id'] = request_id
        state['image_usage'] = {
            'generatedCount': 1,
            'size': aspect_ratio,
            'quality': 'high',
        }

        return state

    @staticmethod
    def _extract_prompt(messages: list) -> str:
        for msg in reversed(messages):
            if msg.get('role') != 'user':
                continue
            content = msg.get('content', '')
            if isinstance(content, str):
                return content.strip()
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict):
                        if block.get('type') == 'input_text':
                            return block.get('text', '').strip()
                        if block.get('type') == 'text':
                            return block.get('text', '').strip()
                        if 'text' in block:
                            return block['text'].strip()
        return ''

    @staticmethod
    def _resolve_aspect_ratio(image_size: str) -> str:
        if not image_size or image_size == 'auto':
            return '1:1'
        return image_size

    @staticmethod
    def _extract_all_reference_images(messages: list) -> list[tuple[bytes, str]]:
        """Extract ALL reference images from messages, returning list of (bytes, mime_type)."""
        images: list[tuple[bytes, str]] = []
        for msg_idx, msg in enumerate(messages):
            if msg.get('role') != 'user':
                continue
            content = msg.get('content', '')
            if not isinstance(content, list):
                continue
            for block_idx, block in enumerate(content):
                if not isinstance(block, dict):
                    continue
                block_type = block.get('type', '')

                # OpenAI format
                if block_type == 'input_image':
                    url = block.get('image_url', '')
                    result = StabilityProvider._decode_data_url_with_mime(url)
                    if result:
                        logger.debug(
                            "[Stability] Extracted ref image from input_image block msg=%d block=%d bytes=%d mime=%s",
                            msg_idx, block_idx, len(result[0]), result[1],
                        )
                        images.append(result)
                    else:
                        logger.warning(
                            "[Stability] input_image block could not be decoded urlPrefix=%s urlLen=%d",
                            url[:50] if url else '(empty)', len(url),
                        )

                # Anthropic format
                if block_type == 'image':
                    source = block.get('source', {})
                    source_type = source.get('type')
                    if source_type == 'base64':
                        media_type = source.get('media_type', 'image/png')
                        data = source.get('data', '')
                        if data:
                            decoded = base64.b64decode(data)
                            logger.debug(
                                "[Stability] Extracted ref image from Anthropic block msg=%d block=%d bytes=%d mime=%s",
                                msg_idx, block_idx, len(decoded), media_type,
                            )
                            images.append((decoded, media_type))
                            continue
                    logger.warning(
                        "[Stability] Anthropic image block not usable sourceType=%s",
                        source_type,
                    )

                # Google format
                if block_type == 'inline_data':
                    mime = block.get('mime_type', 'image/png')
                    data = block.get('data', '')
                    if data:
                        decoded = base64.b64decode(data)
                        logger.debug(
                            "[Stability] Extracted ref image from Google block msg=%d block=%d bytes=%d mime=%s",
                            msg_idx, block_idx, len(decoded), mime,
                        )
                        images.append((decoded, mime))
                    else:
                        logger.warning("[Stability] Google inline_data block has empty data")

        if not images:
            logger.debug("[Stability] No reference images found after scanning all messages")
        return images

    @staticmethod
    def _extract_reference_image_with_meta(messages: list) -> Optional[tuple[bytes, str]]:
        """Extract the largest reference image from messages, returning (bytes, mime_type) or None."""
        all_refs = StabilityProvider._extract_all_reference_images(messages)
        if not all_refs:
            return None
        # Return the largest image (most detail for style extraction)
        return max(all_refs, key=lambda r: len(r[0]))

    @staticmethod
    def _extract_reference_image(messages: list) -> Optional[bytes]:
        result = StabilityProvider._extract_reference_image_with_meta(messages)
        return result[0] if result else None

    @staticmethod
    def _decode_data_url_with_mime(url: str) -> Optional[tuple[bytes, str]]:
        """Decode a data URL returning (bytes, mime_type) or None."""
        if not url:
            return None
        if url.startswith('data:'):
            # data:image/png;base64,<data>
            header_and_data = url.split(',', 1)
            if len(header_and_data) == 2:
                header = header_and_data[0]  # "data:image/png;base64"
                mime = 'image/png'
                if ':' in header and ';' in header:
                    mime = header.split(':')[1].split(';')[0]
                return base64.b64decode(header_and_data[1]), mime
        logger.warning("[Stability] _decode_data_url_with_mime failed urlPrefix=%s", url[:50])
        return None

    @staticmethod
    def _decode_data_url(url: str) -> Optional[bytes]:
        result = StabilityProvider._decode_data_url_with_mime(url)
        return result[0] if result else None
