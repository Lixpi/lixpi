"""
OpenAI provider implementation using LangGraph.
Handles streaming responses from OpenAI models.
"""

import logging
from typing import Dict, Any

from openai import AsyncOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

from providers.base import BaseLLMProvider, ProviderState
from prompts import get_system_prompt
from config import settings

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
        Stream tokens from OpenAI API.

        Args:
            state: Current workflow state

        Returns:
            Updated state with usage information
        """
        messages = state['messages']
        model_version = state['model_version']
        max_tokens = state.get('max_completion_size')
        temperature = state.get('temperature', 0.7)
        document_id = state['document_id']
        thread_id = state.get('thread_id')
        supports_system_prompt = state['ai_model_meta_info'].get('supportsSystemPrompt', True)

        # Prepare messages with system prompt
        formatted_messages = []
        if supports_system_prompt:
            formatted_messages.append({
                'role': 'system',
                'content': get_system_prompt()
            })

        # Add conversation messages
        for msg in messages:
            formatted_messages.append({
                'role': msg.get('role', 'user'),
                'content': msg.get('content', '')
            })

        logger.info(f"Streaming from OpenAI model: {model_version}")
        logger.debug(f"Messages count: {len(formatted_messages)}")

        try:
            # Publish stream start event
            await self._publish_stream_start(document_id, thread_id)

            # Create streaming completion
            stream = await self.client.chat.completions.create(
                model=model_version,
                messages=formatted_messages,
                temperature=temperature,
                max_completion_tokens=max_tokens,
                stream=True,
                store=False,
                stream_options={'include_usage': True}
            )

            # Stream tokens to client
            async for chunk in stream:
                # Check if we should stop
                if self.should_stop:
                    logger.info("Stream stopped by user request")
                    break

                # Extract data from chunk
                chunk_id = chunk.id
                choices = chunk.choices
                usage = chunk.usage

                # Update usage info when available (last chunk)
                if usage:
                    state['usage'] = {
                        'promptTokens': usage.prompt_tokens,
                        'promptAudioTokens': getattr(usage.prompt_tokens_details, 'audio_tokens', 0) if hasattr(usage, 'prompt_tokens_details') else 0,
                        'promptCachedTokens': getattr(usage.prompt_tokens_details, 'cached_tokens', 0) if hasattr(usage, 'prompt_tokens_details') else 0,
                        'completionTokens': usage.completion_tokens,
                        'completionAudioTokens': getattr(usage.completion_tokens_details, 'audio_tokens', 0) if hasattr(usage, 'completion_tokens_details') else 0,
                        'completionReasoningTokens': getattr(usage.completion_tokens_details, 'reasoning_tokens', 0) if hasattr(usage, 'completion_tokens_details') else 0,
                        'totalTokens': usage.total_tokens
                    }
                    state['ai_vendor_request_id'] = chunk_id
                    logger.info(f"Received usage data: {state['usage']}")

                # Stream content if available
                if choices and len(choices) > 0:
                    delta = choices[0].delta
                    content = delta.content

                    if content:
                        await self._publish_stream_chunk(document_id, content, thread_id)

            # Publish stream end
            await self._publish_stream_end(document_id, thread_id)
            logger.info(f"✅ OpenAI streaming completed for {self.instance_key}")

        except Exception as e:
            logger.error(f"Error streaming from OpenAI: {e}", exc_info=True)
            state['error'] = str(e)
            raise

        return state
