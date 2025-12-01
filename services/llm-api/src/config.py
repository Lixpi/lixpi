"""
Configuration management for LLM API service.
Loads environment variables and provides typed settings.
"""

import os
from typing import Optional
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Service configuration
    SERVICE_NAME: str = "llm-api"
    LOG_LEVEL: str = "INFO"

    # NATS configuration
    NATS_SERVERS: str = "nats://localhost:4222"
    NATS_NKEY_SEED: str  # NKey seed for signing self-issued JWTs

    # AI Provider API Keys
    OPENAI_API_KEY: Optional[str] = None
    ANTHROPIC_API_KEY: Optional[str] = None

    # Circuit breaker settings
    LLM_TIMEOUT_SECONDS: int = 1200  # 20 minutes

    class Config:
        env_file = ".env"
        case_sensitive = True


# Global settings instance
settings = Settings()
