"""
Lixpi LLM API Service - Main application entry point.
Python-based microservice for handling AI model interactions via NATS.
"""

import asyncio
import os
from contextlib import asynccontextmanager
from colorama import Fore, Style
import uvicorn

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from lixpi_debug_tools import log, info, err, info_str
from lixpi_nats_service import NatsService, NatsServiceConfig
from providers.registry import ProviderRegistry
from NATS.subscriptions.ai_interaction_subjects import get_ai_interaction_subjects


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager - handles startup and shutdown."""
    info_str([Fore.MAGENTA, "=== ", Fore.CYAN, "Lixpi LLM API Service Starting ", Fore.MAGENTA, "===" , Style.RESET_ALL])

    # Initialize NATS client with self-issued JWT
    from config import settings

    # Initialize provider registry
    provider_registry = ProviderRegistry()

    # Get subscription definitions (TypeScript pattern)
    subscriptions = [
        *get_ai_interaction_subjects(provider_registry),
    ]

    # Check if local CA cert exists (for self-signed certs in local development)
    ca_cert_path = "/opt/nats/certs/ca.crt"
    tls_ca_cert = ca_cert_path if os.path.exists(ca_cert_path) else None

    nats_config = NatsServiceConfig(
        servers=[s.strip() for s in settings.NATS_SERVERS.split(',')],
        name="llm-api-service",
        nkey_seed=settings.NATS_NKEY_SEED,
        user_id="svc:llm-service",
        tls_ca_cert=tls_ca_cert,
        max_reconnect_attempts=-1,
        reconnect_time_wait=0.5,
        subscriptions=subscriptions
    )

    nats_client = await NatsService.init(nats_config)
    app.state.nats_client = nats_client

    # Set NATS client reference in registry
    provider_registry.set_nats_client(nats_client)
    app.state.provider_registry = provider_registry

    info("Lixpi LLM API Service started successfully")
    print("\n\n")

    yield

    # Cleanup
    info("Shutting down Lixpi LLM API Service...")
    await provider_registry.shutdown()
    await nats_client.disconnect()
    info("Shutdown complete")


app = FastAPI(
    title="Lixpi LLM API",
    description="Python-based microservice for AI model interactions",
    version="0.1.0",
    lifespan=lifespan
)


@app.get("/health")
async def health_check():
    """Health check endpoint for container orchestration."""
    return JSONResponse(
        status_code=200,
        content={
            "status": "healthy",
            "service": "lixpi-llm-api",
            "version": "0.1.0"
        }
    )


@app.get("/")
async def root():
    """Root endpoint - redirects to health check."""
    return JSONResponse(
        status_code=200,
        content={
            "message": "Lixpi LLM API Service",
            "health_check": "/health"
        }
    )


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
