"""
Anthropic provider implementation using LangGraph.
Handles streaming responses from Anthropic Claude models.
"""

import logging
from typing import Dict, Any

from anthropic import AsyncAnthropic
from langchain_core.messages import HumanMessage, SystemMessage

from providers.base import BaseLLMProvider, ProviderState
from prompts import get_system_prompt, format_user_message_with_hack
from config import settings

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
        document_id = state['document_id']
        thread_id = state.get('thread_id')

        # Apply Anthropic-specific code block formatting hack to last user message
        formatted_messages = []
        for i, msg in enumerate(messages):
            content = msg.get('content', '')

            # Apply hack to the last user message
            if i == len(messages) - 1 and msg.get('role') == 'user':
                content = format_user_message_with_hack(content, 'Anthropic')

            formatted_messages.append({
                'role': msg.get('role', 'user'),
                'content': content
            })

        logger.info(f"Streaming from Anthropic model: {model_version}")
        logger.debug(f"Messages: {[{'role': m['role'], 'length': len(m['content'])} for m in formatted_messages]}")

        try:
            # Publish stream start event
            await self._publish_stream_start(document_id, thread_id)

            # Create streaming completion
            async with self.client.messages.stream(
                model=model_version,
                messages=formatted_messages,
                max_tokens=max_tokens,
                system=get_system_prompt(),
            ) as stream:

                # Stream tokens to client
                async for text in stream.text_stream:
                    # Check if we should stop
                    if self.should_stop:
                        logger.info("Stream stopped by user request")
                        break

                    # Publish content chunk
                    await self._publish_stream_chunk(document_id, text, thread_id)

                # Get final message with usage data
                final_message = await stream.get_final_message()

                # Extract usage information
                if final_message.usage:
                    usage = final_message.usage
                    state['usage'] = {
                        'promptTokens': usage.input_tokens,
                        'promptAudioTokens': 0,  # Not supported by Anthropic yet
                        'promptCachedTokens': 0,  # Not using cache currently
                        'completionTokens': usage.output_tokens,
                        'completionAudioTokens': 0,  # Not supported by Anthropic yet
                        'completionReasoningTokens': 0,  # Not supported by Anthropic yet
                        'totalTokens': usage.input_tokens + usage.output_tokens
                    }
                    state['ai_vendor_request_id'] = final_message.id
                    logger.info(f"Received usage data: {state['usage']}")

            # Publish stream end
            await self._publish_stream_end(document_id, thread_id)
            logger.info(f"✅ Anthropic streaming completed for {self.instance_key}")

        except Exception as e:
            logger.error(f"Error streaming from Anthropic: {e}", exc_info=True)
            state['error'] = str(e)
            raise

        return state
