import base64
import logging
from typing import List

from google import genai
from google.genai import types

from providers.base import BaseLLMProvider, ProviderState
from prompts import get_system_prompt
from config import settings
from utils.attachments import convert_attachments_for_provider, AttachmentFormat, resolve_image_urls
from tools.image_generation import (
    TOOL_NAME,
    apply_image_prompt_limit_to_system_prompt,
    build_image_prompt_rewrite_instruction,
    extract_reference_images,
    extract_tool_call,
    get_tool_for_provider,
)

logger = logging.getLogger(__name__)


class GoogleProvider(BaseLLMProvider):
    """Google Gen AI provider using LangGraph workflow."""

    def __init__(self, instance_key: str, nats_client, usage_reporter):
        super().__init__(instance_key, nats_client, usage_reporter)

        if not settings.GOOGLE_API_KEY:
            raise ValueError("GOOGLE_API_KEY environment variable is required")

        self.client = genai.Client(api_key=settings.GOOGLE_API_KEY)

    def get_provider_name(self) -> str:
        return "Google"

    async def _stream_impl(self, state: ProviderState) -> ProviderState:
        messages = state['messages']
        model_version = state['model_version']
        max_tokens = state.get('max_completion_size')
        temperature = state.get('temperature', 0.7)
        workspace_id = state['workspace_id']
        ai_chat_thread_id = state['ai_chat_thread_id']
        supports_system_prompt = state['ai_model_meta_info'].get('supportsSystemPrompt', True)

        enable_image_generation = state.get('enable_image_generation', False)
        image_size = state.get('image_size', 'auto')

        # Check if this model supports image output based on its modalities metadata from the DB.
        modalities = state['ai_model_meta_info'].get('modalities', [])
        model_supports_image_output = any(
            (m.get('modality') if isinstance(m, dict) else m) == 'image'
            for m in modalities
        )
        # Native image gen path: only when called as the image model via ImageRouter
        effective_image_gen = model_supports_image_output and enable_image_generation

        # Text model path: inject generate_image tool when an image model is selected
        has_image_model = bool(state.get('image_model_version'))
        inject_tool = has_image_model and not enable_image_generation

        # Convert messages to Google Content format
        resolved_messages = []
        contents = []
        for msg_idx, msg in enumerate(messages):
            content = msg.get('content', '')
            content = await resolve_image_urls(content, self.nats_client)

            if isinstance(content, list):
                block_types = [b.get('type', '?') if isinstance(b, dict) else type(b).__name__ for b in content]
                logger.debug(
                    "[Google:%s] msg[%d] role=%s multimodal blockTypes=%s",
                    self.instance_key, msg_idx, msg.get('role'), block_types,
                )

            resolved_messages.append({
                'role': msg.get('role', 'user'),
                'content': content
            })

            content = convert_attachments_for_provider(content, AttachmentFormat.GOOGLE)

            role = msg.get('role', 'user')
            if role == 'assistant':
                role = 'model'

            parts = self._build_parts(content)
            contents.append(types.Content(role=role, parts=parts))

        # Build config
        gen_config_kwargs = {
            'temperature': temperature,
        }

        if max_tokens:
            gen_config_kwargs['max_output_tokens'] = max_tokens

        if effective_image_gen:
            gen_config_kwargs['response_modalities'] = ['TEXT', 'IMAGE']

            if image_size and image_size != 'auto':
                gen_config_kwargs['image_config'] = types.ImageConfig(
                    aspect_ratio=image_size
                )

        # Inject generate_image function tool for text→image routing
        if inject_tool:
            image_tool_def = get_tool_for_provider(
                "Google",
                state.get('image_model_meta_info'),
                state.get('image_provider_name')
            )
            gen_config_kwargs['tools'] = [types.Tool(
                function_declarations=[
                    types.FunctionDeclaration(
                        name=TOOL_NAME,
                        description=image_tool_def["description"],
                        parameters=image_tool_def["parameters"],
                    )
                ]
            )]
            logger.debug("Injected generate_image function tool for image model routing")

        # System instruction, appending image prompt char limit when applicable
        system_instruction = get_system_prompt(include_image_generation=inject_tool) if supports_system_prompt else None
        if inject_tool and system_instruction:
            system_instruction = apply_image_prompt_limit_to_system_prompt(
                system_instruction,
                state.get('image_model_meta_info'),
                state.get('image_provider_name')
            )
        if system_instruction:
            gen_config_kwargs['system_instruction'] = system_instruction

        # Thinking config for Gemini 3+ image models
        if effective_image_gen and not model_version.startswith('gemini-2.5'):
            gen_config_kwargs['thinking_config'] = types.ThinkingConfig(include_thoughts=True)

        logger.debug(f"Streaming from Google model: {model_version}")
        if effective_image_gen:
            logger.debug(f"Image generation enabled with aspect ratio: {image_size}")
        elif inject_tool:
            logger.debug(f"Text model with image model routing enabled")

        try:
            # Skip START_STREAM when called as image model (via ImageRouter)
            # — the text model already manages the stream lifecycle
            if not effective_image_gen:
                await self._publish_stream_start(workspace_id, ai_chat_thread_id)

            config = types.GenerateContentConfig(**gen_config_kwargs)

            if effective_image_gen:
                # Native image generation path (called by ImageRouter)
                # Send placeholder so the frontend shows the animated border immediately
                await self._publish_image_partial(workspace_id, ai_chat_thread_id, "", 0)

                logger.info(
                    "[Google:%s] Calling generate_content model=%s aspectRatio=%s configKeys=%s",
                    self.instance_key, model_version, image_size, list(gen_config_kwargs.keys()),
                )

                response = await self.client.aio.models.generate_content(
                    model=model_version,
                    contents=contents,
                    config=config,
                )

                usage_metadata = response.usage_metadata

                logger.info(
                    "[Google:%s] generate_content returned candidates=%s promptFeedback=%s",
                    self.instance_key,
                    len(response.candidates) if response.candidates else 0,
                    getattr(response, 'prompt_feedback', None),
                )

                # Collect ALL parts then decide which is final image. Gemini 3 image
                # models may return the image inside parts marked `thought=True` and
                # never emit a separate non-thought image part, so we don't rely on
                # the `thought` flag to identify the final image.
                image_parts: list = []  # list of (part_idx, candidate_idx, base64, is_thought)
                text_chunks: list[str] = []

                if response.candidates:
                    for c_idx, candidate in enumerate(response.candidates):
                        finish_reason = getattr(candidate, 'finish_reason', None)
                        safety_ratings = getattr(candidate, 'safety_ratings', None)
                        logger.info(
                            "[Google:%s] candidate[%d] finishReason=%s safetyRatings=%s hasContent=%s parts=%s",
                            self.instance_key, c_idx, finish_reason, safety_ratings,
                            candidate.content is not None,
                            len(candidate.content.parts) if (candidate.content and candidate.content.parts) else 0,
                        )

                        if not candidate.content or not candidate.content.parts:
                            continue

                        for p_idx, part in enumerate(candidate.content.parts):
                            if self.should_stop:
                                break

                            is_thought = bool(getattr(part, 'thought', False))
                            inline = getattr(part, 'inline_data', None)
                            text = getattr(part, 'text', None)
                            mime = getattr(inline, 'mime_type', None) if inline else None
                            data_len = len(inline.data) if (inline and inline.data) else 0

                            logger.info(
                                "[Google:%s] part[%d.%d] thought=%s hasText=%s textLen=%d hasInlineData=%s mime=%s dataLen=%d",
                                self.instance_key, c_idx, p_idx, is_thought,
                                bool(text), len(text) if text else 0,
                                inline is not None, mime, data_len,
                            )

                            if inline and inline.data:
                                image_b64 = base64.b64encode(inline.data).decode('utf-8')
                                image_parts.append((c_idx, p_idx, image_b64, is_thought))
                            elif text:
                                # Text content (could be thought summary or regular text)
                                text_chunks.append(text)

                logger.info(
                    "[Google:%s] Image generation parsed: imageParts=%d textChunks=%d",
                    self.instance_key, len(image_parts), len(text_chunks),
                )

                # Stream any non-thought text back to the frontend
                if text_chunks:
                    await self._publish_stream_chunk(
                        workspace_id, ai_chat_thread_id, ''.join(text_chunks)
                    )

                if not image_parts:
                    err_msg = (
                        f"Google image model {model_version} returned no inline image data. "
                        f"finishReason={getattr(response.candidates[0], 'finish_reason', None) if response.candidates else None} "
                        f"promptFeedback={getattr(response, 'prompt_feedback', None)}"
                    )
                    logger.error("[Google:%s] %s", self.instance_key, err_msg)
                    state['error'] = err_msg
                    # Still publish an empty IMAGE_COMPLETE so the UI unblocks the placeholder
                    await self._publish_image_complete(
                        workspace_id, ai_chat_thread_id, '', '', '',
                        image_model_id=model_version
                    )
                else:
                    # Emit all but the last as IMAGE_PARTIAL, the last as IMAGE_COMPLETE
                    for idx, (_, _, image_b64, _) in enumerate(image_parts[:-1]):
                        await self._publish_image_partial(
                            workspace_id, ai_chat_thread_id, image_b64, idx + 1
                        )

                    final_b64 = image_parts[-1][2]
                    logger.info(
                        "[Google:%s] Publishing IMAGE_COMPLETE finalImageB64Len=%d (from %d total image parts)",
                        self.instance_key, len(final_b64), len(image_parts),
                    )
                    await self._publish_image_complete(
                        workspace_id, ai_chat_thread_id, final_b64, '', '',
                        image_model_id=model_version
                    )

            elif inject_tool:
                # Text model with function tool — stream text AND detect tool calls
                response_stream = await self.client.aio.models.generate_content_stream(
                    model=model_version,
                    contents=contents,
                    config=config,
                )

                usage_metadata = None
                detected_tool_call = None

                async for chunk in response_stream:
                    if self.should_stop:
                        logger.info("Stream stopped by user request")
                        break

                    if chunk.usage_metadata:
                        usage_metadata = chunk.usage_metadata

                    if not chunk.candidates:
                        continue

                    for candidate in chunk.candidates:
                        if not candidate.content or not candidate.content.parts:
                            continue

                        for part in candidate.content.parts:
                            fn_call = getattr(part, 'function_call', None)
                            if fn_call and getattr(fn_call, 'name', None) == TOOL_NAME:
                                args = dict(fn_call.args) if fn_call.args else {}
                                detected_tool_call = args.get('prompt', '')
                            elif part.text:
                                await self._publish_stream_chunk(
                                    workspace_id, ai_chat_thread_id, part.text
                                )

                if detected_tool_call:
                    state['generated_image_prompt'] = detected_tool_call
                    state['reference_images'] = extract_reference_images(resolved_messages)
                    logger.info(
                        "[Google:%s] Tool call detected: generate_image promptLen=%d refImages=%d prompt=%s",
                        self.instance_key, len(detected_tool_call),
                        len(state['reference_images']),
                        detected_tool_call[:120],
                    )
                else:
                    logger.warning(
                        "Google did not emit generate_image tool call for %s during inject_tool path",
                        self.instance_key,
                    )

            else:
                # Pure text streaming path
                response_stream = await self.client.aio.models.generate_content_stream(
                    model=model_version,
                    contents=contents,
                    config=config,
                )

                usage_metadata = None

                async for chunk in response_stream:
                    if self.should_stop:
                        logger.info("Stream stopped by user request")
                        break

                    if chunk.usage_metadata:
                        usage_metadata = chunk.usage_metadata

                    if not chunk.candidates:
                        continue

                    for candidate in chunk.candidates:
                        if not candidate.content or not candidate.content.parts:
                            continue

                        for part in candidate.content.parts:
                            if part.text:
                                await self._publish_stream_chunk(
                                    workspace_id, ai_chat_thread_id, part.text
                                )

            # Extract usage data
            if usage_metadata:
                prompt_tokens = getattr(usage_metadata, 'prompt_token_count', 0) or 0
                completion_tokens = getattr(usage_metadata, 'candidates_token_count', 0) or 0
                state['usage'] = {
                    'promptTokens': prompt_tokens,
                    'promptAudioTokens': 0,
                    'promptCachedTokens': getattr(usage_metadata, 'cached_content_token_count', 0) or 0,
                    'completionTokens': completion_tokens,
                    'completionAudioTokens': 0,
                    'completionReasoningTokens': getattr(usage_metadata, 'thoughts_token_count', 0) or 0,
                    'totalTokens': getattr(usage_metadata, 'total_token_count', 0) or (prompt_tokens + completion_tokens)
                }
                state['ai_vendor_request_id'] = f"google-{workspace_id}-{ai_chat_thread_id}"
                logger.debug(f"Received usage data: {state['usage']}")

            # Track image usage
            if effective_image_gen:
                state['image_usage'] = {
                    'generatedCount': 1,
                    'size': image_size,
                    'quality': 'high'
                }

            if not effective_image_gen:
                await self._publish_stream_end(workspace_id, ai_chat_thread_id)
            logger.debug(f"Google streaming completed for {self.instance_key}")

        except Exception as e:
            logger.error(f"Google streaming failed: [{type(e).__name__}] {e}", exc_info=True)
            state['error'] = str(e)

        return state

    async def _rewrite_image_prompt_to_fit_limit(
        self,
        state: ProviderState,
        prompt: str,
        max_chars: int
    ) -> str | None:
        response = await self.client.aio.models.generate_content(
            model=state['model_version'],
            contents=[
                types.Content(
                    role='user',
                    parts=[types.Part.from_text(text=f"Original image prompt:\n{prompt}")]
                )
            ],
            config=types.GenerateContentConfig(
                temperature=0.2,
                max_output_tokens=max(256, ((max_chars + 3) // 4) + 128),
                system_instruction=build_image_prompt_rewrite_instruction(max_chars),
            ),
        )

        rewritten_prompt = (getattr(response, 'text', None) or '').strip()
        if rewritten_prompt:
            return rewritten_prompt

        text_parts = []
        for candidate in getattr(response, 'candidates', []) or []:
            if not candidate.content or not candidate.content.parts:
                continue

            for part in candidate.content.parts:
                if part.text:
                    text_parts.append(part.text.strip())

        rewritten_prompt = '\n'.join(part for part in text_parts if part).strip()
        return rewritten_prompt or None

    def _build_parts(self, content) -> List[types.Part]:
        if isinstance(content, str):
            return [types.Part.from_text(text=content)]

        if not isinstance(content, list):
            return [types.Part.from_text(text=str(content))]

        parts = []
        for block in content:
            if not isinstance(block, dict):
                continue

            if 'text' in block:
                parts.append(types.Part.from_text(text=block['text']))
            elif 'inline_data' in block:
                inline = block['inline_data']
                parts.append(types.Part.from_bytes(
                    data=base64.b64decode(inline['data']),
                    mime_type=inline['mime_type']
                ))

        return parts if parts else [types.Part.from_text(text='')]
