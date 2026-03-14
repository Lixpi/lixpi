"""
OpenAI provider implementation using LangGraph.
Handles streaming responses from OpenAI models including image generation.
"""

import base64
import logging
from io import BytesIO
from typing import Dict, Any, Optional, List

from openai import AsyncOpenAI

from providers.base import BaseLLMProvider, ProviderState
from prompts import get_system_prompt
from config import settings
from utils.attachments import convert_attachments_for_provider, AttachmentFormat, resolve_image_urls
from tools.image_generation import get_tool_for_provider, extract_tool_call, extract_reference_images

logger = logging.getLogger(__name__)


class OpenAIProvider(BaseLLMProvider):
    """OpenAI-specific LLM provider using LangGraph workflow."""

    def __init__(self, instance_key: str, nats_client, usage_reporter):
        """
        Initialize OpenAI provider.

        Args:
            instance_key: Unique identifier for this instance
            nats_client: NATS client for publishing responses
            usage_reporter: Usage reporter for tracking costs
        """
        super().__init__(instance_key, nats_client, usage_reporter)

        if not settings.OPENAI_API_KEY:
            raise ValueError("OPENAI_API_KEY environment variable is required")

        self.client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

    def get_provider_name(self) -> str:
        """Get the provider name."""
        return "OpenAI"

    async def _stream_impl(self, state: ProviderState) -> ProviderState:
        """
        Stream tokens from OpenAI Responses API.
        Supports both text generation and image generation.

        Args:
            state: Current workflow state

        Returns:
            Updated state with usage information
        """
        messages = state['messages']
        model_version = state['model_version']
        max_tokens = state.get('max_completion_size')
        temperature = state.get('temperature', 0.7)
        workspace_id = state['workspace_id']
        ai_chat_thread_id = state['ai_chat_thread_id']
        supports_system_prompt = state['ai_model_meta_info'].get('supportsSystemPrompt', True)

        enable_image_generation = state.get('enable_image_generation', False)
        image_size = state.get('image_size', 'auto')

        # Check if an image model is selected for dual-model routing
        has_image_model = bool(state.get('image_model_version'))

        # Prepare input array from messages with attachment conversion
        input_messages = []
        for msg in messages:
            content = msg.get('content', '')
            # First resolve any NATS object store references to base64
            content = await resolve_image_urls(content, self.nats_client)
            # Then convert attachments to OpenAI format (validates and normalizes)
            content = convert_attachments_for_provider(content, AttachmentFormat.OPENAI)
            input_messages.append({
                'role': msg.get('role', 'user'),
                'content': content
            })

        # Extract system prompt as instructions (if supported)
        instructions = get_system_prompt(include_image_generation=has_image_model) if supports_system_prompt else None

        # Build tools array for image generation
        tools = self._build_image_generation_tools(enable_image_generation, image_size)

        # Inject generate_image function tool when an image model is selected
        # (this is the text model path — the tool call will be routed to the image model)
        if has_image_model and not enable_image_generation:
            generate_image_tool = get_tool_for_provider("OpenAI")
            tools = tools or []
            tools.append(generate_image_tool)
            logger.info(f"Injected generate_image function tool for image model routing")

        logger.info(f"Streaming from OpenAI Responses API with model: {model_version}")
        logger.debug(f"Input messages count: {len(input_messages)}")
        if enable_image_generation:
            logger.info(f"Image generation enabled with size: {image_size}")

        try:
            # Skip START_STREAM when called as image model (via ImageRouter)
            # — the text model already manages the stream lifecycle
            if not enable_image_generation:
                await self._publish_stream_start(workspace_id, ai_chat_thread_id)

            # GPT Image models (gpt-image-1, gpt-image-1.5, gpt-image-1-mini)
            # must use the Image API, not the Responses API
            if enable_image_generation and model_version.startswith('gpt-image-'):
                await self._generate_via_image_api(state, input_messages, model_version, image_size, workspace_id, ai_chat_thread_id)
            else:
                await self._generate_via_responses_api(state, input_messages, model_version, instructions, temperature, max_tokens, tools, has_image_model, enable_image_generation, workspace_id, ai_chat_thread_id)

            # Publish stream end
            if not enable_image_generation:
                await self._publish_stream_end(workspace_id, ai_chat_thread_id)
            logger.info(f"✅ OpenAI streaming completed for {self.instance_key}")

        except Exception as e:
            logger.error(f"OpenAI streaming failed: {e}")
            if not state.get('error'):
                state['error'] = str(e)

        return state

    async def _generate_via_image_api(
        self,
        state: ProviderState,
        input_messages: list,
        model_version: str,
        image_size: str,
        workspace_id: str,
        ai_chat_thread_id: str
    ) -> None:
        # Extract prompt and reference images from the last user message
        prompt = ''
        reference_image_files = []

        for msg in reversed(input_messages):
            if msg.get('role') == 'user':
                content = msg.get('content', '')
                if isinstance(content, str):
                    prompt = content
                elif isinstance(content, list):
                    text_parts = []
                    for block in content:
                        if not isinstance(block, dict):
                            continue
                        block_type = block.get('type', '')
                        if block_type in ('text', 'input_text'):
                            text_parts.append(block.get('text', ''))
                        elif block_type in ('input_image', 'image_url'):
                            url = block.get('image_url', '')
                            if isinstance(url, dict):
                                url = url.get('url', '')
                            if url and url.startswith('data:'):
                                file_obj = self._data_url_to_file(url)
                                if file_obj:
                                    reference_image_files.append(file_obj)
                    prompt = ' '.join(text_parts)
                break

        if not prompt:
            raise ValueError("No user prompt found for image generation")

        has_references = len(reference_image_files) > 0
        api_method = "images.edit" if has_references else "images.generate"
        logger.info(f"Generating image via {api_method} with model: {model_version}, size: {image_size}, references: {len(reference_image_files)}")

        # Send placeholder for animated border
        await self._publish_image_partial(workspace_id, ai_chat_thread_id, "", 0)

        resolved_size = image_size if image_size else 'auto'

        # Use images.edit() when reference images are present, images.generate() otherwise
        if has_references:
            stream = await self.client.images.edit(
                model=model_version,
                image=reference_image_files if len(reference_image_files) > 1 else reference_image_files[0],
                prompt=prompt,
                quality='high',
                size=resolved_size,
                stream=True,
                partial_images=3,
            )
        else:
            stream = await self.client.images.generate(
                model=model_version,
                prompt=prompt,
                quality='high',
                size=resolved_size,
                stream=True,
                partial_images=3,
            )

        final_image = None
        async for event in stream:
            if self.should_stop:
                logger.info("Image generation stopped by user request")
                break

            if hasattr(event, 'type') and 'partial_image' in event.type:
                partial_b64 = event.b64_json
                partial_idx = getattr(event, 'partial_image_index', 0)
                if partial_b64:
                    logger.debug(f"Received partial image {partial_idx}")
                    await self._publish_image_partial(
                        workspace_id, ai_chat_thread_id, partial_b64, partial_idx
                    )
            elif hasattr(event, 'type') and 'completed' in event.type:
                final_image = event

        if final_image:
            image_b64 = final_image.b64_json
            revised_prompt = getattr(final_image, 'revised_prompt', '') or ''

            if image_b64:
                await self._publish_image_complete(
                    workspace_id, ai_chat_thread_id, image_b64, '', revised_prompt,
                    image_model_id=model_version
                )

                state['image_usage'] = {
                    'generatedCount': 1,
                    'size': image_size or 'auto',
                    'quality': 'high'
                }

            # Extract usage if available
            usage = getattr(final_image, 'usage', None)
            if usage:
                state['usage'] = {
                    'promptTokens': getattr(usage, 'input_tokens', 0) or 0,
                    'promptAudioTokens': 0,
                    'promptCachedTokens': 0,
                    'completionTokens': getattr(usage, 'output_tokens', 0) or 0,
                    'completionAudioTokens': 0,
                    'completionReasoningTokens': 0,
                    'totalTokens': (getattr(usage, 'input_tokens', 0) or 0) + (getattr(usage, 'output_tokens', 0) or 0)
                }
                state['ai_vendor_request_id'] = f"openai-image-{workspace_id}"

    @staticmethod
    def _data_url_to_file(data_url: str) -> Optional[BytesIO]:
        try:
            # Parse data:image/png;base64,xxxxx
            header, b64_data = data_url.split(',', 1)
            raw = base64.b64decode(b64_data)
            buf = BytesIO(raw)
            # Extract extension from mime type
            mime = header.split(':')[1].split(';')[0] if ':' in header else 'image/png'
            ext = mime.split('/')[-1]
            if ext == 'jpeg':
                ext = 'jpg'
            buf.name = f"reference.{ext}"
            return buf
        except Exception as e:
            logger.warning(f"Failed to convert data URL to file: {e}")
            return None

    async def _generate_via_responses_api(
        self,
        state: ProviderState,
        input_messages: list,
        model_version: str,
        instructions: str,
        temperature: float,
        max_tokens: int,
        tools: list,
        has_image_model: bool,
        enable_image_generation: bool,
        workspace_id: str,
        ai_chat_thread_id: str
    ) -> None:
        # Build request kwargs
        request_kwargs = {
            'model': model_version,
            'input': input_messages,
            'instructions': instructions,
            'temperature': temperature,
            'stream': True,
            'store': False
        }

        # Only include max_output_tokens when it has a valid value
        # (image-only models like gpt-image-1 don't have maxCompletionSize)
        if max_tokens and max_tokens > 0:
            request_kwargs['max_output_tokens'] = max_tokens

        # Add tools if image generation is enabled
        if tools:
            request_kwargs['tools'] = tools

        # Create streaming response using Responses API
        stream = await self.client.responses.create(**request_kwargs)

        # Stream events from Responses API
        async for event in stream:
            # Check if we should stop
            if self.should_stop:
                logger.info("Stream stopped by user request")
                break

            match event.type:
                # Handle text delta events (streaming content)
                case 'response.output_text.delta':
                    delta_text = event.delta
                    if delta_text:
                        await self._publish_stream_chunk(workspace_id, ai_chat_thread_id, delta_text)

                # Handle output item added (to detect image generation start)
                case 'response.output_item.added':
                    item = getattr(event, 'item', None)
                    if item and getattr(item, 'type', None) == 'image_generation_call':
                        logger.debug("Image generation call started")
                        await self._publish_image_partial(
                            workspace_id,
                            ai_chat_thread_id,
                            "", # Empty image to trigger UI placeholder
                            0
                        )

                # Handle partial image events during generation
                case 'response.image_generation_call.partial_image':
                    partial_image = getattr(event, 'partial_image_b64', None)
                    partial_index = getattr(event, 'partial_image_index', 0)
                    if partial_image:
                        logger.debug(f"Received partial image {partial_index}")
                        await self._publish_image_partial(
                            workspace_id,
                            ai_chat_thread_id,
                            partial_image,
                            partial_index
                        )

                # Handle completion event (includes usage data)
                case 'response.completed':
                    response = event.response
                    state['response_id'] = response.id
                    state['ai_vendor_request_id'] = response.id

                    # Check for generate_image function tool call (text→image routing)
                    if has_image_model:
                        tool_call = extract_tool_call("OpenAI", response)
                        if tool_call:
                            state['generated_image_prompt'] = tool_call.prompt
                            state['reference_images'] = extract_reference_images(input_messages)
                            logger.info(f"Tool call detected: generate_image, prompt: {tool_call.prompt[:100]}...")

                    # Check for completed image generation in output (native DALL-E path)
                    await self._handle_image_generation_output(
                        response,
                        workspace_id,
                        ai_chat_thread_id,
                        state
                    )

                    # Extract usage data
                    if hasattr(response, 'usage') and response.usage:
                        usage = response.usage
                        state['usage'] = {
                            'promptTokens': usage.input_tokens,
                            'promptAudioTokens': getattr(usage, 'input_tokens_audio', 0) if hasattr(usage, 'input_tokens_audio') else 0,
                            'promptCachedTokens': getattr(usage, 'input_tokens_cached', 0) if hasattr(usage, 'input_tokens_cached') else 0,
                            'completionTokens': usage.output_tokens,
                            'completionAudioTokens': getattr(usage, 'output_tokens_audio', 0) if hasattr(usage, 'output_tokens_audio') else 0,
                            'completionReasoningTokens': getattr(usage, 'output_tokens_reasoning', 0) if hasattr(usage, 'output_tokens_reasoning') else 0,
                            'totalTokens': usage.input_tokens + usage.output_tokens
                        }
                        logger.info(f"Received usage data: {state['usage']}")

                # Handle failure event (structured errors)
                case 'response.failed':
                    response = event.response
                    error_obj = response.error if hasattr(response, 'error') else None

                    if error_obj:
                        error_message = getattr(error_obj, 'message', 'Unknown error')
                        error_code = getattr(error_obj, 'code', None)
                        error_type = getattr(error_obj, 'type', None)

                        state['error'] = error_message
                        state['error_code'] = error_code
                        state['error_type'] = error_type
                        state['response_id'] = response.id

                        logger.error(f"Response failed: {error_message} (code: {error_code}, type: {error_type})")

                        # Publish structured error
                        await self._publish_error(
                            workspace_id,
                            ai_chat_thread_id,
                            error_message,
                            error_code=error_code,
                            error_type=error_type
                        )
                        raise RuntimeError(f"OpenAI Responses API error: {error_message}")

    def _build_image_generation_tools(
        self,
        enable_image_generation: bool,
        image_size: str
    ) -> Optional[List[Dict[str, Any]]]:
        """
        Build the tools array for image generation.

        Args:
            enable_image_generation: Whether image generation is enabled
            image_size: Desired image size (1024x1024, 1536x1024, 1024x1536, auto)

        Returns:
            Tools array or None if image generation is disabled
        """
        if not enable_image_generation:
            return None

        return [{
            'type': 'image_generation',
            'quality': 'high',
            # 'quality': 'low',
            'moderation': 'low',
            'input_fidelity': 'high',
            'partial_images': 3,
            'size': image_size if image_size else 'auto'
            # 'size': '1024x1024'
        }]

    async def _handle_image_generation_output(
        self,
        response: Any,
        workspace_id: str,
        ai_chat_thread_id: str,
        state: ProviderState
    ) -> None:
        """
        Handle completed image generation in the response output.

        Args:
            response: The completed response object
            workspace_id: Workspace identifier
            ai_chat_thread_id: AI chat thread identifier
            state: Current workflow state
        """
        if not hasattr(response, 'output') or not response.output:
            return

        images_generated = 0

        for output_item in response.output:
            # Check if this is an image generation result
            if getattr(output_item, 'type', None) == 'image_generation_call':
                result = getattr(output_item, 'result', None)
                revised_prompt = getattr(output_item, 'revised_prompt', '')

                if result:
                    images_generated += 1
                    logger.info(f"Image generation completed, revised prompt: {revised_prompt[:100]}...")

                    await self._publish_image_complete(
                        workspace_id,
                        ai_chat_thread_id,
                        result,
                        response.id,
                        revised_prompt,
                        image_model_id=model_version
                    )

        if images_generated > 0:
            state['image_usage'] = {
                'generatedCount': images_generated,
                'size': state.get('image_size', 'auto'),
                'quality': 'high'  # We always use high quality
            }
