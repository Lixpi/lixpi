#!/bin/bash

# Find all .env files in the current directory
env_files=($(ls -1 .env.* 2>/dev/null))

if [ ${#env_files[@]} -eq 0 ]; then
    echo "No .env files found in the current directory."
    echo "Run init-config first to create one."
    exit 1
fi

echo "Available environment files:"
for i in "${!env_files[@]}"; do
    echo "  $((i+1)). ${env_files[$i]}"
done
echo ""

# Ask user to select an env file
while true; do
    read -p "Select environment file [1-${#env_files[@]}]: " selection
    if [[ "$selection" =~ ^[0-9]+$ ]] && [ "$selection" -ge 1 ] && [ "$selection" -le ${#env_files[@]} ]; then
        break
    fi
    echo "Invalid selection. Please enter a number between 1 and ${#env_files[@]}."
done

selected_env="${env_files[$((selection-1))]}"
echo ""
echo "Using: $selected_env"
echo ""

# Start Caddy to generate certificates
echo "Starting Caddy to generate TLS certificates..."
docker-compose --env-file "$selected_env" up -d lixpi-caddy

# Wait for certificates to be generated
echo "Waiting for certificates to be generated..."
sleep 5

# Check if certificates exist
while ! docker run --rm -v lixpi-lists_caddy-certs:/certs busybox test -f /certs/ca.crt; do
    echo "Waiting for CA certificate..."
    sleep 2
done

echo "Certificates generated successfully!"
echo ""

# Extract CA certificate
echo "Extracting CA certificate..."
docker run --rm -v lixpi-lists_caddy-certs:/certs busybox cat /certs/ca.crt > ca.crt

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

# Stop Caddy
echo "Stopping Caddy..."
docker-compose --env-file "$selected_env" down

echo ""

# Initialize DynamoDB tables
echo "Initializing DynamoDB tables..."
docker-compose --env-file "$selected_env" --profile deploy up --abort-on-container-exit --exit-code-from lixpi-pulumi-init

if [ $? -ne 0 ]; then
    echo "Database initialization failed."
    exit 1
fi

echo ""
echo "✓ Infrastructure initialization complete!"
echo ""
echo "You can now start the application with: ./start.sh"
