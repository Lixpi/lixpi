"""
Base provider abstraction using LangGraph for LLM interactions.
Defines the common workflow: validate → stream → calculate_usage → cleanup
"""

import asyncio
import base64
import logging
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


class BaseLLMProvider(ABC):
    """
    Base class for LLM providers using LangGraph workflows.
    """

    def __init__(
        self,
        instance_key: str,
        nats_client,
        usage_reporter: UsageReporter
    ):
        """
        Initialize base provider.

        Args:
            instance_key: Unique identifier for this instance (documentId:threadId)
            nats_client: NATS client for publishing responses
            usage_reporter: Usage reporter for tracking costs
        """
        self.instance_key = instance_key
        self.nats_client = nats_client
        self.usage_reporter = usage_reporter
        self.stream_task: Optional[asyncio.Task] = None
        self.should_stop = False

        # Build LangGraph workflow
        self.workflow = self._build_workflow()
        self.app = self.workflow.compile()

    def _build_workflow(self) -> StateGraph:
        """
        Build the LangGraph state machine workflow.

        Workflow: validate_request → stream_tokens → calculate_usage → cleanup
        """
        workflow = StateGraph(ProviderState)

        # Add nodes
        workflow.add_node("validate_request", self._validate_request)
        workflow.add_node("stream_tokens", self._stream_tokens)
        workflow.add_node("calculate_usage", self._calculate_usage)
        workflow.add_node("cleanup", self._cleanup)

        # Add edges
        workflow.set_entry_point("validate_request")
        workflow.add_edge("validate_request", "stream_tokens")
        workflow.add_edge("stream_tokens", "calculate_usage")
        workflow.add_edge("calculate_usage", "cleanup")
        workflow.add_edge("cleanup", END)

        return workflow

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
            }

            # Run workflow with timeout (circuit breaker)
            await asyncio.wait_for(
                self.app.ainvoke(state),
                timeout=settings.LLM_TIMEOUT_SECONDS
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
        logger.info(f"Stopping stream for instance: {self.instance_key}")
        self.should_stop = True

        if self.stream_task and not self.stream_task.done():
            self.stream_task.cancel()
            try:
                await self.stream_task
            except asyncio.CancelledError:
                logger.info(f"Stream task cancelled for {self.instance_key}")

    # Workflow nodes

    async def _validate_request(self, state: ProviderState) -> ProviderState:
        """
        Validate the incoming request.

        Args:
            state: Current workflow state

        Returns:
            Updated state
        """
        logger.info(f"Validating request for {self.instance_key}")

        # Validate required fields
        if not state.get('model_version'):
            raise ValueError("model_version is required")

        if not state.get('messages'):
            raise ValueError("messages list is required")

        if not state.get('workspace_id'):
            raise ValueError("workspace_id is required")

        if not state.get('ai_chat_thread_id'):
            raise ValueError("ai_chat_thread_id is required")

        logger.info(f"✅ Request validation passed for {self.instance_key}")
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
            logger.error(f"Error during streaming: {e}", exc_info=True)
            state['error'] = str(e)
            await self._publish_stream_end(state['workspace_id'], state['ai_chat_thread_id'])
            raise
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
            logger.info("Skipping usage calculation due to error")
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
        logger.info(f"Cleaning up instance: {self.instance_key}")
        self.should_stop = False
        return state

    # Helper methods

    async def _publish_stream_start(
        self,
        workspace_id: str,
        ai_chat_thread_id: str
    ) -> None:
        """
        Publish stream start marker to the client.

        Args:
            workspace_id: Workspace identifier
            ai_chat_thread_id: AI chat thread identifier
        """
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
        """
        Publish a streaming chunk to the client.

        Args:
            workspace_id: Workspace identifier
            ai_chat_thread_id: AI chat thread identifier
            text: Text content to stream
        """
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

    async def _publish_stream_end(
        self,
        workspace_id: str,
        ai_chat_thread_id: str
    ) -> None:
        """
        Publish stream end marker to the client.

        Args:
            workspace_id: Workspace identifier
            ai_chat_thread_id: AI chat thread identifier
        """
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
                    logger.info(f"Image uploaded: {result.get('fileId')} (duplicate: {result.get('isDuplicate', False)})")
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
        # Upload image to storage first
        upload_result = await self._upload_image_to_storage(workspace_id, image_base64)

        if not upload_result:
            logger.warning(f"Failed to upload partial image {partial_index}, skipping")
            return

        logger.info(f"Publishing IMAGE_PARTIAL event: partialIndex={partial_index}, url={upload_result['url']}")
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
        revised_prompt: str
    ) -> None:
        """
        Upload and publish a completed generated image.

        Args:
            workspace_id: Workspace identifier
            ai_chat_thread_id: AI chat thread identifier
            image_base64: Base64-encoded final image data
            response_id: OpenAI response ID for multi-turn editing
            revised_prompt: The prompt as revised/interpreted by the model
        """
        # Upload image to storage first
        upload_result = await self._upload_image_to_storage(workspace_id, image_base64)

        if not upload_result:
            logger.error("Failed to upload completed image")
            return

        logger.info(f"Publishing IMAGE_COMPLETE event: url={upload_result['url']}, responseId={response_id}")
        self.nats_client.publish(
            f"ai.interaction.chat.receiveMessage.{workspace_id}.{ai_chat_thread_id}",
            {
                'content': {
                    'status': StreamStatus.IMAGE_COMPLETE,
                    'imageUrl': upload_result['url'],
                    'fileId': upload_result['fileId'],
                    'responseId': response_id,
                    'revisedPrompt': revised_prompt,
                    'aiProvider': self.get_provider_name()
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

    @abstractmethod
    def get_provider_name(self) -> str:
        """
        Get the provider name.

        Returns:
            Provider name ('OpenAI' or 'Anthropic')
        """
        pass
