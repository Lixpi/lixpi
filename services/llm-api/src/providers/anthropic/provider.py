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
from tools.image_generation import (
    apply_image_prompt_limit_to_system_prompt,
    build_image_prompt_rewrite_instruction,
    extract_reference_images,
    extract_tool_call,
    get_tool_for_provider,
)

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
        temperature = state.get('temperature', 0.7)
        workspace_id = state['workspace_id']
        ai_chat_thread_id = state['ai_chat_thread_id']

        # Inject generate_image tool when an image model is selected
        has_image_model = bool(state.get('image_model_version'))
        max_tokens = state.get('max_completion_size', 4096)

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

            if isinstance(content, list):
                block_types = [b.get('type', '?') if isinstance(b, dict) else type(b).__name__ for b in content]
                logger.debug(
                    "[Anthropic:%s] msg[%d] role=%s multimodal blockTypes=%s",
                    self.instance_key, i, msg.get('role'), block_types,
                )

            formatted_messages.append({
                'role': msg.get('role', 'user'),
                'content': content
            })

        # Build tools array
        tools = []
        if has_image_model:
            tools.append(get_tool_for_provider(
                "Anthropic",
                state.get('image_model_meta_info'),
                state.get('image_provider_name')
            ))
            logger.debug("Injected generate_image function tool for image model routing")

        logger.debug(f"Streaming from Anthropic model: {model_version}")
        logger.debug(f"Messages count: {len(formatted_messages)}")

        try:
            # Publish stream start event
            await self._publish_stream_start(workspace_id, ai_chat_thread_id)

            # Build system prompt, appending image prompt char limit when applicable
            system_prompt = get_system_prompt(include_image_generation=has_image_model)
            if has_image_model:
                system_prompt = apply_image_prompt_limit_to_system_prompt(
                    system_prompt,
                    state.get('image_model_meta_info'),
                    state.get('image_provider_name')
                )

            # Build stream kwargs
            stream_kwargs = {
                'model': model_version,
                'messages': formatted_messages,
                'max_tokens': max_tokens,
                'system': system_prompt,
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
                        logger.info(
                            "[Anthropic:%s] Tool call detected: generate_image promptLen=%d refImages=%d prompt=%s",
                            self.instance_key, len(tool_call.prompt),
                            len(state['reference_images']),
                            tool_call.prompt[:120],
                        )

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
                    logger.debug(f"Received usage data: {state['usage']}")

                if has_image_model and not state.get('generated_image_prompt'):
                    block_types = [getattr(block, 'type', None) for block in (final_message.content or [])]
                    logger.warning(
                        "Anthropic did not emit generate_image tool call for %s. Final content block types: %s",
                        self.instance_key,
                        block_types,
                    )

            # Publish stream end
            await self._publish_stream_end(workspace_id, ai_chat_thread_id)
            logger.debug(f"Anthropic streaming completed for {self.instance_key}")

        except Exception as e:
            logger.error(f"Anthropic streaming failed: [{type(e).__name__}] {e}", exc_info=True)
            state['error'] = str(e)

        return state

    async def _rewrite_image_prompt_to_fit_limit(
        self,
        state: ProviderState,
        prompt: str,
        max_chars: int
    ) -> str | None:
        response = await self.client.messages.create(
            model=state['model_version'],
            messages=[{
                'role': 'user',
                'content': f"Original image prompt:\n{prompt}"
            }],
            max_tokens=max(256, ((max_chars + 3) // 4) + 128),
            temperature=0.2,
            system=build_image_prompt_rewrite_instruction(max_chars),
        )

        text_parts = []
        for block in response.content or []:
            if getattr(block, 'type', None) != 'text':
                continue

            text_value = getattr(block, 'text', None)
            if isinstance(text_value, str) and text_value.strip():
                text_parts.append(text_value.strip())

        rewritten_prompt = '\n'.join(text_parts).strip()
        return rewritten_prompt or None
