#!/bin/bash

# Sets up TLS certificates and DynamoDB tables. The dev console calls it with the
# environment file chosen in its menu:
#
#   init-infrastructure.sh <env-file>
#
#   LIXPI_CONSOLE_OPTION_TRUST_CERTIFICATE   install adds the local certificate
#                                            authority to this computer's trust
#                                            store; skip (the default) leaves the
#                                            computer unchanged

cd "$(dirname "$0")/../../.." || exit 1

selected_env="${LIXPI_CONSOLE_ENV_FILE:-${1:-}}"

if [ -z "$selected_env" ]; then
    echo "Usage: init-infrastructure.sh <env-file>"
    exit 1
fi

trust_certificate="${LIXPI_CONSOLE_OPTION_TRUST_CERTIFICATE:-skip}"
case "$trust_certificate" in
    skip|install) ;;
    *) echo "LIXPI_CONSOLE_OPTION_TRUST_CERTIFICATE must be skip or install, found $trust_certificate." >&2; exit 2 ;;
esac

# Pulumi shares the application's Compose project, so the running stack isn't orphaned.
export COMPOSE_IGNORE_ORPHANS=true

# Start Caddy to generate certificates
echo "Starting Caddy to generate TLS certificates..."
docker compose -f infrastructure/docker/utilities/certificates/docker-compose.certificates.yml --env-file "$selected_env" up -d lixpi-caddy

# Wait for certificates to be generated
echo "Waiting for certificates to be generated..."
sleep 5

# Check if certificates exist
while ! docker run --rm -v lixpi_caddy-certs:/certs busybox test -f /certs/ca.crt; do
    echo "Waiting for CA certificate..."
    sleep 2
done

echo "Certificates generated successfully!"
echo ""

# The local stack serves HTTPS with certificates from its own certificate
# authority. A browser trusts them only when that authority is in the
# computer's trust store, so running web-ui in a browser needs this step. The
# desktop app embeds the authority and trusts it itself, and remote
# environments use public certificates, so neither needs it.
install_certificate_authority() {
    # Extract CA certificate
    echo "Extracting CA certificate..."
    docker run --rm -v lixpi_caddy-certs:/certs busybox cat /certs/ca.crt > ca.crt

    # Detect OS and install certificate
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        echo "Installing CA certificate on macOS..."
        sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ca.crt
        if [ $? -eq 0 ]; then
            echo "✓ Certificate installed successfully on macOS"
        else
            echo "✗ Failed to install certificate on macOS"
            exit 1
        fi
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        echo "Installing CA certificate on Linux..."

        # Check which Linux distro
        if [ -f /etc/debian_version ]; then
            # Debian/Ubuntu
            sudo cp ca.crt /usr/local/share/ca-certificates/lixpi-caddy-ca.crt
            sudo update-ca-certificates
        elif [ -f /etc/redhat-release ]; then
            # RedHat/CentOS/Fedora
            sudo cp ca.crt /etc/pki/ca-trust/source/anchors/lixpi-caddy-ca.crt
            sudo update-ca-trust
        else
            echo "Warning: Unknown Linux distribution. Please install ca.crt manually."
            echo "Certificate saved to: $(pwd)/ca.crt"
        fi

        if [ $? -eq 0 ]; then
            echo "✓ Certificate installed successfully on Linux"
        else
            echo "✗ Failed to install certificate on Linux"
            exit 1
        fi
    else
        echo "Warning: Unsupported OS type: $OSTYPE"
        echo "Certificate saved to: $(pwd)/ca.crt"
        echo "Please install it manually."
    fi

    echo ""
}

if [ "$trust_certificate" = install ]; then
    install_certificate_authority
else
    echo "Skipping the certificate authority install, so this computer's trust store is unchanged."
    echo "The desktop app trusts the local certificates itself. To open the local web-ui in a"
    echo "browser without certificate errors, rerun Initialize infrastructure with Trust: Install."
fi

echo ""

# Stop Caddy
echo "Stopping Caddy..."
docker compose -f infrastructure/docker/utilities/certificates/docker-compose.certificates.yml --env-file "$selected_env" down

echo ""

# Initialize DynamoDB tables
echo "Initializing DynamoDB tables..."

# Start DynamoDB first and wait for it to be healthy
docker compose -f infrastructure/docker/utilities/infrastructure/docker-compose.pulumi.yml --env-file "$selected_env" up -d lixpi-dynamodb
echo "Waiting for DynamoDB to be ready..."
until docker inspect lixpi-dynamodb --format='{{.State.Health.Status}}' 2>/dev/null | grep -q "healthy"; do
    echo "Waiting for DynamoDB..."
    sleep 2
done
echo "DynamoDB is ready!"

# Run pulumi-init and wait for it to complete
docker compose -f infrastructure/docker/utilities/infrastructure/docker-compose.pulumi.yml --env-file "$selected_env" up --build lixpi-pulumi-init
init_exit_code=$?

# Stop DynamoDB
docker compose -f infrastructure/docker/utilities/infrastructure/docker-compose.pulumi.yml --env-file "$selected_env" down

if [ $init_exit_code -ne 0 ]; then
    echo "Database initialization failed."
    exit 1
fi

echo ""
echo "✓ Infrastructure initialization complete!"
