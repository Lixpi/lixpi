# Set Node.js version
ARG PYTHON_VERSION=3.12

# Stage 1: Builder
FROM python:${PYTHON_VERSION}-alpine AS builder

# Install uv package manager
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Set working directory
WORKDIR /app

# Copy lixpi packages (needed for local file:// dependencies)
COPY packages/lixpi/constants/python ./packages/lixpi/constants/python
COPY packages/lixpi/constants/nats-subjects.json ./packages/lixpi/constants/python/nats-subjects.json
COPY packages/lixpi/constants/ai-interaction-constants.json ./packages/lixpi/constants/ai-interaction-constants.json
COPY packages/lixpi/debug-tools/python ./packages/lixpi/debug-tools/python
COPY packages/lixpi/nats-service/python ./packages/lixpi/nats-service/python

# Copy dependency files
COPY services/llm-api/pyproject.toml ./

# Install dependencies using uv
RUN uv pip install --system --no-cache -r pyproject.toml


# Stage 2: Runtime
FROM python:${PYTHON_VERSION}-alpine

# Install curl for health checks
RUN apk add --no-cache curl

# Install uv in runtime stage
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Set working directory
WORKDIR /app

# Add src to PYTHONPATH
ENV PYTHONPATH=/app/src

# Copy installed dependencies from builder
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy application source
COPY services/llm-api/src/ ./src/

# Copy entrypoint script
COPY services/llm-api/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Expose port for health check endpoint
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Set entrypoint
ENTRYPOINT ["/entrypoint.sh"]

# Default command - run with uvicorn
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
