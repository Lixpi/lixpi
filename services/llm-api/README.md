# Lixpi LLM API Service

Python-based microservice for handling AI model interactions via NATS messaging.

## Architecture

This service is isolated in a separate NATS account (`LLM_SERVICE`) and communicates exclusively with `services/api` via internal subjects. It cannot access DynamoDB or be contacted directly by clients.

## Features

- **LangGraph-based LLM providers**: Modular state machine workflows for OpenAI and Anthropic
- **NATS messaging**: Subscribes to `ai.interaction.chat.*` internal subjects, publishes streaming responses
- **NKey authentication**: Service-to-service authentication using NATS NKeys
- **Raw token streaming**: Streams LLM deltas without markdown parsing
- **Circuit breaker**: 20-minute timeout for long-running operations
- **Health check endpoint**: FastAPI `/health` endpoint for container orchestration

## Development

```bash
# Install dependencies with uv
uv pip install -r pyproject.toml

# Run locally
python src/main.py

# Run with Docker
docker build -t lixpi/llm-api .
docker run -p 8000:8000 --env-file .env lixpi/llm-api
```

## Environment Variables

- `NATS_SERVERS`: NATS server URLs (comma-separated)
- `NATS_NKEY_SEED`: NKey seed for service authentication
- `OPENAI_API_KEY`: OpenAI API key
- `ANTHROPIC_API_KEY`: Anthropic API key
- `LLM_TIMEOUT_SECONDS`: Circuit breaker timeout (default: 1200s)
