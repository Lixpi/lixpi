#!/bin/bash

# Signs in to AWS SSO for a chosen .env.* stage. Run from the repo root: ./aws-sso-login.sh
#
# The login runs inside the lixpi-pulumi container because that's the only
# container with the AWS CLI. The SSO token cache lands in the shared aws-config
# volume mounted at /root/.aws, so every other container (api, nex, web-ui)
# picks up the refreshed credentials without logging in again.
#
# Device-code flow is used because the container has no browser: the CLI prints
# a URL and a code, and you approve it in the browser on your host.

source ./scripts/partials/select-env-file.sh

if ! lixpi_select_env_file; then
    exit 1
fi

echo ""
echo "Using: $selected_env"
echo ""

aws_profile=$(grep -E '^AWS_PROFILE=' "$selected_env" | tail -n 1 | cut -d '=' -f 2- | tr -d '"' | tr -d "'" | xargs)

if [ -z "$aws_profile" ]; then
    echo "AWS_PROFILE is not set in $selected_env."
    echo "Add it, or re-run the setup wizard to configure an AWS SSO profile."
    exit 1
fi

if [ ! -f ".aws/config" ]; then
    echo "No .aws/config found in the repo root."
    echo "Copy .aws/config.example and fill in your sso-session and profiles first."
    exit 1
fi

echo "Signing in to AWS SSO as profile '$aws_profile'..."
echo "A URL and a verification code will be printed below. Open the URL on this machine and approve the code."
echo ""

docker compose --env-file "$selected_env" --profile deploy run --rm --no-deps lixpi-pulumi \
    -c "aws sso login --profile '$aws_profile' --use-device-code"
login_exit_code=$?

if [ $login_exit_code -ne 0 ]; then
    echo ""
    echo "AWS SSO login failed."
    exit 1
fi

echo ""
echo "✓ Signed in as '$aws_profile'. The token is cached in the shared aws-config volume."
echo ""
echo "Restart running containers to pick up the refreshed credentials."
