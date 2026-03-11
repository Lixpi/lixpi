import logging
from typing import Dict, Any

from providers.base import ProviderState

logger = logging.getLogger(__name__)


class ImageRouter:
    async def execute(
        self,
        state: ProviderState,
        nats_client,
        usage_reporter
    ) -> ProviderState:
        image_provider = state.get('image_provider_name')
        image_model = state.get('image_model_version')
        image_meta = state.get('image_model_meta_info', {})
        prompt = state.get('generated_image_prompt', '')
        workspace_id = state['workspace_id']
        ai_chat_thread_id = state['ai_chat_thread_id']
        image_size = state.get('image_size', 'auto')

        if not image_provider or not image_model or not prompt:
            logger.error("ImageRouter: missing provider, model, or prompt")
            return state

        logger.info(f"ImageRouter: routing to {image_provider}:{image_model} with prompt: {prompt[:100]}...")

        instance_key = f"{workspace_id}:{ai_chat_thread_id}:image"

        try:
            provider_instance = self._create_provider(
                image_provider, instance_key, nats_client, usage_reporter
            )

            request_data = self._build_request(
                state, prompt, image_model, image_meta, image_size
            )

            await provider_instance.process(request_data)

            state['image_usage'] = {
                'generatedCount': 1,
                'size': image_size,
                'quality': 'high'
            }

        except Exception as e:
            logger.error(f"ImageRouter: image generation failed: {e}", exc_info=True)

        return state

    def _create_provider(self, provider_name: str, instance_key: str, nats_client, usage_reporter):
        from providers.openai.provider import OpenAIProvider
        from providers.anthropic.provider import AnthropicProvider
        from providers.google.provider import GoogleProvider

        if provider_name == 'OpenAI':
            return OpenAIProvider(instance_key, nats_client, usage_reporter)
        elif provider_name == 'Anthropic':
            return AnthropicProvider(instance_key, nats_client, usage_reporter)
        elif provider_name == 'Google':
            return GoogleProvider(instance_key, nats_client, usage_reporter)
        else:
            raise ValueError(f"Unsupported image provider: {provider_name}")

    def _build_request(
        self,
        state: ProviderState,
        prompt: str,
        image_model: str,
        image_meta: Dict[str, Any],
        image_size: str
    ) -> Dict[str, Any]:
        messages = [{'role': 'user', 'content': prompt}]

        reference_images = state.get('reference_images')
        if reference_images:
            content_parts = [{'type': 'input_text', 'text': prompt}]
            for img in reference_images:
                content_parts.append({
                    'type': 'input_image',
                    'image_url': img,
                    'detail': 'high'
                })
            messages = [{'role': 'user', 'content': content_parts}]

        image_meta_with_version = {**image_meta, 'modelVersion': image_model}

        return {
            'messages': messages,
            'aiModelMetaInfo': image_meta_with_version,
            'workspaceId': state['workspace_id'],
            'aiChatThreadId': state['ai_chat_thread_id'],
            'enableImageGeneration': True,
            'imageSize': image_size,
            'eventMeta': state['event_meta'],
        }
