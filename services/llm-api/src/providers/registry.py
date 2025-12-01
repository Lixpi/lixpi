"""
Provider registry for managing LLM provider instances.
Handles instance lifecycle and provider routing.
"""

from typing import Dict, Optional

from lixpi_debug_tools import log, info, warn, err
from lixpi_nats_service import NatsService
from providers.openai.provider import OpenAIProvider
from providers.anthropic.provider import AnthropicProvider
from services.usage_reporter import UsageReporter


class ProviderRegistry:
    """
    Manages LLM provider instances and handles provider routing.
    """

    def __init__(self):
        """
        Initialize provider registry.
        """
        self.nats_client: Optional[NatsService] = None
        self.usage_reporter: Optional[UsageReporter] = None

        # Instance registry: {documentId:threadId -> Provider instance}
        self.instances: Dict[str, any] = {}

    def set_nats_client(self, nats_client: NatsService) -> None:
        """
        Set NATS client reference after initialization.

        Args:
            nats_client: NATS client instance
        """
        self.nats_client = nats_client
        self.usage_reporter = UsageReporter(nats_client)

    async def shutdown(self) -> None:
        """Shutdown all active provider instances."""
        info("Shutting down provider registry...")

        # Stop all active instances
        for instance_key, provider in list(self.instances.items()):
            info(f"Stopping instance: {instance_key}")
            await provider.stop()

        self.instances.clear()
        info("Provider registry shutdown complete")

    def _get_or_create_instance(self, instance_key: str, provider_name: str):
        """
        Get existing provider instance or create a new one.

        Args:
            instance_key: Unique instance identifier
            provider_name: Provider name ('OpenAI' or 'Anthropic')

        Returns:
            Provider instance
        """
        # Return existing instance if available
        if instance_key in self.instances:
            info(f"Reusing existing instance: {instance_key}")
            return self.instances[instance_key]

        # Create new instance
        info(f"Creating new {provider_name} instance: {instance_key}")

        if provider_name == 'OpenAI':
            provider = OpenAIProvider(
                instance_key,
                self.nats_client,
                self.usage_reporter
            )
        elif provider_name == 'Anthropic':
            provider = AnthropicProvider(
                instance_key,
                self.nats_client,
                self.usage_reporter
            )
        else:
            raise ValueError(f"Unsupported provider: {provider_name}")

        # Store instance
        self.instances[instance_key] = provider

        return provider

    def _remove_instance(self, instance_key: str) -> None:
        """
        Remove a provider instance from the registry.

        Args:
            instance_key: Instance identifier
        """
        if instance_key in self.instances:
            info(f"Removing instance: {instance_key}")
            del self.instances[instance_key]
