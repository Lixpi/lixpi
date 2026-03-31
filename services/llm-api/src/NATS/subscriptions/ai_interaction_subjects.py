"""
AI Interaction NATS subscriptions for LLM API service.
Handles chat processing and stop requests.
"""

import asyncio
import logging

from lixpi_debug_tools import info, warn, err
from lixpi_constants import NATS_SUBJECTS

logger = logging.getLogger(__name__)

# Extract AI interaction subjects
AI_INTERACTION_SUBJECTS = NATS_SUBJECTS["AI_INTERACTION_SUBJECTS"]
CHAT_PROCESS = AI_INTERACTION_SUBJECTS["CHAT_PROCESS"]
CHAT_STOP = AI_INTERACTION_SUBJECTS["CHAT_STOP"]
CHAT_ERROR = AI_INTERACTION_SUBJECTS["CHAT_ERROR"]


def get_ai_interaction_subjects(registry):
    """
    Get AI interaction NATS subscription definitions.

    Args:
        registry: Provider registry instance for handler access

    Returns:
        List of subscription configurations
    """

    # Active processing tasks keyed by instance_key, enabling concurrent request handling
    active_tasks: dict[str, asyncio.Task] = {}

    async def _process_request(instance_key, provider_name, data):
        """Process a single chat request. Runs as an independent asyncio task."""
        try:
            provider = registry._get_or_create_instance(instance_key, provider_name)
            await provider.process(data)
        except Exception as e:
            err(f"Error processing chat request for {instance_key}: {e}")

            workspace_id = data.get('workspaceId', 'unknown')
            ai_chat_thread_id = data.get('aiChatThreadId', 'unknown')
            registry.nats_client.publish(
                f"{CHAT_ERROR}.{instance_key}",
                {
                    'error': str(e),
                    'instanceKey': instance_key
                }
            )
        finally:
            registry._remove_instance(instance_key)
            active_tasks.pop(instance_key, None)
            info(f"Chat request completed for {instance_key}")

    # Handler: Process chat requests from api service
    async def _handler_chat_process(data, msg):
        # Extract request data
        workspace_id = data.get('workspaceId')
        ai_chat_thread_id = data.get('aiChatThreadId')
        ai_model_meta_info = data.get('aiModelMetaInfo', {})
        provider_name = ai_model_meta_info.get('provider')

        if not workspace_id:
            err("Missing workspaceId in request")
            return

        if not ai_chat_thread_id:
            err("Missing aiChatThreadId in request")
            return

        if not provider_name:
            err("Missing provider in aiModelMetaInfo")
            return

        instance_key = f"{workspace_id}:{ai_chat_thread_id}"

        # If a request is already running for this thread, skip the duplicate
        if instance_key in active_tasks and not active_tasks[instance_key].done():
            warn(f"Request already in progress for {instance_key}, skipping duplicate")
            return

        info(f"Spawning chat request task for {instance_key} using {provider_name}")

        # Spawn as independent task so the NATS handler returns immediately.
        # This allows concurrent processing of requests from different threads.
        task = asyncio.create_task(
            _process_request(instance_key, provider_name, data),
            name=f"chat-process:{instance_key}"
        )
        active_tasks[instance_key] = task

    # Handler: Stop streaming request
    async def _handler_chat_stop(data, msg):
        try:
            # Extract instance key from subject (ai.interaction.chat.stop.{instanceKey})
            instance_key = '.'.join(msg.subject.split('.')[4:])

            info(f"Received stop request for {instance_key}")

            # Find and stop the instance
            provider = registry.instances.get(instance_key)
            if provider:
                await provider.stop()
                info(f"Stopped instance: {instance_key}")
            else:
                warn(f"Instance not found: {instance_key}")

        except Exception as e:
            err(f"Error handling chat stop: {e}")

    return [
        # Process chat requests from api service
        {
            'subject': CHAT_PROCESS,
            'type': 'subscribe',
            'payloadType': 'json',
            'queue': 'llm-workers',
            'permissions': {
                'pub': {
                    'allow': [
                        f"{CHAT_ERROR}.>",  # Publish errors back to API
                        "ai.interaction.chat.receiveMessage.>"  # Stream LLM responses to web-ui
                    ]
                },
                'sub': {
                    'allow': [
                        CHAT_PROCESS,  # Subscribe to chat processing requests
                        f"{CHAT_STOP}.>"  # Subscribe to stop requests
                    ]
                }
            },
            'handler': _handler_chat_process
        },

        # Handle stop requests
        {
            'subject': f"{CHAT_STOP}.>",
            'type': 'subscribe',
            'payloadType': 'json',
            'permissions': {
                'sub': {
                    'allow': [
                        f"{CHAT_STOP}.>"
                    ]
                }
            },
            'handler': _handler_chat_stop
        }
    ]
