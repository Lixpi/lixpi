#!/bin/bash

# Signs in to AWS SSO. Run it from anywhere:
#
#   ./aws-sso-login.sh              # pick a .env.* stage and use its AWS_PROFILE
#   ./aws-sso-login.sh <profile>    # sign in as a named profile from .aws/config
#
# The login runs in the standalone lixpi-aws-cli container
# (docker-compose.aws-cli.yml). The SSO token cache lands in the shared
# lixpi-aws-config volume mounted at /root/.aws, so every other container that
# calls AWS (api, nex, pulumi, and other repositories' services that mount the
# same volume) picks up the refreshed credentials without logging in again.
# Other repositories run this script with their own profile name.
#
# Device-code flow is used because the container has no browser: the CLI prints
# a URL and a code, and you approve it in the browser on your host.

cd "$(dirname "$0")" || exit 1

aws_profile="$1"

if [ -z "$aws_profile" ]; then
    source ./scripts/partials/select-env-file.sh

    if ! lixpi_select_env_file; then
        exit 1
    fi

    echo ""
    echo "Using: $selected_env"
    echo ""

    aws_profile=$(grep -E '^[[:space:]]*AWS_PROFILE[[:space:]]*=' "$selected_env" | tail -n 1 | cut -d '=' -f 2- | tr -d '"' | tr -d "'" | xargs)

    if [ -z "$aws_profile" ]; then
        echo "AWS_PROFILE is not set in $selected_env."
        echo "Add it, or re-run the setup wizard to configure an AWS SSO profile."
        exit 1
    fi
fi

# Checked here because Docker would otherwise create an empty directory in its
# place for the container's bind mount.
if [ ! -f ".aws/config" ]; then
    echo "No .aws/config found in $(pwd)."
    echo "Copy .aws/config.example and fill in your sso-session and profiles first."
    exit 1
fi

echo "Signing in to AWS SSO as profile '$aws_profile'..."
echo "A URL and a verification code will be printed below. Open the URL on this machine and approve the code."
echo ""

docker compose -f docker-compose.aws-cli.yml run --rm lixpi-aws-cli \
    sso login --profile "$aws_profile" --use-device-code
login_exit_code=$?

if [ $login_exit_code -ne 0 ]; then
    echo ""
    echo "AWS SSO login failed."
    exit 1
fi

echo ""
echo "✓ Signed in as '$aws_profile'. The token is cached in the shared lixpi-aws-config volume."
echo ""
echo "Restart running containers to pick up the refreshed credentials."
