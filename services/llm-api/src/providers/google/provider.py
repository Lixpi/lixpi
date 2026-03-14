import base64
import logging
from typing import List

from google import genai
from google.genai import types

from providers.base import BaseLLMProvider, ProviderState
from prompts import get_system_prompt
from config import settings
from utils.attachments import convert_attachments_for_provider, AttachmentFormat, resolve_image_urls
from tools.image_generation import get_tool_for_provider, extract_tool_call, extract_reference_images, TOOL_NAME, TOOL_DESCRIPTION, TOOL_PARAMETERS

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
        for msg in messages:
            content = msg.get('content', '')
            content = await resolve_image_urls(content, self.nats_client)

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
            gen_config_kwargs['tools'] = [types.Tool(
                function_declarations=[
                    types.FunctionDeclaration(
                        name=TOOL_NAME,
                        description=TOOL_DESCRIPTION,
                        parameters=TOOL_PARAMETERS,
                    )
                ]
            )]
            logger.info("Injected generate_image function tool for image model routing")

        # System instruction
        system_instruction = get_system_prompt(include_image_generation=inject_tool) if supports_system_prompt else None
        if system_instruction:
            gen_config_kwargs['system_instruction'] = system_instruction

        # Thinking config for Gemini 3+ image models
        if effective_image_gen and not model_version.startswith('gemini-2.5'):
            gen_config_kwargs['thinking_config'] = types.ThinkingConfig(include_thoughts=True)

        logger.info(f"Streaming from Google model: {model_version}")
        if effective_image_gen:
            logger.info(f"Image generation enabled with aspect ratio: {image_size}")
        elif inject_tool:
            logger.info(f"Text model with image model routing enabled")

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

                response = await self.client.aio.models.generate_content(
                    model=model_version,
                    contents=contents,
                    config=config,
                )

                usage_metadata = response.usage_metadata

                if response.candidates:
                    for candidate in response.candidates:
                        if not candidate.content or not candidate.content.parts:
                            continue

                        for part in candidate.content.parts:
                            if self.should_stop:
                                break

                            if getattr(part, 'thought', False) and part.inline_data:
                                image_b64 = base64.b64encode(part.inline_data.data).decode('utf-8')
                                await self._publish_image_partial(
                                    workspace_id, ai_chat_thread_id, image_b64, 0
                                )
                            elif part.text and not getattr(part, 'thought', False):
                                await self._publish_stream_chunk(
                                    workspace_id, ai_chat_thread_id, part.text
                                )
                            elif part.inline_data and not getattr(part, 'thought', False):
                                image_b64 = base64.b64encode(part.inline_data.data).decode('utf-8')
                                await self._publish_image_complete(
                                    workspace_id, ai_chat_thread_id, image_b64, '', '',
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
                    logger.info(f"Tool call detected: generate_image, prompt: {detected_tool_call[:100]}...")

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
                logger.info(f"Received usage data: {state['usage']}")

            # Track image usage
            if effective_image_gen:
                state['image_usage'] = {
                    'generatedCount': 1,
                    'size': image_size,
                    'quality': 'high'
                }

            if not effective_image_gen:
                await self._publish_stream_end(workspace_id, ai_chat_thread_id)
            logger.info(f"✅ Google streaming completed for {self.instance_key}")

        except Exception as e:
            logger.error(f"Google streaming failed: {e}")
            state['error'] = str(e)

        return state

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
