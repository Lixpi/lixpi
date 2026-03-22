import logging
from typing import Dict, Any

from providers.base import ProviderState

logger = logging.getLogger(__name__)


class ImageRouter:
    @staticmethod
    def _summarize_state(state: ProviderState) -> Dict[str, Any]:
        prompt = state.get('generated_image_prompt') or ''
        reference_images = state.get('reference_images') or []
        return {
            'workspace_id': state.get('workspace_id'),
            'ai_chat_thread_id': state.get('ai_chat_thread_id'),
            'image_provider_name': state.get('image_provider_name'),
            'image_model_version': state.get('image_model_version'),
            'image_size': state.get('image_size'),
            'has_generated_image_prompt': bool(prompt),
            'generated_image_prompt_length': len(prompt),
            'reference_images_count': len(reference_images),
            'image_prompt_retry_count': state.get('image_prompt_retry_count'),
            'error': state.get('error'),
        }

    @staticmethod
    def _summarize_request(request_data: Dict[str, Any]) -> Dict[str, Any]:
        messages = request_data.get('messages') or []
        first_message = messages[0] if messages and isinstance(messages[0], dict) else {}
        content = first_message.get('content', '') if isinstance(first_message, dict) else ''
        content_type = type(content).__name__ if content is not None else None
        content_parts_count = len(content) if isinstance(content, list) else None

        return {
            'workspaceId': request_data.get('workspaceId'),
            'aiChatThreadId': request_data.get('aiChatThreadId'),
            'enableImageGeneration': request_data.get('enableImageGeneration'),
            'imageSize': request_data.get('imageSize'),
            'provider': request_data.get('aiModelMetaInfo', {}).get('provider'),
            'modelVersion': request_data.get('aiModelMetaInfo', {}).get('modelVersion'),
            'messages_count': len(messages),
            'first_message_content_type': content_type,
            'first_message_content_parts_count': content_parts_count,
        }

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
            logger.error(
                "[ImageRouter] Missing provider, model, or prompt state=%s",
                self._summarize_state(state),
            )
            return state

        instance_key = f"{workspace_id}:{ai_chat_thread_id}:image"
        reference_images = state.get('reference_images') or []

        logger.info(
            "[ImageRouter] Routing provider=%s model=%s promptLen=%d refImages=%d imageSize=%s instanceKey=%s",
            image_provider, image_model, len(prompt), len(reference_images), image_size, instance_key,
        )

        try:
            provider_instance = self._create_provider(
                image_provider, instance_key, nats_client, usage_reporter
            )

            request_data = self._build_request(
                state, prompt, image_model, image_meta, image_size
            )
            logger.debug(
                "[ImageRouter] Built request request=%s",
                self._summarize_request(request_data),
            )

            await provider_instance.process(request_data)

            state['image_usage'] = {
                'generatedCount': 1,
                'size': image_size,
                'quality': 'high'
            }

            logger.info("[ImageRouter] Completed successfully instanceKey=%s", instance_key)

        except Exception as e:
            logger.error(
                "[ImageRouter] Image generation failed error=%s state=%s",
                e,
                self._summarize_state(state),
                exc_info=True,
            )

        return state

    def _create_provider(self, provider_name: str, instance_key: str, nats_client, usage_reporter):
        from providers.openai.provider import OpenAIProvider
        from providers.anthropic.provider import AnthropicProvider
        from providers.google.provider import GoogleProvider
        from providers.stability.provider import StabilityProvider

        if provider_name == 'OpenAI':
            return OpenAIProvider(instance_key, nats_client, usage_reporter)
        elif provider_name == 'Anthropic':
            return AnthropicProvider(instance_key, nats_client, usage_reporter)
        elif provider_name == 'Google':
            return GoogleProvider(instance_key, nats_client, usage_reporter)
        elif provider_name == 'Stability':
            return StabilityProvider(instance_key, nats_client, usage_reporter)
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
            for idx, img in enumerate(reference_images):
                content_parts.append({
                    'type': 'input_image',
                    'image_url': img,
                    'detail': 'high'
                })
            messages = [{'role': 'user', 'content': content_parts}]
        else:
            logger.debug("[ImageRouter] No reference images — text-only request")

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
