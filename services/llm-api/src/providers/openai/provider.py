"""
OpenAI provider implementation using LangGraph.
Handles streaming responses from OpenAI models including image generation.
"""

import logging
from typing import Dict, Any, Optional, List

from openai import AsyncOpenAI

from providers.base import BaseLLMProvider, ProviderState
from prompts import get_system_prompt
from config import settings
from utils.attachments import convert_attachments_for_provider, AttachmentFormat, resolve_image_urls

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
        instructions = get_system_prompt() if supports_system_prompt else None

        # Build tools array for image generation
        tools = self._build_image_generation_tools(enable_image_generation, image_size)

        logger.info(f"Streaming from OpenAI Responses API with model: {model_version}")
        logger.debug(f"Input messages count: {len(input_messages)}")
        if enable_image_generation:
            logger.info(f"Image generation enabled with size: {image_size}")

        try:
            # Publish stream start event
            await self._publish_stream_start(workspace_id, ai_chat_thread_id)

            # Build request kwargs
            request_kwargs = {
                'model': model_version,
                'input': input_messages,
                'instructions': instructions,
                'temperature': temperature,
                'max_output_tokens': max_tokens,
                'stream': True,
                'store': False
            }

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

                        # Check for completed image generation in output
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

            # Publish stream end
            await self._publish_stream_end(workspace_id, ai_chat_thread_id)
            logger.info(f"✅ OpenAI Responses API streaming completed for {self.instance_key}")

        except Exception as e:
            logger.error(f"Error streaming from OpenAI Responses API: {e}", exc_info=True)
            if not state.get('error'):
                state['error'] = str(e)
            raise

        return state

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
            # 'quality': 'high',
            'quality': 'low',
            'moderation': 'low',
            'input_fidelity': 'high',
            'partial_images': 3,
            # 'size': image_size if image_size else 'auto'
            'size': '1024x1024'
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
                        revised_prompt
                    )

        if images_generated > 0:
            state['image_usage'] = {
                'generatedCount': images_generated,
                'size': state.get('image_size', 'auto'),
                'quality': 'high'  # We always use high quality
            }
