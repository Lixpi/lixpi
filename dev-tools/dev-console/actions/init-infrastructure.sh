#!/bin/bash

# Sets up TLS certificates and DynamoDB tables in two separate phases. The dev console
# calls it with the environment file chosen in its menu:
#
#   init-infrastructure.sh <env-file>
#   LIXPI_CONSOLE_QUERY=catalog init-infrastructure.sh <env-file>
#
#   LIXPI_CONSOLE_OPTION_REGENERATE_CERTIFICATE   keep (the default) reuses the
#                                                 certificates in the caddy-certs
#                                                 volume; regenerate replaces them with
#                                                 a new certificate authority. With no
#                                                 certificates yet, they're generated
#                                                 either way
#   LIXPI_CONSOLE_OPTION_TRUST_CERTIFICATE        install adds the local certificate
#                                                 authority to this computer's trust
#                                                 store; skip (the default) leaves the
#                                                 computer unchanged
#
# The catalog query reports whether regenerating is possible, because the console runs
# in a container that can't see Docker volumes.

cd "$(dirname "$0")/../../.." || exit 1

selected_env="${LIXPI_CONSOLE_ENV_FILE:-${1:-}}"

if [ -z "$selected_env" ]; then
    echo "Usage: init-infrastructure.sh <env-file>"
    exit 1
fi

# The certificates compose file names its project lixpi, so the volume name is fixed.
CERTIFICATE_VOLUME=lixpi_caddy-certs
CERTIFICATES_COMPOSE=(docker compose -f infrastructure/docker/utilities/certificates/docker-compose.certificates.yml --env-file "$selected_env")
PULUMI_COMPOSE=(docker compose -f infrastructure/docker/utilities/infrastructure/docker-compose.pulumi.yml --env-file "$selected_env")

# Inspecting the volume first keeps the check from creating it. A volume Docker creates
# for `docker run` lacks Compose's labels, and Compose then warns about it on every run.
certificate_exists() {
    docker volume inspect "$CERTIFICATE_VOLUME" >/dev/null 2>&1 || return 1
    docker run --rm -v "$CERTIFICATE_VOLUME":/certs:ro busybox test -f /certs/ca.crt
}

if [ "${LIXPI_CONSOLE_QUERY:-}" = catalog ]; then
    docker info >/dev/null 2>&1 || { echo "Docker isn't running, so the certificate volume can't be checked." >&2; exit 1; }

    if certificate_exists; then
        echo '{"options":[{"name":"regenerate-certificate","available":true}]}'
    else
        echo '{"options":[{"name":"regenerate-certificate","available":false,"blockedReason":"No certificate exists in the caddy-certs volume yet, so this run generates one"}]}'
    fi

    exit 0
fi

regenerate_certificate="${LIXPI_CONSOLE_OPTION_REGENERATE_CERTIFICATE:-keep}"
case "$regenerate_certificate" in
    keep|regenerate) ;;
    *) echo "LIXPI_CONSOLE_OPTION_REGENERATE_CERTIFICATE must be keep or regenerate, found $regenerate_certificate." >&2; exit 2 ;;
esac

trust_certificate="${LIXPI_CONSOLE_OPTION_TRUST_CERTIFICATE:-skip}"
case "$trust_certificate" in
    skip|install) ;;
    *) echo "LIXPI_CONSOLE_OPTION_TRUST_CERTIFICATE must be skip or install, found $trust_certificate." >&2; exit 2 ;;
esac

# Pulumi shares the application's Compose project, so the running stack isn't orphaned.
export COMPOSE_IGNORE_ORPHANS=true

# Caddy reuses a certificate authority it finds in the volume, so regenerating starts
# from an empty volume. The local HTTPS gateway keeps its browser certificates in the
# same volume, and they go too, because the new authority didn't issue them.
clear_certificates() {
    echo "Removing the existing certificates..."
    docker run --rm -v "$CERTIFICATE_VOLUME":/certs busybox find /certs -mindepth 1 -delete || { echo "✗ Failed to remove the existing certificates." >&2; exit 1; }
}

# Local issuance runs once and exits, nonzero when it times out or produces invalid
# material, so its exit status decides whether setup continues.
generate_certificates() {
    echo "Generating TLS certificates with Caddy..."
    "${CERTIFICATES_COMPOSE[@]}" up --abort-on-container-exit --exit-code-from lixpi-caddy lixpi-caddy
    local status=$?
    "${CERTIFICATES_COMPOSE[@]}" down

    if [ $status -ne 0 ] || ! certificate_exists; then
        echo "✗ Certificate generation failed." >&2
        exit 1
    fi

    echo "Certificates generated successfully!"
}

# The local stack serves HTTPS with certificates from its own certificate
# authority. A browser trusts them only when that authority is in the
# computer's trust store, so running web-ui in a browser needs this step. The
# desktop app embeds the authority and trusts it itself, and remote
# environments use public certificates, so neither needs it.
install_certificate_authority() {
    # Extract CA certificate
    echo "Extracting CA certificate..."
    docker run --rm -v "$CERTIFICATE_VOLUME":/certs:ro busybox cat /certs/ca.crt > ca.crt

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

setup_certificates() {
    if ! certificate_exists; then
        echo "No certificates exist yet."
        generate_certificates
    elif [ "$regenerate_certificate" = regenerate ]; then
        clear_certificates
        generate_certificates
        echo "Running services still hold the previous certificates. Restart NATS and the local HTTPS gateway to serve the new ones."
    else
        echo "Keeping the existing certificates."
    fi

    echo ""

    if [ "$trust_certificate" = install ]; then
        install_certificate_authority
    else
        echo "Skipping the certificate authority install, so this computer's trust store is unchanged."
        echo "The desktop app trusts the local certificates itself. To open the local web-ui in a"
        echo "browser without certificate errors, rerun Initialize infrastructure with Install certificate: Install."
    fi
}

setup_dynamodb_tables() {
    echo "Initializing DynamoDB tables..."

    # Start DynamoDB first and wait for it to be healthy
    "${PULUMI_COMPOSE[@]}" up -d lixpi-dynamodb
    echo "Waiting for DynamoDB to be ready..."
    until docker inspect lixpi-dynamodb --format='{{.State.Health.Status}}' 2>/dev/null | grep -q "healthy"; do
        echo "Waiting for DynamoDB..."
        sleep 2
    done
    echo "DynamoDB is ready!"

    # Run pulumi-init and wait for it to complete
    "${PULUMI_COMPOSE[@]}" up --build lixpi-pulumi-init
    local init_exit_code=$?

    # Stop DynamoDB
    "${PULUMI_COMPOSE[@]}" down

    if [ $init_exit_code -ne 0 ]; then
        echo "Database initialization failed."
        exit 1
    fi
}

echo "== TLS certificates =="
setup_certificates

echo ""
echo "== DynamoDB tables =="
setup_dynamodb_tables

echo ""
echo "✓ Infrastructure initialization complete!"
