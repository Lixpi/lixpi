#!/bin/sh

echo "=== NATS Entrypoint Script Starting ==="
echo "Current time: $(date)"
echo "Hostname: $(hostname)"

# Debug: Show all environment variables
echo "=== Environment Variables ==="
env | grep -E "(AWS_|PUBLIC_|NATS_|ECS_)" | sort

# Generate server name from hostname ONLY if NATS_SERVER_NAME is not already set
# AWS (Pulumi): Sets NATS_SERVER_NAME_BASE, entrypoint generates unique name per container
# Local (docker-compose): Sets NATS_SERVER_NAME explicitly, entrypoint respects it
HOSTNAME=$(hostname)
if [ -z "$NATS_SERVER_NAME" ]; then
    export NATS_SERVER_NAME="${NATS_SERVER_NAME_BASE:-Lixpi-NATS}-${HOSTNAME}"
    echo "Generated NATS_SERVER_NAME: $NATS_SERVER_NAME"
else
    echo "Using pre-configured NATS_SERVER_NAME: $NATS_SERVER_NAME"
fi

# Generate server tags config file with unique server identifier for JetStream placement
# The "server:<name>" tag is used by unique_tag: "server:" for replica distribution
echo "Generating server tags configuration..."
echo "server_tags: [\"server:${NATS_SERVER_NAME}\"]" > /opt/nats/server-tags.conf
echo "Generated /opt/nats/server-tags.conf with content:"
cat /opt/nats/server-tags.conf

# Check if we're in ECS/Fargate by looking for metadata URI
if [ -n "$ECS_CONTAINER_METADATA_URI_V4" ] || [ -n "$ECS_CONTAINER_METADATA_URI" ]; then
    echo "ECS/Fargate environment detected"

    # Try external IP service first (more reliable than AWS metadata service)
    echo "Fetching public IP from external service..."
    PUBLIC_IP=$(timeout 5s curl -s --max-time 3 --connect-timeout 2 http://checkip.amazonaws.com/ 2>/dev/null | tr -d '\n' || echo "")

    if [ -n "$PUBLIC_IP" ] && [ "$PUBLIC_IP" != "404 - Not Found" ]; then
        echo "✅ Public IP detected: $PUBLIC_IP"

        # Get private IP from hostname (more reliable than metadata service)
        PRIVATE_IP=$(hostname -i 2>/dev/null || echo "")
        echo "Private IP from hostname: $PRIVATE_IP"

        # If hostname -i fails, try AWS metadata service as fallback
        if [ -z "$PRIVATE_IP" ]; then
            PRIVATE_IP=$(timeout 2s curl -s --max-time 1 --connect-timeout 1 http://169.254.169.254/latest/meta-data/local-ipv4 2>/dev/null || echo "")
            echo "Private IP from metadata service: $PRIVATE_IP"
        fi

        echo "🚀 NATS will advertise PUBLIC IP to clients: $PUBLIC_IP:4222"
        CLIENT_ADVERTISE="--client_advertise=${PUBLIC_IP}:4222"

        if [ -n "$PRIVATE_IP" ]; then
            echo "🔗 NATS will advertise PRIVATE IP to cluster: $PRIVATE_IP:6222"
            CLUSTER_ADVERTISE="--cluster_advertise=${PRIVATE_IP}:6222"
        fi
    else
        echo "⚠️  Could not fetch public IP from external service"
        echo "⚠️  NATS will use default IP advertising"
        CLIENT_ADVERTISE=""
        CLUSTER_ADVERTISE=""
    fi
else
    echo "Local development environment"
    CLIENT_ADVERTISE=""
    CLUSTER_ADVERTISE=""
fi

# Setup SSL certificates for TLS (always enabled)
echo "=== Setting up SSL certificates for TLS ==="

# Create SSL directories
mkdir -p /etc/ssl/certs /etc/ssl/private

# Certificates MUST be provided by the certificate manager - no fallbacks
if [ "$USE_REAL_CERTIFICATES" != "true" ] || [ -z "$CERT_STORAGE_TYPE" ]; then
    echo "❌ CRITICAL: USE_REAL_CERTIFICATES is not true or CERT_STORAGE_TYPE is not set"
    echo "❌ Certificates must be managed by the dedicated certificate manager service"
    exit 1
fi

echo "🔐 Retrieving TLS certificates from certificate manager..."

# Install required tools if needed for certificate download
if ! command -v aws >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1 || ! command -v openssl >/dev/null 2>&1; then
    echo "Installing required tools for certificate management..."
    apk add --no-cache aws-cli curl jq openssl
fi

    # Retrieve certificates based on storage type
    case "$CERT_STORAGE_TYPE" in
        "local")
            echo "📁 Using local certificates from certificate manager..."

            # Check if local certificate files exist
            if [ ! -f "$CERT_LOCAL_PATH/localhost.crt" ] || [ ! -f "$CERT_LOCAL_PATH/localhost.key" ]; then
                echo "❌ CRITICAL: Local certificate files not found"
                echo "   Expected: $CERT_LOCAL_PATH/localhost.crt and $CERT_LOCAL_PATH/localhost.key"
                echo "   Available files:"
                ls -la "$CERT_LOCAL_PATH/" 2>/dev/null || echo "   Directory does not exist"
                exit 1
            fi

            # Copy certificates to standard location
            cp "$CERT_LOCAL_PATH/localhost.crt" /etc/ssl/certs/server.crt
            cp "$CERT_LOCAL_PATH/localhost.key" /etc/ssl/private/server.key
            ;;
        "secrets-manager")
        echo "📦 Downloading certificate from Secrets Manager..."

        # Check if secret exists
        if ! aws secretsmanager describe-secret --secret-id "$CERT_SECRET_NAME" >/dev/null 2>&1; then
            echo "❌ CRITICAL: Secret $CERT_SECRET_NAME not found in Secrets Manager"
            exit 1
        fi

        # Download certificate
        CERT_SECRET=$(aws secretsmanager get-secret-value --secret-id "$CERT_SECRET_NAME" --query SecretString --output text)
        if [ -z "$CERT_SECRET" ]; then
            echo "❌ CRITICAL: Failed to retrieve certificate secret from Secrets Manager"
            exit 1
        fi

        # Validate and extract certificate
        if ! echo "$CERT_SECRET" | jq -e '.certificate' >/dev/null 2>&1 || ! echo "$CERT_SECRET" | jq -e '.private_key' >/dev/null 2>&1; then
            echo "❌ CRITICAL: Invalid certificate format in secret"
            exit 1
        fi

        echo "$CERT_SECRET" | jq -r '.certificate' > /etc/ssl/certs/server.crt
        echo "$CERT_SECRET" | jq -r '.private_key' > /etc/ssl/private/server.key
        ;;
    "s3")
        echo "📦 Downloading certificate from S3..."

        # Check if S3 objects exist
        if ! aws s3api head-object --bucket "$CERT_S3_BUCKET" --key "$CERT_S3_PREFIX/$CERT_DOMAIN/fullchain.pem" >/dev/null 2>&1 || \
           ! aws s3api head-object --bucket "$CERT_S3_BUCKET" --key "$CERT_S3_PREFIX/$CERT_DOMAIN/privkey.pem" >/dev/null 2>&1; then
            echo "❌ CRITICAL: Certificate files not found in S3"
            exit 1
        fi

        # Download certificates
        if ! aws s3 cp "s3://$CERT_S3_BUCKET/$CERT_S3_PREFIX/$CERT_DOMAIN/fullchain.pem" /etc/ssl/certs/server.crt || \
           ! aws s3 cp "s3://$CERT_S3_BUCKET/$CERT_S3_PREFIX/$CERT_DOMAIN/privkey.pem" /etc/ssl/private/server.key; then
            echo "❌ CRITICAL: Failed to download certificates from S3"
            exit 1
        fi
        ;;
    "efs")
        echo "📁 Copying certificate from EFS..."

        # Check if certificate files exist in EFS
        if [ ! -f "$CERT_EFS_PATH/$CERT_DOMAIN/fullchain.pem" ] || [ ! -f "$CERT_EFS_PATH/$CERT_DOMAIN/privkey.pem" ]; then
            echo "❌ CRITICAL: Certificate files not found in EFS"
            exit 1
        fi

        # Copy certificates
        if ! cp "$CERT_EFS_PATH/$CERT_DOMAIN/fullchain.pem" /etc/ssl/certs/server.crt || \
           ! cp "$CERT_EFS_PATH/$CERT_DOMAIN/privkey.pem" /etc/ssl/private/server.key; then
            echo "❌ CRITICAL: Failed to copy certificates from EFS"
            exit 1
        fi
        ;;
    *)
        echo "❌ CRITICAL: Unknown certificate storage type: $CERT_STORAGE_TYPE"
        exit 1
        ;;
esac

# Set proper permissions
chmod 644 /etc/ssl/certs/server.crt
chmod 600 /etc/ssl/private/server.key

# Verify certificate files exist, are not empty, and are valid
if [ ! -s /etc/ssl/certs/server.crt ] || [ ! -s /etc/ssl/private/server.key ]; then
    echo "❌ CRITICAL: Certificate files are missing or empty"
    exit 1
fi

if ! openssl x509 -in /etc/ssl/certs/server.crt -noout 2>/dev/null; then
    echo "❌ CRITICAL: Retrieved certificate is invalid"
    exit 1
fi

echo "✅ TLS certificates retrieved and validated successfully"
openssl x509 -in /etc/ssl/certs/server.crt -noout -subject -dates
NATS_CONFIG="/opt/nats/nats-server.conf"

echo "=== Starting NATS Server ==="
echo "Using config file: $NATS_CONFIG"
echo "Final command: nats-server --name \"$NATS_SERVER_NAME\" $CLIENT_ADVERTISE $CLUSTER_ADVERTISE --config $NATS_CONFIG $*"

# Start NATS with the appropriate configuration file
exec nats-server --name "$NATS_SERVER_NAME" $CLIENT_ADVERTISE $CLUSTER_ADVERTISE --config "$NATS_CONFIG" "$@"