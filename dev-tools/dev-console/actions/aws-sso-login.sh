#!/bin/bash

# Signs in to AWS SSO. The dev console calls it with the environment file chosen
# in its menu. Other repositories call it directly with their own profile name:
#
#   LIXPI_CONSOLE_ENV_FILE=<file> aws-sso-login.sh   # what the console calls
#   aws-sso-login.sh --env-file <file>    # use that file's AWS_PROFILE
#   aws-sso-login.sh <profile>            # sign in as a named profile from .aws/config
#
# The login runs in the standalone lixpi-aws-cli container
# (infrastructure/docker/docker-compose.aws-cli.yml). The SSO token cache lands in the shared
# lixpi-aws-config volume mounted at /root/.aws, so every other container that
# calls AWS (api, nex, pulumi, and other repositories' services that mount the
# same volume) picks up the refreshed credentials without logging in again.
#
# Device-code flow is used because the container has no browser: the CLI prints
# a URL and a code, and you approve it in the browser on your host.

cd "$(dirname "$0")/../../.." || exit 1

if [ -n "${LIXPI_CONSOLE_ENV_FILE:-}" ]; then
    set -- --env-file "${LIXPI_CONSOLE_ENV_FILE}"
fi

if [ "$1" = "--env-file" ]; then
    selected_env="$2"
    aws_profile=$(grep -E '^[[:space:]]*AWS_PROFILE[[:space:]]*=' "$selected_env" | tail -n 1 | cut -d '=' -f 2- | tr -d '"' | tr -d "'" | xargs)

    if [ -z "$aws_profile" ]; then
        echo "AWS_PROFILE is not set in $selected_env."
        exit 1
    fi
else
    aws_profile="$1"

    if [ -z "$aws_profile" ]; then
        echo "Usage: aws-sso-login.sh --env-file <file> | <profile>"
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

docker compose -f infrastructure/docker/docker-compose.aws-cli.yml run --rm lixpi-aws-cli sso login --profile "$aws_profile" --use-device-code
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
