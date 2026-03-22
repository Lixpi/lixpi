"""
Base provider abstraction using LangGraph for LLM interactions.
Defines the common workflow: validate → stream → validate_image_prompt → image/calculate_usage → cleanup
"""

import asyncio
import base64
import logging
import time
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Dict, Any, Optional, AsyncIterator, TypedDict
from enum import Enum
from io import BytesIO

import httpx
from langgraph.graph import StateGraph, END
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage

from config import settings
from prompts import get_system_prompt
from services.usage_reporter import UsageReporter
from lixpi_constants import AI_INTERACTION_CONSTANTS

logger = logging.getLogger(__name__)


_STREAM_STATUS = AI_INTERACTION_CONSTANTS.get("STREAM_STATUS", {})

class StreamStatus(str, Enum):
    """Status of streaming response."""
    START_STREAM = _STREAM_STATUS.get("START_STREAM", "START_STREAM")
    STREAMING = _STREAM_STATUS.get("STREAMING", "STREAMING")
    END_STREAM = _STREAM_STATUS.get("END_STREAM", "END_STREAM")
    ERROR = _STREAM_STATUS.get("ERROR", "ERROR")
    IMAGE_PARTIAL = _STREAM_STATUS.get("IMAGE_PARTIAL", "IMAGE_PARTIAL")
    IMAGE_COMPLETE = _STREAM_STATUS.get("IMAGE_COMPLETE", "IMAGE_COMPLETE")
    COLLAPSIBLE_START = _STREAM_STATUS.get("COLLAPSIBLE_START", "COLLAPSIBLE_START")
    COLLAPSIBLE_END = _STREAM_STATUS.get("COLLAPSIBLE_END", "COLLAPSIBLE_END")


class ProviderState(TypedDict, total=False):
    """
    State for LangGraph provider workflow.

    Fields:
        - messages: List of conversation messages
        - ai_model_meta_info: AI model configuration and pricing
        - event_meta: Event metadata (userId, organizationId, etc.)
        - workspace_id: Workspace identifier
        - ai_chat_thread_id: AI chat thread identifier
        - instance_key: Unique key for this provider instance
        - provider: Provider name ('OpenAI' or 'Anthropic')
        - model_version: Specific model version to use
        - max_completion_size: Maximum tokens in completion
        - temperature: Model temperature
        - stream_active: Whether streaming is currently active
        - error: Error message if any
        - error_code: Error code from provider
        - error_type: Error type from provider
        - usage: Token usage statistics
        - response_id: Response ID from provider (OpenAI Responses API)
        - ai_vendor_request_id: Request ID from AI provider
        - ai_request_received_at: Request start timestamp
        - ai_request_finished_at: Request end timestamp
        - enable_image_generation: Whether image generation is enabled
        - image_size: Size for image generation
        - previous_response_id: Previous response ID for multi-turn editing
        - image_usage: Image generation usage statistics
        - image_model_meta_info: Metadata for the selected image model
        - image_model_version: Image model ID
        - image_provider_name: Image model provider name
        - generated_image_prompt: Prompt extracted from text model's tool call
        - reference_images: Reference images extracted from tool call
        - image_prompt_retry_count: Number of prompt rewrite retries attempted
    """
    messages: list
    ai_model_meta_info: Dict[str, Any]
    event_meta: Dict[str, Any]
    workspace_id: str
    ai_chat_thread_id: str
    instance_key: str
    provider: str
    model_version: str
    max_completion_size: Optional[int]
    temperature: float
    stream_active: bool
    error: Optional[str]
    error_code: Optional[str]
    error_type: Optional[str]
    usage: Dict[str, Any]
    response_id: Optional[str]
    ai_vendor_request_id: Optional[str]
    ai_request_received_at: int
    ai_request_finished_at: Optional[int]
    enable_image_generation: Optional[bool]
    image_size: Optional[str]
    image_usage: Optional[Dict[str, Any]]
    image_model_meta_info: Optional[Dict[str, Any]]
    image_model_version: Optional[str]
    image_provider_name: Optional[str]
    generated_image_prompt: Optional[str]
    reference_images: Optional[list]
    image_prompt_retry_count: Optional[int]


class BaseLLMProvider(ABC):
    """
    Base class for LLM providers using LangGraph workflows.
    """

    # XML tags used to delimit collapsible content in the stream
    _COLLAPSIBLE_OPEN_TAG = '<image_prompt>'
    _COLLAPSIBLE_CLOSE_TAG = '</image_prompt>'
    # Buffer size large enough to hold a partial tag
    _TAG_BUFFER_SIZE = len('</image_prompt>')
    _GRAPH_STATE_KEYS = (
        'provider',
        'model_version',
        'image_provider_name',
        'image_model_version',
        'enable_image_generation',
        'image_size',
        'stream_active',
        'error',
        'error_code',
        'error_type',
        'response_id',
        'ai_vendor_request_id',
        'image_prompt_retry_count',
    )

    def __init__(
        self,
        instance_key: str,
        nats_client,
        usage_reporter: UsageReporter
    ):
        self.instance_key = instance_key
        self.nats_client = nats_client
        self.usage_reporter = usage_reporter
        self.stream_task: Optional[asyncio.Task] = None
        self.should_stop = False

        # Tag-aware stream processor state (reset per stream)
        self._tag_buffer = ''
        self._inside_collapsible = False

        # Build LangGraph workflow
        self.workflow = self._build_workflow()
        self.app = self.workflow.compile()

    def _build_workflow(self) -> StateGraph:
        """
        Build the LangGraph state machine workflow.

        Workflow:
            validate_request → stream_tokens → [conditional]
                → if generated_image_prompt: validate_image_prompt → execute_image_generation → calculate_usage → cleanup → END
                → else: calculate_usage → cleanup → END
        """
        workflow = StateGraph(ProviderState)

        # Add nodes
        workflow.add_node("validate_request", self._wrap_graph_node("validate_request", self._validate_request))
        workflow.add_node("stream_tokens", self._wrap_graph_node("stream_tokens", self._stream_tokens))
        workflow.add_node("validate_image_prompt", self._wrap_graph_node("validate_image_prompt", self._validate_image_prompt))
        workflow.add_node("execute_image_generation", self._wrap_graph_node("execute_image_generation", self._execute_image_generation))
        workflow.add_node("calculate_usage", self._wrap_graph_node("calculate_usage", self._calculate_usage))
        workflow.add_node("cleanup", self._wrap_graph_node("cleanup", self._cleanup))

        # Add edges
        workflow.set_entry_point("validate_request")
        workflow.add_edge("validate_request", "stream_tokens")

        # Conditional edge: route to image generation if text model made a tool call
        workflow.add_conditional_edges(
            "stream_tokens",
            self._should_generate_image,
            {
                "generate_image": "validate_image_prompt",
                "skip": "calculate_usage"
            }
        )

        workflow.add_conditional_edges(
            "validate_image_prompt",
            self._should_generate_image,
            {
                "generate_image": "execute_image_generation",
                "skip": "calculate_usage"
            }
        )

        workflow.add_edge("execute_image_generation", "calculate_usage")
        workflow.add_edge("calculate_usage", "cleanup")
        workflow.add_edge("cleanup", END)

        return workflow

    def _summarize_graph_state(self, state: Optional[ProviderState]) -> Dict[str, Any]:
        if not state:
            return {}

        summary: Dict[str, Any] = {key: state.get(key) for key in self._GRAPH_STATE_KEYS}
        messages = state.get('messages') or []
        generated_image_prompt = state.get('generated_image_prompt') or ''
        reference_images = state.get('reference_images') or []
        usage = state.get('usage') or {}
        image_usage = state.get('image_usage') or {}

        summary.update({
            'messages_count': len(messages),
            'last_message_role': messages[-1].get('role') if messages and isinstance(messages[-1], dict) else None,
            'has_generated_image_prompt': bool(generated_image_prompt),
            'generated_image_prompt_length': len(generated_image_prompt),
            'reference_images_count': len(reference_images),
            'usage_total_tokens': usage.get('totalTokens'),
            'usage_completion_tokens': usage.get('completionTokens'),
            'image_usage_generated_count': image_usage.get('generatedCount'),
            'image_usage_size': image_usage.get('size'),
        })
        return summary

    @staticmethod
    def _diff_graph_state(before: Dict[str, Any], after: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
        diff: Dict[str, Dict[str, Any]] = {}
        for key in sorted(set(before) | set(after)):
            before_value = before.get(key)
            after_value = after.get(key)
            if before_value != after_value:
                diff[key] = {
                    'before': before_value,
                    'after': after_value,
                }
        return diff

    def _wrap_graph_node(self, node_name: str, handler):
        async def wrapped(state: ProviderState) -> ProviderState:
            before_summary = self._summarize_graph_state(state)
            started_at = time.perf_counter()
            logger.debug(
                "[LangGraph:%s] Enter node=%s state=%s",
                self.instance_key, node_name, before_summary,
            )

            try:
                result = await handler(state)
            except Exception:
                elapsed_ms = round((time.perf_counter() - started_at) * 1000, 2)
                logger.exception(
                    "[LangGraph:%s] Node failed node=%s durationMs=%s",
                    self.instance_key, node_name, elapsed_ms,
                )
                raise

            after_summary = self._summarize_graph_state(result)
            elapsed_ms = round((time.perf_counter() - started_at) * 1000, 2)
            diff = self._diff_graph_state(before_summary, after_summary)
            if diff:
                logger.info(
                    "[LangGraph:%s] node=%s durationMs=%s diff=%s",
                    self.instance_key, node_name, elapsed_ms, diff,
                )
            else:
                logger.debug(
                    "[LangGraph:%s] node=%s durationMs=%s (no state changes)",
                    self.instance_key, node_name, elapsed_ms,
                )
            return result

        return wrapped

    def _should_generate_image(self, state: ProviderState) -> str:
        generated_image_prompt = state.get('generated_image_prompt') or ''
        route = "generate_image" if generated_image_prompt else "skip"
        logger.debug(
            "[LangGraph:%s] Route route=%s promptLen=%d imageProvider=%s error=%s",
            self.instance_key, route, len(generated_image_prompt),
            state.get('image_provider_name'), state.get('error'),
        )
        return route

    async def _execute_image_generation(self, state: ProviderState) -> ProviderState:
        from tools.image_router import ImageRouter

        router = ImageRouter()
        return await router.execute(state, self.nats_client, self.usage_reporter)

    async def _validate_image_prompt(self, state: ProviderState) -> ProviderState:
        from tools.image_generation import get_image_prompt_max_chars, validate_image_prompt

        prompt = state.get('generated_image_prompt')
        if not prompt:
            return state

        image_model_meta_info = state.get('image_model_meta_info')
        image_provider_name = state.get('image_provider_name')
        max_chars = get_image_prompt_max_chars(image_model_meta_info, image_provider_name)
        if not max_chars:
            return state

        validation_error = validate_image_prompt(prompt, image_model_meta_info, image_provider_name)
        if not validation_error:
            return state

        retry_count = state.get('image_prompt_retry_count', 0) or 0
        logger.warning(
            "Image prompt exceeded selected image model limit for %s: %s",
            self.instance_key,
            validation_error
        )

        if retry_count < 1:
            try:
                rewritten_prompt = await self._rewrite_image_prompt_to_fit_limit(state, prompt, max_chars)
            except Exception as e:
                logger.error(f"Image prompt rewrite failed for {self.instance_key}: {e}", exc_info=True)
                rewritten_prompt = None

            state['image_prompt_retry_count'] = retry_count + 1

            if rewritten_prompt:
                rewritten_prompt = rewritten_prompt.strip()
                state['generated_image_prompt'] = rewritten_prompt

                validation_error = validate_image_prompt(
                    rewritten_prompt,
                    image_model_meta_info,
                    image_provider_name
                )
                if not validation_error:
                    logger.info(
                        "Image prompt rewritten under limit for %s after %s retry",
                        self.instance_key,
                        state['image_prompt_retry_count']
                    )
                    return state

        state['generated_image_prompt'] = None
        state['error'] = validation_error
        await self._publish_error(
            state['workspace_id'],
            state['ai_chat_thread_id'],
            validation_error
        )
        return state

    async def process(self, request_data: Dict[str, Any]) -> None:
        """
        Process an LLM request through the LangGraph workflow.

        Args:
            request_data: Request payload from services/api
        """
        try:
            # Initialize state
            state: ProviderState = {
                'messages': request_data.get('messages', []),
                'ai_model_meta_info': request_data.get('aiModelMetaInfo', {}),
                'event_meta': request_data.get('eventMeta', {}),
                'workspace_id': request_data.get('workspaceId'),
                'ai_chat_thread_id': request_data.get('aiChatThreadId'),
                'instance_key': self.instance_key,
                'provider': self.get_provider_name(),
                'model_version': request_data.get('aiModelMetaInfo', {}).get('modelVersion'),
                'max_completion_size': request_data.get('aiModelMetaInfo', {}).get('maxCompletionSize'),
                'temperature': request_data.get('aiModelMetaInfo', {}).get('defaultTemperature'),
                'stream_active': False,
                'error': None,
                'error_code': None,
                'error_type': None,
                'usage': {},
                'response_id': None,
                'ai_vendor_request_id': None,
                'ai_request_received_at': int(datetime.now().timestamp() * 1000),
                'ai_request_finished_at': None,
                'enable_image_generation': request_data.get('enableImageGeneration', False),
                'image_size': request_data.get('imageSize', 'auto'),
                'image_usage': None,
                'image_model_meta_info': request_data.get('imageModelMetaInfo'),
                'image_model_version': request_data.get('imageModelMetaInfo', {}).get('modelVersion') if request_data.get('imageModelMetaInfo') else None,
                'image_provider_name': request_data.get('imageModelMetaInfo', {}).get('provider') if request_data.get('imageModelMetaInfo') else None,
                'generated_image_prompt': None,
                'reference_images': None,
                'image_prompt_retry_count': 0,
            }

            logger.debug(
                "[LangGraph:%s] Starting workflow state=%s",
                self.instance_key,
                self._summarize_graph_state(state),
            )

            # Run workflow with timeout (circuit breaker)
            final_state = await asyncio.wait_for(
                self.app.ainvoke(state),
                timeout=settings.LLM_TIMEOUT_SECONDS
            )

            logger.debug(
                "[LangGraph:%s] Workflow completed finalState=%s",
                self.instance_key,
                self._summarize_graph_state(final_state),
            )

        except asyncio.TimeoutError:
            logger.error(f"Circuit breaker triggered: Request exceeded {settings.LLM_TIMEOUT_SECONDS}s timeout")
            workspace_id = request_data.get('workspaceId')
            ai_chat_thread_id = request_data.get('aiChatThreadId')
            await self._publish_error(
                workspace_id,
                ai_chat_thread_id,
                f"Circuit breaker triggered: Processing timeout exceeded ({settings.LLM_TIMEOUT_SECONDS // 60} minutes)"
            )
        except Exception as e:
            logger.error(f"Error processing LLM request: {e}", exc_info=True)
            workspace_id = request_data.get('workspaceId')
            ai_chat_thread_id = request_data.get('aiChatThreadId')
            await self._publish_error(
                workspace_id,
                ai_chat_thread_id,
                str(e)
            )

    async def stop(self) -> None:
        """Stop the current streaming operation."""
        logger.debug(f"Stopping stream for instance: {self.instance_key}")
        self.should_stop = True

        if self.stream_task and not self.stream_task.done():
            self.stream_task.cancel()
            try:
                await self.stream_task
            except asyncio.CancelledError:
                logger.debug(f"Stream task cancelled for {self.instance_key}")

    # Workflow nodes

    async def _validate_request(self, state: ProviderState) -> ProviderState:
        """
        Validate the incoming request.

        Args:
            state: Current workflow state

        Returns:
            Updated state
        """
        logger.debug(f"Validating request for {self.instance_key}")

        # Validate required fields
        if not state.get('model_version'):
            raise ValueError("model_version is required")

        if not state.get('messages'):
            raise ValueError("messages list is required")

        if not state.get('workspace_id'):
            raise ValueError("workspace_id is required")

        if not state.get('ai_chat_thread_id'):
            raise ValueError("ai_chat_thread_id is required")

        logger.debug(f"Request validation passed for {self.instance_key}")
        return state

    async def _stream_tokens(self, state: ProviderState) -> ProviderState:
        """
        Stream tokens from the LLM provider (to be implemented by subclasses).

        Args:
            state: Current workflow state

        Returns:
            Updated state with usage information
        """
        state['stream_active'] = True

        try:
            # Delegate to provider-specific implementation
            updated_state = await self._stream_impl(state)
            return updated_state

        except Exception as e:
            logger.error(f"Streaming error ({self.get_provider_name()}): {e}")
            state['error'] = str(e)
            try:
                await self._publish_error(
                    state['workspace_id'],
                    state['ai_chat_thread_id'],
                    str(e)
                )
                await self._publish_stream_end(state['workspace_id'], state['ai_chat_thread_id'])
            except Exception:
                logger.error("Failed to publish error/end events to NATS")
            return state
        finally:
            state['stream_active'] = False
            state['ai_request_finished_at'] = int(datetime.now().timestamp() * 1000)

    async def _calculate_usage(self, state: ProviderState) -> ProviderState:
        """
        Calculate and report token usage.

        Args:
            state: Current workflow state

        Returns:
            Updated state
        """
        if state.get('error'):
            logger.debug("Skipping usage calculation due to error")
            return state

        usage = state.get('usage', {})
        image_usage = state.get('image_usage')

        # Report text token usage if available
        if usage:
            try:
                self.usage_reporter.report_tokens_usage(
                    event_meta=state['event_meta'],
                    ai_model_meta_info=state['ai_model_meta_info'],
                    ai_vendor_request_id=state.get('ai_vendor_request_id', 'unknown'),
                    ai_vendor_model_name=state['model_version'],
                    usage=usage,
                    ai_request_received_at=state['ai_request_received_at'],
                    ai_request_finished_at=state['ai_request_finished_at']
                )
            except Exception as e:
                logger.error(f"Failed to report token usage: {e}")

        # Report image usage if available
        if image_usage:
            try:
                self.usage_reporter.report_image_usage(
                    event_meta=state['event_meta'],
                    ai_model_meta_info=state['ai_model_meta_info'],
                    ai_vendor_request_id=state.get('ai_vendor_request_id', 'unknown'),
                    image_size=image_usage.get('size', 'auto'),
                    image_quality=image_usage.get('quality', 'high'),
                    ai_request_received_at=state['ai_request_received_at'],
                    ai_request_finished_at=state['ai_request_finished_at']
                )
            except Exception as e:
                logger.error(f"Failed to report image usage: {e}")

        return state

    async def _cleanup(self, state: ProviderState) -> ProviderState:
        """
        Cleanup resources and finalize the request.

        Args:
            state: Current workflow state

        Returns:
            Updated state
        """
        logger.debug(f"Cleaning up instance: {self.instance_key}")
        self.should_stop = False
        return state

    # Helper methods

    async def _publish_stream_start(
        self,
        workspace_id: str,
        ai_chat_thread_id: str
    ) -> None:
        self._reset_tag_processor()
        self.nats_client.publish(
            f"ai.interaction.chat.receiveMessage.{workspace_id}.{ai_chat_thread_id}",
            {
                'content': {
                    'status': StreamStatus.START_STREAM,
                    'aiProvider': self.get_provider_name()
                },
                'aiChatThreadId': ai_chat_thread_id
            }
        )

    async def _publish_stream_chunk(
        self,
        workspace_id: str,
        ai_chat_thread_id: str,
        text: str
    ) -> None:
        await self._publish_stream_chunk_tag_aware(workspace_id, ai_chat_thread_id, text)

    async def _publish_stream_chunk_raw(
        self,
        workspace_id: str,
        ai_chat_thread_id: str,
        text: str
    ) -> None:
        self.nats_client.publish(
            f"ai.interaction.chat.receiveMessage.{workspace_id}.{ai_chat_thread_id}",
            {
                'content': {
                    'text': text,
                    'status': StreamStatus.STREAMING,
                    'aiProvider': self.get_provider_name()
                },
                'aiChatThreadId': ai_chat_thread_id
            }
        )

    def _reset_tag_processor(self) -> None:
        self._tag_buffer = ''
        self._inside_collapsible = False

    async def _publish_stream_chunk_tag_aware(
        self,
        workspace_id: str,
        ai_chat_thread_id: str,
        text: str
    ) -> None:
        subject = f"ai.interaction.chat.receiveMessage.{workspace_id}.{ai_chat_thread_id}"
        provider = self.get_provider_name()

        # Append incoming text to buffer
        self._tag_buffer += text

        while self._tag_buffer:
            if not self._inside_collapsible:
                # Look for opening tag
                idx = self._tag_buffer.find(self._COLLAPSIBLE_OPEN_TAG)
                if idx == -1:
                    # No tag found — check if the tail might be a partial tag
                    safe_len = len(self._tag_buffer) - self._TAG_BUFFER_SIZE
                    if safe_len > 0:
                        # Flush safe portion as normal text
                        flush = self._tag_buffer[:safe_len]
                        self._tag_buffer = self._tag_buffer[safe_len:]
                        self.nats_client.publish(subject, {
                            'content': { 'text': flush, 'status': StreamStatus.STREAMING, 'aiProvider': provider },
                            'aiChatThreadId': ai_chat_thread_id
                        })
                    # Keep remainder in buffer for next chunk
                    break
                else:
                    # Flush text before the tag
                    if idx > 0:
                        before = self._tag_buffer[:idx]
                        self.nats_client.publish(subject, {
                            'content': { 'text': before, 'status': StreamStatus.STREAMING, 'aiProvider': provider },
                            'aiChatThreadId': ai_chat_thread_id
                        })
                    # Strip the tag and publish COLLAPSIBLE_START
                    self._tag_buffer = self._tag_buffer[idx + len(self._COLLAPSIBLE_OPEN_TAG):]
                    self._inside_collapsible = True
                    self.nats_client.publish(subject, {
                        'content': {
                            'status': StreamStatus.COLLAPSIBLE_START,
                            'collapsibleTitle': 'Image generation prompt',
                            'aiProvider': provider
                        },
                        'aiChatThreadId': ai_chat_thread_id
                    })
            else:
                # Inside collapsible — look for closing tag
                idx = self._tag_buffer.find(self._COLLAPSIBLE_CLOSE_TAG)
                if idx == -1:
                    # No closing tag yet — flush safe portion as streaming content
                    safe_len = len(self._tag_buffer) - self._TAG_BUFFER_SIZE
                    if safe_len > 0:
                        flush = self._tag_buffer[:safe_len]
                        self._tag_buffer = self._tag_buffer[safe_len:]
                        self.nats_client.publish(subject, {
                            'content': { 'text': flush, 'status': StreamStatus.STREAMING, 'aiProvider': provider },
                            'aiChatThreadId': ai_chat_thread_id
                        })
                    break
                else:
                    # Flush text before closing tag
                    if idx > 0:
                        before = self._tag_buffer[:idx]
                        self.nats_client.publish(subject, {
                            'content': { 'text': before, 'status': StreamStatus.STREAMING, 'aiProvider': provider },
                            'aiChatThreadId': ai_chat_thread_id
                        })
                    # Strip tag and publish COLLAPSIBLE_END
                    self._tag_buffer = self._tag_buffer[idx + len(self._COLLAPSIBLE_CLOSE_TAG):]
                    self._inside_collapsible = False
                    self.nats_client.publish(subject, {
                        'content': {
                            'status': StreamStatus.COLLAPSIBLE_END,
                            'aiProvider': provider
                        },
                        'aiChatThreadId': ai_chat_thread_id
                    })

    async def _flush_tag_buffer(
        self,
        workspace_id: str,
        ai_chat_thread_id: str
    ) -> None:
        if self._tag_buffer:
            subject = f"ai.interaction.chat.receiveMessage.{workspace_id}.{ai_chat_thread_id}"
            provider = self.get_provider_name()
            self.nats_client.publish(subject, {
                'content': { 'text': self._tag_buffer, 'status': StreamStatus.STREAMING, 'aiProvider': provider },
                'aiChatThreadId': ai_chat_thread_id
            })
            self._tag_buffer = ''
        # If we were inside a collapsible when stream ended, close it gracefully
        if self._inside_collapsible:
            subject = f"ai.interaction.chat.receiveMessage.{workspace_id}.{ai_chat_thread_id}"
            provider = self.get_provider_name()
            self.nats_client.publish(subject, {
                'content': { 'status': StreamStatus.COLLAPSIBLE_END, 'aiProvider': provider },
                'aiChatThreadId': ai_chat_thread_id
            })
            self._inside_collapsible = False

    async def _publish_stream_end(
        self,
        workspace_id: str,
        ai_chat_thread_id: str
    ) -> None:
        await self._flush_tag_buffer(workspace_id, ai_chat_thread_id)
        self.nats_client.publish(
            f"ai.interaction.chat.receiveMessage.{workspace_id}.{ai_chat_thread_id}",
            {
                'content': {
                    'text': '',
                    'status': StreamStatus.END_STREAM,
                    'aiProvider': self.get_provider_name()
                },
                'aiChatThreadId': ai_chat_thread_id
            }
        )

    async def _upload_image_to_storage(
        self,
        workspace_id: str,
        image_base64: str
    ) -> Optional[Dict[str, Any]]:
        """
        Upload a base64-encoded image to the API's image storage.

        Args:
            workspace_id: Workspace identifier
            image_base64: Base64-encoded image data (PNG)

        Returns:
            Upload result with fileId and url, or None on failure
        """
        try:
            # Decode base64 to bytes
            image_bytes = base64.b64decode(image_base64)

            # Create multipart form data
            files = {
                'file': ('generated-image.png', BytesIO(image_bytes), 'image/png')
            }
            data = {
                'useContentHash': 'true'  # Enable deduplication
            }

            # Upload to API internal endpoint (no auth required for service-to-service calls)
            api_url = f"http://lixpi-api:3000/api/images/internal/{workspace_id}"

            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    api_url,
                    files=files,
                    data=data
                )

                if response.status_code == 200:
                    result = response.json()
                    logger.debug(f"Image uploaded: {result.get('fileId')} (duplicate: {result.get('isDuplicate', False)})")
                    return result
                else:
                    logger.error(f"Image upload failed: {response.status_code} - {response.text}")
                    return None

        except Exception as e:
            logger.error(f"Failed to upload image: {e}", exc_info=True)
            return None

    async def _publish_image_partial(
        self,
        workspace_id: str,
        ai_chat_thread_id: str,
        image_base64: str,
        partial_index: int
    ) -> None:
        """
        Upload and publish a partial image during streaming generation.

        Args:
            workspace_id: Workspace identifier
            ai_chat_thread_id: AI chat thread identifier
            image_base64: Base64-encoded partial image data
            partial_index: Index of this partial (0, 1, 2, ...)
        """
        if not image_base64:
            # Empty image means generation just started, send placeholder
            logger.debug(f"Publishing IMAGE_PARTIAL event (start placeholder): partialIndex={partial_index}")
            self.nats_client.publish(
                f"ai.interaction.chat.receiveMessage.{workspace_id}.{ai_chat_thread_id}",
                {
                    'content': {
                        'status': StreamStatus.IMAGE_PARTIAL,
                        'imageUrl': '',
                        'fileId': '',
                        'partialIndex': partial_index,
                        'aiProvider': self.get_provider_name()
                    },
                    'aiChatThreadId': ai_chat_thread_id
                }
            )
            return

        # Upload image to storage first
        upload_result = await self._upload_image_to_storage(workspace_id, image_base64)

        if not upload_result:
            logger.warning(f"Failed to upload partial image {partial_index}, skipping")
            return

        logger.debug(f"Publishing IMAGE_PARTIAL event: partialIndex={partial_index}, url={upload_result['url']}")
        self.nats_client.publish(
            f"ai.interaction.chat.receiveMessage.{workspace_id}.{ai_chat_thread_id}",
            {
                'content': {
                    'status': StreamStatus.IMAGE_PARTIAL,
                    'imageUrl': upload_result['url'],
                    'fileId': upload_result['fileId'],
                    'partialIndex': partial_index,
                    'aiProvider': self.get_provider_name()
                },
                'aiChatThreadId': ai_chat_thread_id
            }
        )

    async def _publish_image_complete(
        self,
        workspace_id: str,
        ai_chat_thread_id: str,
        image_base64: str,
        response_id: str,
        revised_prompt: str,
        image_model_id: str = ''
    ) -> None:
        """
        Upload and publish a completed generated image.

        Args:
            workspace_id: Workspace identifier
            ai_chat_thread_id: AI chat thread identifier
            image_base64: Base64-encoded final image data
            response_id: OpenAI response ID for multi-turn editing
            revised_prompt: The prompt as revised/interpreted by the model
            image_model_id: The model ID used to generate the image
        """
        # Upload image to storage first
        upload_result = await self._upload_image_to_storage(workspace_id, image_base64)

        if not upload_result:
            logger.error("Failed to upload completed image")
            return

        logger.debug(f"Publishing IMAGE_COMPLETE event: url={upload_result['url']}, responseId={response_id}")
        self.nats_client.publish(
            f"ai.interaction.chat.receiveMessage.{workspace_id}.{ai_chat_thread_id}",
            {
                'content': {
                    'status': StreamStatus.IMAGE_COMPLETE,
                    'imageUrl': upload_result['url'],
                    'fileId': upload_result['fileId'],
                    'responseId': response_id,
                    'revisedPrompt': revised_prompt,
                    'aiProvider': self.get_provider_name(),
                    'imageModelProvider': self.get_provider_name(),
                    'imageModelId': image_model_id
                },
                'aiChatThreadId': ai_chat_thread_id
            }
        )

    async def _publish_error(
        self,
        workspace_id: str,
        ai_chat_thread_id: str,
        error_message: str,
        error_code: Optional[str] = None,
        error_type: Optional[str] = None
    ) -> None:
        """
        Publish error back to services/api.

        Args:
            workspace_id: Workspace identifier
            ai_chat_thread_id: AI chat thread identifier
            error_message: Error message
            error_code: Optional error code from provider
            error_type: Optional error type from provider
        """
        instance_key = f"{workspace_id}:{ai_chat_thread_id}"
        error_data = {
            'error': error_message,
            'instanceKey': instance_key
        }
        if error_code:
            error_data['errorCode'] = error_code
        if error_type:
            error_data['errorType'] = error_type

        self.nats_client.publish(
            f"ai.interaction.chat.error.{instance_key}",
            error_data
        )

    # Abstract methods to be implemented by subclasses

    @abstractmethod
    async def _stream_impl(self, state: ProviderState) -> ProviderState:
        """
        Provider-specific streaming implementation.

        Must update state with:
        - usage: Token usage dictionary
        - ai_vendor_request_id: Request ID from provider

        Args:
            state: Current workflow state

        Returns:
            Updated state
        """
        pass

    async def _rewrite_image_prompt_to_fit_limit(
        self,
        state: ProviderState,
        prompt: str,
        max_chars: int
    ) -> Optional[str]:
        raise NotImplementedError(
            f"{self.get_provider_name()} provider does not implement image prompt rewriting"
        )

    @abstractmethod
    def get_provider_name(self) -> str:
        """
        Get the provider name.

        Returns:
            Provider name ('OpenAI' or 'Anthropic')
        """
        pass
