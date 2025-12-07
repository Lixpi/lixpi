"""
Base provider abstraction using LangGraph for LLM interactions.
Defines the common workflow: validate → stream → calculate_usage → cleanup
"""

import asyncio
import logging
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Dict, Any, Optional, AsyncIterator, TypedDict
from enum import Enum

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


class ProviderState(TypedDict, total=False):
    """
    State for LangGraph provider workflow.

    Fields:
        - messages: List of conversation messages
        - ai_model_meta_info: AI model configuration and pricing
        - event_meta: Event metadata (userId, organizationId, etc.)
        - thread_id: Thread identifier
        - document_id: Document identifier
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
    """
    messages: list
    ai_model_meta_info: Dict[str, Any]
    event_meta: Dict[str, Any]
    thread_id: Optional[str]
    document_id: str
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
                'thread_id': request_data.get('threadId'),
                'document_id': request_data.get('documentId'),
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
            }

            # Run workflow with timeout (circuit breaker)
            await asyncio.wait_for(
                self.app.ainvoke(state),
                timeout=settings.LLM_TIMEOUT_SECONDS
            )

        except asyncio.TimeoutError:
            logger.error(f"Circuit breaker triggered: Request exceeded {settings.LLM_TIMEOUT_SECONDS}s timeout")
            await self._publish_error(
                request_data.get('documentId'),
                f"Circuit breaker triggered: Processing timeout exceeded ({settings.LLM_TIMEOUT_SECONDS // 60} minutes)"
            )
        except Exception as e:
            logger.error(f"Error processing LLM request: {e}", exc_info=True)
            await self._publish_error(
                request_data.get('documentId'),
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

        if not state.get('document_id'):
            raise ValueError("document_id is required")

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
            await self._publish_stream_end(state['document_id'], state.get('thread_id'))
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
        if not usage:
            logger.warning("No usage data available")
            return state

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
            logger.error(f"Failed to report usage: {e}")

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
        document_id: str,
        thread_id: Optional[str] = None
    ) -> None:
        """
        Publish stream start marker to the client.

        Args:
            document_id: Document identifier
            thread_id: Optional thread identifier
        """
        self.nats_client.publish(
            f"ai.interaction.chat.receiveMessage.{document_id}",
            {
                'content': {
                    'status': StreamStatus.START_STREAM,
                    'aiProvider': self.get_provider_name()
                },
                'threadId': thread_id
            }
        )

    async def _publish_stream_chunk(
        self,
        document_id: str,
        text: str,
        thread_id: Optional[str] = None
    ) -> None:
        """
        Publish a streaming chunk to the client.

        Args:
            document_id: Document identifier
            text: Text content to stream
            thread_id: Optional thread identifier
        """
        self.nats_client.publish(
            f"ai.interaction.chat.receiveMessage.{document_id}",
            {
                'content': {
                    'text': text,
                    'status': StreamStatus.STREAMING,
                    'aiProvider': self.get_provider_name()
                },
                'threadId': thread_id
            }
        )

    async def _publish_stream_end(
        self,
        document_id: str,
        thread_id: Optional[str] = None
    ) -> None:
        """
        Publish stream end marker to the client.

        Args:
            document_id: Document identifier
            thread_id: Optional thread identifier
        """
        self.nats_client.publish(
            f"ai.interaction.chat.receiveMessage.{document_id}",
            {
                'content': {
                    'text': '',
                    'status': StreamStatus.END_STREAM,
                    'aiProvider': self.get_provider_name()
                },
                'threadId': thread_id
            }
        )

    async def _publish_error(
        self,
        instance_key: str,
        error_message: str,
        error_code: Optional[str] = None,
        error_type: Optional[str] = None
    ) -> None:
        """
        Publish error back to services/api.

        Args:
            instance_key: Instance key (documentId or documentId:threadId)
            error_message: Error message
            error_code: Optional error code from provider
            error_type: Optional error type from provider
        """
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
