#!/bin/sh
set -e

LOCALAUTH0_URL="http://localhost:3000"
AUDIENCE="http://localhost:3005"

echo "Configuring LocalAuth0..."

# Set custom claims
echo "Setting custom claims..."
/bin/busybox wget -q -O- --post-data='{
    "custom_claims": [
        { "name": "https://lixpi.ai/admission", "value": { "Json": { "v": 1, "epoch": 1 } } },
        { "name": "email", "value": { "String": "test@local.dev" } },
        { "name": "name", "value": { "String": "Test User" } },
        { "name": "given_name", "value": { "String": "Test" } },
        { "name": "family_name", "value": { "String": "User" } },
        { "name": "email_verified", "value": { "Json": true } }
    ]
}' \
    --header="Content-Type: application/json" \
    "$LOCALAUTH0_URL/oauth/token/custom_claims" > /dev/null

# Set user info
echo "Setting user info..."
/bin/busybox wget -q -O- --post-data='{
    "subject": "local|test-user-001",
    "name": "Test User",
    "given_name": "Test",
    "family_name": "User",
    "email": "test@local.dev",
    "email_verified": true,
    "picture": ""
}' \
    --header="Content-Type: application/json" \
    "$LOCALAUTH0_URL/oauth/token/user_info" > /dev/null

# Set permissions for the API audience
echo "Setting permissions for audience: $AUDIENCE..."
/bin/busybox wget -q -O- --post-data="{
    \"audience\": \"$AUDIENCE\",
    \"permissions\": [
        \"user:read\",
        \"user:write\",
        \"subscription:read\",
        \"subscription:write\",
        \"ai:chat\",
        \"ai:models\",
        \"document:read\",
        \"document:write\",
        \"organization:read\",
        \"organization:write\"
    ]
}" \
    --header="Content-Type: application/json" \
    "$LOCALAUTH0_URL/permissions" > /dev/null

echo "LocalAuth0 configuration complete!"
