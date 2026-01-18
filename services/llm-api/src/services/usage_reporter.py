"""
Usage reporting service for tracking AI token consumption and costs.
"""

import logging
from decimal import Decimal
from typing import Dict, Any, Optional
from datetime import datetime

logger = logging.getLogger(__name__)


class UsageReporter:
    """
    Track and report AI token usage and costs.

    TODO: Implement NATS-based reporting to replace SNS.
    For now, this is a placeholder that logs usage data.
    """

    def __init__(self, nats_client=None):
        """
        Initialize usage reporter.

        Args:
            nats_client: NATS client instance (for future NATS-based reporting)
        """
        self.nats_client = nats_client

    def report_tokens_usage(
        self,
        event_meta: Dict[str, Any],
        ai_model_meta_info: Dict[str, Any],
        ai_vendor_request_id: str,
        ai_vendor_model_name: str,
        usage: Dict[str, int],
        ai_request_received_at: int,
        ai_request_finished_at: int
    ) -> None:
        """
        Report AI token usage with pricing calculations.

        Args:
            event_meta: Metadata about the event (userId, stripeCustomerId, etc.)
            ai_model_meta_info: AI model configuration including pricing
            ai_vendor_request_id: Request ID from AI provider
            ai_vendor_model_name: Model name from AI provider
            usage: Token usage dictionary with keys:
                - promptTokens
                - promptAudioTokens
                - promptCachedTokens
                - completionTokens
                - completionAudioTokens
                - completionReasoningTokens
                - totalTokens
            ai_request_received_at: Request start timestamp (milliseconds)
            ai_request_finished_at: Request end timestamp (milliseconds)
        """
        try:
            # Extract pricing information
            pricing = ai_model_meta_info.get('pricing', {})
            resale_margin = Decimal(str(pricing.get('resaleMargin', '1.0')))
            price_per = Decimal(str(pricing.get('text', {}).get('pricePer', '1000000')))

            text_tiers = pricing.get('text', {}).get('tiers', {}).get('default', {})
            text_prompt_price = Decimal(str(text_tiers.get('prompt', '0')))
            text_completion_price = Decimal(str(text_tiers.get('completion', '0')))

            # Calculate resale prices
            text_prompt_price_resale = text_prompt_price * resale_margin
            text_completion_price_resale = text_completion_price * resale_margin

            # Extract token counts
            prompt_tokens = usage.get('promptTokens', 0)
            completion_tokens = usage.get('completionTokens', 0)
            total_tokens = usage.get('totalTokens', 0)

            # Calculate costs
            prompt_purchased_for = (text_prompt_price / price_per) * Decimal(str(prompt_tokens))
            prompt_sold_for = (text_prompt_price_resale / price_per) * Decimal(str(prompt_tokens))

            completion_purchased_for = (text_completion_price / price_per) * Decimal(str(completion_tokens))
            completion_sold_for = (text_completion_price_resale / price_per) * Decimal(str(completion_tokens))

            total_purchased_for = prompt_purchased_for + completion_purchased_for
            total_sold_for = prompt_sold_for + completion_sold_for

            # Build usage report
            usage_report = {
                'eventMeta': event_meta,
                'aiModel': f"{ai_model_meta_info.get('provider')}:{ai_model_meta_info.get('model')}",
                'aiVendorRequestId': ai_vendor_request_id,
                'aiRequestReceivedAt': ai_request_received_at,
                'aiRequestFinishedAt': ai_request_finished_at,
                'textPricePer': str(price_per),
                'textPromptPrice': str(text_prompt_price),
                'textCompletionPrice': str(text_completion_price),
                'textPromptPriceResale': str(text_prompt_price_resale),
                'textCompletionPriceResale': str(text_completion_price_resale),
                'prompt': {
                    'usageTokens': prompt_tokens,
                    'cachedTokens': usage.get('promptCachedTokens', 0),
                    'audioTokens': usage.get('promptAudioTokens', 0),
                    'purchasedFor': str(prompt_purchased_for),
                    'soldToClientFor': str(prompt_sold_for),
                },
                'completion': {
                    'usageTokens': completion_tokens,
                    'reasoningTokens': usage.get('completionReasoningTokens', 0),
                    'audioTokens': usage.get('completionAudioTokens', 0),
                    'purchasedFor': str(completion_purchased_for),
                    'soldToClientFor': str(completion_sold_for),
                },
                'total': {
                    'usageTokens': total_tokens,
                    'purchasedFor': str(total_purchased_for),
                    'soldToClientFor': str(total_sold_for),
                }
            }

            # TODO: Implement NATS-based reporting
            # For now, just log the usage report
            logger.info(f"📊 Token Usage Report: {usage_report}")

            # Future implementation:
            # await self.nats_client.publish('usage.tokens.ai', usage_report)

        except Exception as e:
            logger.error(f"Failed to report token usage: {e}", exc_info=True)

    def report_image_usage(
        self,
        event_meta: Dict[str, Any],
        ai_model_meta_info: Dict[str, Any],
        ai_vendor_request_id: str,
        image_size: str,
        image_quality: str,
        ai_request_received_at: int,
        ai_request_finished_at: int
    ) -> None:
        """
        Report AI image generation usage with pricing calculations.

        Args:
            event_meta: Metadata about the event (userId, stripeCustomerId, etc.)
            ai_model_meta_info: AI model configuration including pricing
            ai_vendor_request_id: Request ID from AI provider
            image_size: Generated image size (e.g., '1024x1024')
            image_quality: Image quality ('low', 'medium', 'high')
            ai_request_received_at: Request start timestamp (milliseconds)
            ai_request_finished_at: Request end timestamp (milliseconds)
        """
        try:
            # Extract pricing information
            pricing = ai_model_meta_info.get('pricing', {})
            resale_margin = Decimal(str(pricing.get('resaleMargin', '1.0')))

            # Image pricing is per image, mapped by size and quality
            image_pricing = pricing.get('image', {})
            size_pricing = image_pricing.get(image_size, image_pricing.get('default', {}))

            # Price for this quality level (default to high if not specified)
            quality_key = image_quality if image_quality in size_pricing else 'high'
            price_per_image = Decimal(str(size_pricing.get(quality_key, '0.04')))  # Default $0.04

            # Calculate resale price
            price_per_image_resale = price_per_image * resale_margin

            # Build usage report
            usage_report = {
                'eventMeta': event_meta,
                'aiModel': f"{ai_model_meta_info.get('provider')}:{ai_model_meta_info.get('model')}",
                'aiVendorRequestId': ai_vendor_request_id,
                'aiRequestReceivedAt': ai_request_received_at,
                'aiRequestFinishedAt': ai_request_finished_at,
                'image': {
                    'size': image_size,
                    'quality': image_quality,
                    'count': 1,
                    'pricePerImage': str(price_per_image),
                    'pricePerImageResale': str(price_per_image_resale),
                    'purchasedFor': str(price_per_image),
                    'soldToClientFor': str(price_per_image_resale),
                }
            }

            # TODO: Implement NATS-based reporting
            # For now, just log the usage report
            logger.info(f"🖼️ Image Usage Report: {usage_report}")

            # Future implementation:
            # await self.nats_client.publish('usage.images.ai', usage_report)

        except Exception as e:
            logger.error(f"Failed to report image usage: {e}", exc_info=True)
