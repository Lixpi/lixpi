"""
Anthropic provider implementation using LangGraph.
Handles streaming responses from Anthropic Claude models.
"""

import logging
from typing import Dict, Any

from anthropic import AsyncAnthropic

from providers.base import BaseLLMProvider, ProviderState
from prompts import get_system_prompt, format_user_message_with_hack
from config import settings
from utils.attachments import convert_attachments_for_provider, AttachmentFormat, resolve_image_urls
from tools.image_generation import get_tool_for_provider, extract_tool_call, extract_reference_images

logger = logging.getLogger(__name__)


class AnthropicProvider(BaseLLMProvider):
    """Anthropic-specific LLM provider using LangGraph workflow."""

    def __init__(self, instance_key: str, nats_client, usage_reporter):
        """
        Initialize Anthropic provider.

        Args:
            instance_key: Unique identifier for this instance
            nats_client: NATS client for publishing responses
            usage_reporter: Usage reporter for tracking costs
        """
        super().__init__(instance_key, nats_client, usage_reporter)

        if not settings.ANTHROPIC_API_KEY:
            raise ValueError("ANTHROPIC_API_KEY environment variable is required")

        self.client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

    def get_provider_name(self) -> str:
        """Get the provider name."""
        return "Anthropic"

    async def _stream_impl(self, state: ProviderState) -> ProviderState:
        """
        Stream tokens from Anthropic API.

        Args:
            state: Current workflow state

        Returns:
            Updated state with usage information
        """
        messages = state['messages']
        model_version = state['model_version']
        max_tokens = state.get('max_completion_size', 4096)
        temperature = state.get('temperature', 0.7)
        workspace_id = state['workspace_id']
        ai_chat_thread_id = state['ai_chat_thread_id']

        # Inject generate_image tool when an image model is selected
        has_image_model = bool(state.get('image_model_version'))

        # Convert messages to Anthropic format (handles multimodal content)
        formatted_messages = []
        for i, msg in enumerate(messages):
            content = msg.get('content', '')

            # First resolve any NATS object store references to base64
            content = await resolve_image_urls(content, self.nats_client)
            # Then convert OpenAI-style content blocks to Anthropic format
            content = convert_attachments_for_provider(content, AttachmentFormat.ANTHROPIC)

            # Apply hack to the last user message (only for string content)
            if i == len(messages) - 1 and msg.get('role') == 'user' and isinstance(content, str):
                content = format_user_message_with_hack(content, 'Anthropic')

            formatted_messages.append({
                'role': msg.get('role', 'user'),
                'content': content
            })

        # Build tools array
        tools = []
        if has_image_model:
            tools.append(get_tool_for_provider("Anthropic"))
            logger.info("Injected generate_image function tool for image model routing")

        logger.info(f"Streaming from Anthropic model: {model_version}")
        logger.debug(f"Messages count: {len(formatted_messages)}")

        try:
            # Publish stream start event
            await self._publish_stream_start(workspace_id, ai_chat_thread_id)

            # Build stream kwargs
            stream_kwargs = {
                'model': model_version,
                'messages': formatted_messages,
                'max_tokens': max_tokens,
                'system': get_system_prompt(include_image_generation=has_image_model),
            }
            if tools:
                stream_kwargs['tools'] = tools

            # Create streaming completion
            async with self.client.messages.stream(**stream_kwargs) as stream:

                # Stream tokens to client
                async for text in stream.text_stream:
                    # Check if we should stop
                    if self.should_stop:
                        logger.info("Stream stopped by user request")
                        break

                    # Publish content chunk
                    await self._publish_stream_chunk(workspace_id, ai_chat_thread_id, text)

                # Get final message with usage data
                final_message = await stream.get_final_message()

                # Check for generate_image tool call
                if has_image_model:
                    tool_call = extract_tool_call("Anthropic", final_message)
                    if tool_call:
                        state['generated_image_prompt'] = tool_call.prompt
                        state['reference_images'] = extract_reference_images(formatted_messages)
                        logger.info(f"Tool call detected: generate_image, prompt: {tool_call.prompt[:100]}...")

                # Extract usage information
                if final_message.usage:
                    usage = final_message.usage
                    state['usage'] = {
                        'promptTokens': usage.input_tokens,
                        'promptAudioTokens': 0,
                        'promptCachedTokens': 0,
                        'completionTokens': usage.output_tokens,
                        'completionAudioTokens': 0,
                        'completionReasoningTokens': 0,
                        'totalTokens': usage.input_tokens + usage.output_tokens
                    }
                    state['ai_vendor_request_id'] = final_message.id
                    logger.info(f"Received usage data: {state['usage']}")

            # Publish stream end
            await self._publish_stream_end(workspace_id, ai_chat_thread_id)
            logger.info(f"✅ Anthropic streaming completed for {self.instance_key}")

        except Exception as e:
            logger.error(f"Anthropic streaming failed: {e}")
            state['error'] = str(e)

        return state
