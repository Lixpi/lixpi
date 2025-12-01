#!/bin/sh

echo "=== Lixpi LLM API Service Starting ==="
echo "Current time: $(date)"
echo "Hostname: $(hostname)"
echo "Python version: $(python --version)"

# Debug: Show relevant environment variables
echo "=== Environment Variables ==="
env | grep -E "(NATS_|OPENAI_|ANTHROPIC_)" | sed -e 's/\(API_KEY\)=.*/\1=***REDACTED***/' -e 's/\(NKEY_SEED\)=.*/\1=***REDACTED***/' | sort

# Verify required environment variables
if [ -z "$NATS_SERVERS" ]; then
    echo "ERROR: NATS_SERVERS environment variable is required"
    exit 1
fi

if [ -z "$NATS_NKEY_SEED" ]; then
    echo "ERROR: NATS_NKEY_SEED environment variable is required"
    exit 1
fi

# Check if at least one AI provider API key is set
if [ -z "$OPENAI_API_KEY" ] && [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "WARNING: No AI provider API keys found. At least one of OPENAI_API_KEY or ANTHROPIC_API_KEY should be set."
fi

echo "Environment validation complete"

# Execute the command passed to the entrypoint
echo "=== Starting application ==="
exec "$@"
