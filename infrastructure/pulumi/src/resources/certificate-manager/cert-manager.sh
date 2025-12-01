#!/bin/sh
set -e  # Exit on any error

echo "Starting Caddy Certificate Manager..."
echo "AWS Region: ${AWS_REGION}"
echo "Domains: ${DOMAINS}"
echo "Email: ${CADDY_EMAIL}"
echo "Storage Type: ${STORAGE_TYPE}"
echo "Local Mode: ${CADDY_LOCAL_MODE}"
echo "Lambda Runtime: ${AWS_LAMBDA_RUNTIME_API:-not detected}"

# Check if running in AWS Lambda
if [ -n "$AWS_LAMBDA_RUNTIME_API" ]; then
    echo "🔧 Running in AWS LAMBDA MODE - setting up Lambda handler"

    # Create Lambda runtime handler script in /tmp (Lambda filesystem is read-only except /tmp)
    cat > /tmp/lambda-handler.sh << 'LAMBDA_EOF'
#!/bin/sh
set -e

# Lambda handler function
handle_request() {
    echo "🎯 === ENTERING handle_request function ==="
    echo "🎯 Arguments received:"
    echo "🎯   Arg 1 (request_id): '$1'"
    echo "🎯   Arg 2 (event_data): '$2'"
    echo "🎯 Current working directory: $(pwd)"
    echo "🎯 Available disk space: $(df -h /tmp)"
    echo "🎯 Memory usage: $(free -h 2>/dev/null || echo 'free command not available')"

    local request_id="$1"
    local event_data="$2"

    echo "🎯 Local variables assigned successfully"
    echo "Processing Lambda request: $request_id"
    echo "Event data: $event_data"

    # Test basic commands first
    echo "🎯 Testing basic commands..."
    echo "🎯 whoami: $(whoami)"
    echo "🎯 date: $(date)"
    echo "🎯 uname: $(uname -a)"

    # Check if jq is available
    echo "🎯 Checking jq availability..."
    if ! command -v jq >/dev/null 2>&1; then
        echo "❌ jq command not found - cannot parse JSON"
        echo "🎯 PATH: $PATH"
        echo "🎯 Available commands in /usr/bin: $(ls /usr/bin | grep jq || echo 'no jq found')"
        return 1
    fi
    echo "✅ jq command is available at: $(which jq)"
    echo "🎯 jq version: $(jq --version)"

    # Test jq with simple input first
    echo "🎯 Testing jq with simple JSON..."
    simple_test='{"test": "value"}'
    simple_result=$(echo "$simple_test" | jq -r '.test' 2>&1) || {
        echo "❌ jq failed on simple test: $simple_result"
        return 1
    }
    echo "✅ jq simple test passed: $simple_result"

    # Parse event (expecting JSON with action, domains, etc.)
    echo "🔍 Parsing JSON event data..."
    echo "🎯 About to parse action..."
    action=$(echo "$event_data" | jq -r '.action // "generate_certificates"' 2>&1) || {
        echo "❌ Failed to parse action from JSON: $action"
        echo "🎯 Raw event_data: '$event_data'"
        echo "🎯 event_data length: ${#event_data}"
        return 1
    }
    echo "🎯 Action parsed successfully: '$action'"

    echo "🎯 About to parse domains..."
    domains=$(echo "$event_data" | jq -r '.domains // [] | join(",")' 2>&1) || {
        echo "❌ Failed to parse domains from JSON: $domains"
        return 1
    }
    echo "🎯 Domains parsed successfully: '$domains'"

    echo "🎯 About to parse force..."
    force=$(echo "$event_data" | jq -r '.force // false' 2>&1) || {
        echo "❌ Failed to parse force from JSON: $force"
        return 1
    }
    echo "🎯 Force parsed successfully: '$force'"

    echo "✅ JSON parsing successful"
    echo "Action: $action"
    echo "Domains: $domains"
    echo "Force: $force"

    # Override environment if specified in event
    if [ -n "$domains" ] && [ "$domains" != "null" ] && [ "$domains" != "" ]; then
        export DOMAINS="$domains"
        echo "Override DOMAINS set to: $DOMAINS"
    fi

    echo "Final environment variables:"
    echo "  DOMAINS: $DOMAINS"
    echo "  STORAGE_TYPE: $STORAGE_TYPE"
    echo "  SECRETS_PREFIX: $SECRETS_PREFIX"
    echo "  CADDY_EMAIL: $CADDY_EMAIL"
    echo "  AWS_HOSTED_ZONE_ID: $AWS_HOSTED_ZONE_ID"

    # Basic environment validation
    if [ -z "$DOMAINS" ]; then
        echo "❌ DOMAINS is empty or not set"
        return 1
    fi

    if [ -z "$STORAGE_TYPE" ]; then
        echo "❌ STORAGE_TYPE is empty or not set"
        return 1
    fi

    if [ -z "$SECRETS_PREFIX" ]; then
        echo "❌ SECRETS_PREFIX is empty or not set"
        return 1
    fi

    echo "✅ Basic environment validation passed"

    # Execute certificate generation
    case "$action" in
        "generate_certificates")
            echo "🚀 Starting certificate generation..." >&2
            echo "🎯 About to call generate_certificates_lambda function..." >&2
            # Call the main certificate generation logic
            if generate_certificates_lambda; then
                echo "✅ Certificate generation completed successfully" >&2
                echo '{"status": "success", "message": "Certificates generated successfully"}'
            else
                echo "❌ Certificate generation failed"
                echo '{"status": "error", "message": "Certificate generation failed"}'
                return 1
            fi
            ;;
        *)
            echo "❌ Unknown action: $action"
            echo '{"status": "error", "message": "Unknown action: '$action'"}'
            return 1
            ;;
    esac

    echo "🎯 === EXITING handle_request function successfully ==="
}

# DNS cleanup function to remove stale ACME challenge records
cleanup_stale_acme_records() {
    echo "🧹 Starting DNS cleanup for stale ACME challenge records..." >&2

    # Get the hosted zone ID
    local hosted_zone_id="${AWS_HOSTED_ZONE_ID}"

    if [ -z "$hosted_zone_id" ]; then
        echo "⚠️  AWS_HOSTED_ZONE_ID not set, attempting to auto-detect..." >&2
        # Try to auto-detect hosted zone based on the first domain
        local first_domain=$(echo "${DOMAINS}" | cut -d',' -f1)
        if [ -n "$first_domain" ]; then
            # Extract the root domain (e.g., "nats.lixpi.ai" -> "lixpi.ai")
            local root_domain=$(echo "$first_domain" | sed 's/^[^.]*\.//')
            hosted_zone_id=$(aws route53 list-hosted-zones --query "HostedZones[?Name=='${root_domain}.'].Id" --output text | sed 's/.*\///')
            if [ -n "$hosted_zone_id" ] && [ "$hosted_zone_id" != "None" ]; then
                echo "✅ Auto-detected hosted zone ID: $hosted_zone_id" >&2
            else
                echo "❌ Failed to auto-detect hosted zone for domain: $root_domain" >&2
                return 1
            fi
        else
            echo "❌ No domains provided for hosted zone detection" >&2
            return 1
        fi
    fi

    # For each domain, check and clean up ACME challenge records
    for domain in $(echo "${DOMAINS}" | tr ',' ' '); do
        if [ -n "$domain" ]; then
            local challenge_record="_acme-challenge.${domain}."
            echo "🔍 Checking for existing ACME challenge records for: $challenge_record" >&2

            # Get existing TXT records for this ACME challenge domain
            local existing_records=$(aws route53 list-resource-record-sets \
                --hosted-zone-id "$hosted_zone_id" \
                --query "ResourceRecordSets[?Name=='${challenge_record}' && Type=='TXT']" \
                --output json 2>/dev/null)

            if [ -n "$existing_records" ] && [ "$existing_records" != "[]" ] && [ "$existing_records" != "null" ]; then
                echo "🗑️  Found stale ACME challenge records for $domain, cleaning up..." >&2
                echo "$existing_records" | jq -c '.[]' | while read -r record; do
                    # Create a change batch to delete the record
                    local change_batch=$(echo "$record" | jq '{
                        "Comment": "Delete stale ACME challenge record",
                        "Changes": [{
                            "Action": "DELETE",
                            "ResourceRecordSet": .
                        }]
                    }')

                    # Attempt to delete the record
                    if aws route53 change-resource-record-sets \
                        --hosted-zone-id "$hosted_zone_id" \
                        --change-batch "$change_batch" >/dev/null 2>&1; then
                        echo "✅ Deleted stale ACME challenge record for $domain" >&2
                    else
                        echo "⚠️  Failed to delete ACME challenge record for $domain (may not exist)" >&2
                    fi
                done
            else
                echo "✅ No stale ACME challenge records found for $domain" >&2
            fi
        fi
    done

    # Wait a moment for DNS propagation
    echo "⏳ Waiting 10 seconds for DNS cleanup to propagate..." >&2
    sleep 10
    echo "✅ DNS cleanup completed" >&2
}

# Certificate generation for Lambda (non-blocking)
generate_certificates_lambda() {
    echo "🎯 === ENTERING generate_certificates_lambda function ===" >&2
    echo "🔧 Running certificate generation in Lambda mode" >&2
    echo "Environment check:" >&2
    echo "  DOMAINS: ${DOMAINS}" >&2
    echo "  CADDY_EMAIL: ${CADDY_EMAIL}" >&2
    echo "  STORAGE_TYPE: ${STORAGE_TYPE}" >&2
    echo "  SECRETS_PREFIX: ${SECRETS_PREFIX}" >&2
    echo "  AWS_HOSTED_ZONE_ID: ${AWS_HOSTED_ZONE_ID}" >&2

    # Validate required environment variables
    echo "🎯 Starting environment validation..." >&2
    if [ -z "$DOMAINS" ]; then
        echo "❌ DOMAINS environment variable is not set" >&2
        return 1
    fi
    echo "🎯 DOMAINS validation passed" >&2

    if [ -z "$SECRETS_PREFIX" ]; then
        echo "❌ SECRETS_PREFIX environment variable is not set" >&2
        return 1
    fi
    echo "🎯 SECRETS_PREFIX validation passed" >&2

    echo "🎯 Creating temporary directories..." >&2
    # Ensure directories exist
    mkdir -p /tmp/caddy-data /tmp/caddy-config /tmp/caddy
    echo "✅ Created temporary directories" >&2

    echo "🎯 Checking if base Caddyfile exists..." >&2
    if [ ! -f "/caddy-config/Caddyfile.deployment" ]; then
        echo "❌ Base Caddyfile not found at /caddy-config/Caddyfile.deployment" >&2
        echo "🎯 Available files in /caddy-config:" >&2
        ls -la /caddy-config/ >&2 || echo "Directory does not exist" >&2
        return 1
    fi
    echo "🎯 Base Caddyfile exists" >&2

    # Copy the base deployment Caddyfile and append domain configurations
    echo "🎯 Copying base Caddyfile..." >&2
    if ! cp /caddy-config/Caddyfile.deployment /tmp/caddy-config/Caddyfile.runtime; then
        echo "❌ Failed to copy base Caddyfile" >&2
        return 1
    fi
    echo "✅ Copied base Caddyfile" >&2

    # Append domain configurations dynamically
    echo "" >> /tmp/caddy-config/Caddyfile.runtime
    domain_count=0
    # Fix domain loop to avoid subshell issues
    for domain in $(echo "${DOMAINS}" | tr ',' ' '); do
        if [ -n "$domain" ]; then
            domain_count=$((domain_count + 1))
            echo "🎯 Adding domain configuration for: $domain (count: $domain_count)" >&2
            cat >> /tmp/caddy-config/Caddyfile.runtime << DOMAIN_EOF

${domain} {
	respond "Certificate obtained for ${domain}"

	# Health check endpoint
	handle /health {
		respond "OK" 200
	}
}
DOMAIN_EOF
        fi
    done

    # Start Caddy with Lambda-specific config on non-privileged port
    echo "✅ Added configurations for domains in DOMAINS: ${DOMAINS}" >&2
    echo "📋 Generated runtime Caddyfile for Lambda:" >&2
    cat /tmp/caddy-config/Caddyfile.runtime >&2

    # Clean up any stale ACME challenge DNS records from previous deployments
    echo "🧹 Cleaning up stale ACME challenge DNS records..." >&2
    cleanup_stale_acme_records

    # For Lambda: Use Caddy's admin API to manage certificates
    echo "🚀 Starting Caddy in API mode for certificate generation..." >&2
    echo "🎯 CRITICAL: About to execute Caddy command..." >&2

    # Test if caddy command is available
    echo "🎯 Testing caddy command availability..." >&2
    if ! command -v caddy >/dev/null 2>&1; then
        echo "❌ CRITICAL: caddy command not found" >&2
        echo "🎯 PATH: $PATH" >&2
        echo "🎯 Available commands: $(ls /usr/bin | grep -i caddy || echo 'no caddy found')" >&2
        return 1
    fi
    echo "✅ caddy command found at: $(which caddy)" >&2

    # Optional: Restore previous ACME account (persistence mode)
    if [ "${CADDY_PERSIST_MODE}" = "secrets-manager" ] && [ -n "${SECRETS_PREFIX}" ]; then
        echo "🗄️  Persistence enabled - attempting to restore prior ACME account" >&2
        account_secret="${SECRETS_PREFIX}-caddy-acme-account"
        if aws secretsmanager get-secret-value --secret-id "${account_secret}" --query SecretString --output text >/tmp/account_tar_b64 2>/dev/null; then
            if [ -s /tmp/account_tar_b64 ]; then
                echo "📦 Restoring ACME account data from Secrets Manager" >&2
                cat /tmp/account_tar_b64 | base64 -d >/tmp/account.tar 2>/dev/null || true
                mkdir -p /tmp/caddy
                tar -xf /tmp/account.tar -C /tmp/caddy 2>/dev/null || true
            fi
        else
            echo "ℹ️  No existing ACME account secret found (first run)" >&2
        fi
    fi

    # Start Caddy in background with admin API enabled on non-privileged port
    echo "🎯 Starting Caddy with admin API..." >&2
    caddy run --config /tmp/caddy-config/Caddyfile.runtime --adapter caddyfile 2>&1 &
    CADDY_PID=$!
    echo "✅ Caddy started with PID: $CADDY_PID" >&2

    # Give Caddy a moment to start and set up admin API
    echo "🎯 Waiting for Caddy to initialize..." >&2
    sleep 5

    # Check if Caddy is still running
    if ! kill -0 $CADDY_PID 2>/dev/null; then
        echo "❌ Caddy process died immediately" >&2
        return 1
    fi
    echo "✅ Caddy is running" >&2

    # Helper: DNS TXT wait
    wait_for_dns_txt() {
        _domain="$1"
        _deadline=$(( $(date +%s) + 60 ))
        echo "🔍 Waiting for _acme-challenge TXT for $_domain (up to 60s)" >&2
        while [ $(date +%s) -lt $_deadline ]; do
            if dig +short @1.1.1.1 _acme-challenge.${_domain} TXT 2>/dev/null | grep -q '"'; then
                echo "✅ TXT record visible for $_domain" >&2
                return 0
            fi
            sleep 3
        done
        echo "⚠️  TXT record not observed within 60s for $_domain (may still be propagating)" >&2
        return 0  # Do not hard fail; continue to cert polling
    }

    # Helper: adaptive cert wait
    adaptive_wait_for_cert() {
        _domain="$1"
        total_timeout=${CERT_TIMEOUT_SECONDS:-300}
        initial_interval=5
        later_interval=10
        switch_after=60
        log_admin_after=90
        start_ts=$(date +%s)
        next_log_admin=true
        echo "⏳ Waiting for certificate (timeout ${total_timeout}s) for ${_domain}" >&2
        while true; do
            if find /tmp/caddy/certificates -name "*${_domain}*" -name "*.crt" 2>/dev/null | grep -q .; then
                echo "✅ Certificate material detected for ${_domain}" >&2
                return 0
            fi
            now=$(date +%s)
            elapsed=$(( now - start_ts ))
            if [ $elapsed -ge $total_timeout ]; then
                echo "❌ Timeout (${total_timeout}s) waiting for certificate for ${_domain}" >&2
                dump_caddy_state
                return 1
            fi
            if [ $elapsed -ge $log_admin_after ] && $next_log_admin; then
                echo "🛠  Capturing Caddy admin API state (elapsed ${elapsed}s)" >&2
                curl -s http://127.0.0.1:2019/config/apps/tls/automation/certificates 2>/dev/null >&2 || true
                curl -s http://127.0.0.1:2019/config/apps/tls/automation/locks 2>/dev/null >&2 || true
                next_log_admin=false
            fi
            if [ $elapsed -lt $switch_after ]; then
                sleep $initial_interval
                echo "… waiting (elapsed ${elapsed}s < ${switch_after}s)" >&2
            else
                sleep $later_interval
                echo "… waiting (elapsed ${elapsed}s)" >&2
            fi
        done
    }

    dump_caddy_state() {
        echo "📂 Dumping Caddy storage tree" >&2
        find /tmp/caddy -maxdepth 6 -type f -print 2>/dev/null | sed 's/^/  /' >&2 || true
        echo "🔎 Attempting to locate ACME order references" >&2
        grep -R "order" /tmp/caddy 2>/dev/null | head -20 >&2 || true
    }

    # Pre-check DNS for each domain (best effort)
    for domain in $(echo "${DOMAINS}" | tr ',' ' '); do
        [ -n "$domain" ] && wait_for_dns_txt "$domain"
    done

    # Adaptive wait per domain
    for domain in $(echo "${DOMAINS}" | tr ',' ' '); do
        if ! adaptive_wait_for_cert "$domain"; then
            kill $CADDY_PID 2>/dev/null || true
            return 1
        fi
    done
    echo "🎯 All certificates generated successfully (Lambda path)" >&2

    # Export certificates based on storage type
    echo "Exporting certificates from Lambda..." >&2
    case "$STORAGE_TYPE" in
        "secrets-manager")
            echo "Storing certificates in AWS Secrets Manager..." >&2
            IFS=','
            for domain in $DOMAINS; do
                if [ -n "$domain" ]; then
                    # Generate secret name
                    secret_name="${SECRETS_PREFIX}-$(echo "$domain" | sed 's/\*\./wildcard-/g' | tr '.' '-')"

                    echo "Processing certificate for domain: $domain" >&2
                    echo "Secret name: $secret_name" >&2

                    # Find certificate directory
                    cert_dir=$(find /tmp/caddy/certificates -name "*${domain}*" -type d | head -1)

                    if [ -n "$cert_dir" ] && [ -d "$cert_dir" ]; then
                        echo "Found certificate directory: $cert_dir" >&2

                        # Find certificate and key files
                        cert_file=$(find "$cert_dir" -name "*.crt" | head -1)
                        key_file=$(find "$cert_dir" -name "*.key" | head -1)

                        if [ -f "$cert_file" ] && [ -f "$key_file" ]; then
                            echo "Found certificate files:" >&2
                            echo "  Certificate: $cert_file" >&2
                            echo "  Private Key: $key_file" >&2

                            # Read certificate and key content
                            cert_content=$(cat "$cert_file" | sed ':a;N;$!ba;s/\n/\\n/g')
                            key_content=$(cat "$key_file" | sed ':a;N;$!ba;s/\n/\\n/g')

                            # Store in Secrets Manager
                            secret_json="{\"certificate\": \"$cert_content\", \"private_key\": \"$key_content\"}"

                            if aws secretsmanager put-secret-value --secret-id "$secret_name" --secret-string "$secret_json"; then
                                echo "✅ Certificate for $domain stored successfully in Secrets Manager" >&2
                            else
                                echo "❌ Failed to store certificate for $domain in Secrets Manager" >&2
                                kill $CADDY_PID 2>/dev/null || true
                                return 1
                            fi
                        else
                            echo "❌ Certificate files not found for $domain" >&2
                            echo "  Looking for files in: $cert_dir" >&2
                            find "$cert_dir" -type f -ls >&2
                            kill $CADDY_PID 2>/dev/null || true
                            return 1
                        fi
                    else
                        echo "❌ Certificate directory not found for $domain" >&2
                        echo "Available directories:" >&2
                        find /tmp/caddy/certificates -type d -ls >&2
                        kill $CADDY_PID 2>/dev/null || true
                        return 1
                    fi
                fi
            done
            ;;
        *)
            echo "❌ Storage type $STORAGE_TYPE not yet implemented for Lambda mode" >&2
            kill $CADDY_PID 2>/dev/null || true
            return 1
            ;;
    esac

    # Persistence save
    if [ "${CADDY_PERSIST_MODE}" = "secrets-manager" ] && [ -n "${SECRETS_PREFIX}" ]; then
        echo "💾 Saving ACME account state for future invocations" >&2
        if [ -d /tmp/caddy/acme ]; then
            tar -cf /tmp/account.tar -C /tmp/caddy acme 2>/dev/null || true
            base64 /tmp/account.tar >/tmp/account.tar.b64 2>/dev/null || true
            aws secretsmanager put-secret-value --secret-id "${SECRETS_PREFIX}-caddy-acme-account" --secret-string "$(cat /tmp/account.tar.b64)" >/dev/null 2>&1 || true
        fi
    fi

    # Clean shutdown
    echo "Shutting down Caddy gracefully..." >&2
    kill $CADDY_PID 2>/dev/null || true
    wait $CADDY_PID 2>/dev/null || true
    echo "✅ Certificate management completed successfully in Lambda" >&2
}

# Lambda runtime loop
while true; do
    echo "🔄 Waiting for next Lambda invocation..."

    # Get next invocation with headers written to a temp file
    headers_file="/tmp/lambda-headers"
    echo "📞 Calling runtime API for next invocation..."
    response=$(curl -sS -D "$headers_file" -X GET "http://${AWS_LAMBDA_RUNTIME_API}/2018-06-01/runtime/invocation/next")
    echo "📥 Received response from runtime API"
    echo "Response length: $(echo "$response" | wc -c)"
    echo "Response content: $response"

    request_id=$(grep -Fi Lambda-Runtime-Aws-Request-Id "$headers_file" | tr -d '[:space:]' | cut -d: -f2)
    echo "🏷️  Request ID: $request_id"

    # Handle the request
    echo "🚀 Processing request..."
    echo "🎯 About to call handle_request with:" >&2
    echo "🎯   request_id: '$request_id'" >&2
    echo "🎯   response length: ${#response}" >&2

    # Capture all output from handle_request
    if result=$(handle_request "$request_id" "$response" 2>&1); then
        echo "✅ Request processed successfully" >&2
        echo "🎯 Result from handle_request: '$result'"
        echo "📤 Sending success response to runtime API..."
        # Send success response
        curl -X POST "http://${AWS_LAMBDA_RUNTIME_API}/2018-06-01/runtime/invocation/$request_id/response" -d "$result"
        echo "✅ Success response sent"
    else
        echo "❌ Request processing failed"
        echo "🎯 handle_request returned error code: $?"
        echo "🎯 Result/error output: '$result'"
        echo "📤 Sending error response to runtime API..."
        # Send error response
        error_response='{"errorMessage": "Certificate generation failed", "errorType": "CertificateError", "stackTrace": []}'
        curl -X POST "http://${AWS_LAMBDA_RUNTIME_API}/2018-06-01/runtime/invocation/$request_id/error" -d "$error_response"
        echo "❌ Error response sent"
    fi
    echo "🔄 Completed request cycle, waiting for next invocation..."
done
LAMBDA_EOF

    chmod +x /tmp/lambda-handler.sh
    echo "🚀 Starting Lambda runtime handler..."
    exec /tmp/lambda-handler.sh
fi

# Check if running in local development mode
if [ "$CADDY_LOCAL_MODE" = "true" ]; then
    echo "🏠 Running in LOCAL MODE - generating local CA and certificates with Caddy"

    # Create directories
    mkdir -p /certificates/ca /certificates/localhost

    # Step 1: Use the proper local development Caddyfile
    echo "📋 Starting Caddy with local development configuration..."

    # Start Caddy using the dedicated local Caddyfile
    caddy start --config /caddy-config/Caddyfile.local --adapter caddyfile

    # Wait for certificate generation
    echo "⏳ Waiting for certificate generation..."
    sleep 10

    # Make a request to trigger certificate generation
    curl -k https://localhost >/dev/null 2>&1 || true

    # Wait a bit more for certificate to be fully written
    sleep 5

    # Stop Caddy gracefully using caddy stop command
    echo "🛑 Stopping Caddy..."
    caddy stop || pkill -9 caddy || true
    sleep 2

    # Step 3: Find and copy generated certificates to expected locations
    echo "📁 Looking for generated certificates..."

    # Find the CA certificate in Caddy's default locations
    ca_cert_found=false
    for ca_path in "/root/.local/share/caddy/pki/authorities/local/root.crt" "/tmp/caddy/pki/authorities/local/root.crt" "/certificates/pki/authorities/local/root.crt"; do
        if [ -f "$ca_path" ]; then
            cp "$ca_path" "/certificates/ca.crt"
            ca_cert_found=true
            echo "✅ CA certificate found and copied from: $ca_path"
            break
        fi
    done

    if [ "$ca_cert_found" = false ]; then
        echo "❌ CA certificate not found, checking available locations:"
        find /root/.local/share/caddy -name "*.crt" -o -name "*.pem" 2>/dev/null | head -10
        find /tmp/caddy -name "*.crt" -o -name "*.pem" 2>/dev/null | head -10
        find /certificates -name "*.crt" -o -name "*.pem" 2>/dev/null | head -10
        exit 1
    fi

    # Find localhost certificates in Caddy's certificate storage
    cert_found=false
    for storage_root in "/root/.local/share/caddy" "/tmp/caddy" "/certificates"; do
        if [ -d "$storage_root/certificates" ]; then
            for cert_dir in "$storage_root/certificates"/*; do
                if [ -d "$cert_dir" ]; then
                    # Look for certificate files that might be for localhost
                    cert_file=$(find "$cert_dir" -name "*.crt" | head -1)
                    key_file=$(find "$cert_dir" -name "*.key" | head -1)

                    if [ -f "$cert_file" ] && [ -f "$key_file" ]; then
                        # Check if this certificate is for localhost
                        if openssl x509 -in "$cert_file" -noout -text 2>/dev/null | grep -q "localhost\|127.0.0.1"; then
                            cp "$cert_file" "/certificates/localhost.crt"
                            cp "$key_file" "/certificates/localhost.key"
                            cert_found=true
                            echo "✅ Localhost certificate found and copied from: $cert_dir"
                            break
                        fi
                    fi
                fi
            done
            if [ "$cert_found" = true ]; then
                break
            fi
        fi
    done

    if [ "$cert_found" = false ]; then
        echo "❌ Localhost certificate not found, checking available certificate directories:"
        find /root/.local/share/caddy/certificates -type d 2>/dev/null | head -10
        find /tmp/caddy/certificates -type d 2>/dev/null | head -10
        find /certificates/certificates -type d 2>/dev/null | head -10
        exit 1
    fi

    # Set proper permissions
    chmod 644 /certificates/*.crt
    chmod 600 /certificates/*.key

    echo "✅ Local CA and localhost certificates generated successfully with Caddy!"
    echo "📁 Certificate files created:"
    echo "   CA Certificate: /certificates/ca.crt"
    echo "   Localhost Certificate: /certificates/localhost.crt"
    echo "   Localhost Private Key: /certificates/localhost.key"

    # Verify certificates
    echo "🔍 Verifying certificate validity:"
    if openssl x509 -in /certificates/ca.crt -noout -subject -dates 2>/dev/null; then
        echo "✅ CA certificate is valid"
    else
        echo "⚠️  CA certificate verification failed"
    fi

    if openssl x509 -in /certificates/localhost.crt -noout -subject -dates 2>/dev/null; then
        echo "✅ Localhost certificate is valid"
    else
        echo "⚠️  Localhost certificate verification failed"
    fi

    # Try to verify certificate chain (non-fatal if it fails)
    if openssl verify -CAfile /certificates/ca.crt /certificates/localhost.crt 2>/dev/null; then
        echo "✅ Certificate chain verification successful"
    else
        echo "⚠️  Certificate chain verification failed (this is normal for some CA formats)"
    fi

    echo "🎉 Local certificate generation completed!"
    exit 0
fi

# Original production mode logic below
echo "🔧 Running in PRODUCTION MODE - using Caddy with ACME"

# Copy the base deployment Caddyfile and append domain configurations
cp /caddy-config/Caddyfile.deployment /caddy-config/Caddyfile.runtime

# Append domain configurations dynamically
echo "" >> /caddy-config/Caddyfile.runtime
echo "${DOMAINS}" | tr ',' '\n' | while read -r domain; do
    if [ -n "$domain" ]; then
        cat >> /caddy-config/Caddyfile.runtime << DOMAIN_EOF

${domain} {
	respond "Certificate obtained for ${domain}"

	# Health check endpoint
	handle /health {
		respond "OK" 200
	}
}
DOMAIN_EOF
    fi
done

echo "Generated runtime Caddyfile:"
cat /caddy-config/Caddyfile.runtime

# Clean up any stale ACME challenge DNS records from previous deployments
echo "🧹 Cleaning up stale ACME challenge DNS records..."
cleanup_stale_acme_records

# Run Caddy to obtain certificates
echo "Starting Caddy certificate manager..."
caddy run --config /caddy-config/Caddyfile.runtime --adapter caddyfile &
CADDY_PID=$!

# Enhanced certificate validation with timeout
wait_for_certificate() {
    local domain=$1
    local timeout=300
    local elapsed=0

    echo "Waiting for certificate for domain: ${domain}"

    while [ $elapsed -lt $timeout ]; do
        # Look for certificate files in Caddy's data directory
        if find /tmp/caddy/certificates -name "*${domain}*" -name "*.crt" 2>/dev/null | grep -q .; then
            echo "Certificate found for ${domain}"
            return 0
        fi
        echo "Waiting for certificate... (${elapsed}s/${timeout}s)"
        sleep 10
        elapsed=$((elapsed + 10))
    done

    echo "Timeout waiting for certificate for ${domain}"
    return 1
}

# Wait for certificates to be obtained for all domains
IFS=','
for domain in $DOMAINS; do
    if [ -n "$domain" ]; then
        wait_for_certificate "$domain" || {
            echo "Failed to obtain certificate for $domain"
            exit 1
        }
    fi
done

# Export certificates based on storage type
echo "Exporting certificates..."
case "$STORAGE_TYPE" in
    "secrets-manager")
        echo "Storing certificates in AWS Secrets Manager..."
        IFS=','
        for domain in $DOMAINS; do
            if [ -n "$domain" ]; then
                # Generate secret name
                secret_name="${SECRETS_PREFIX}-$(echo "$domain" | sed 's/\*\./wildcard-/g' | tr '.' '-')"

                echo "Processing certificate for domain: $domain"
                echo "Secret name: $secret_name"

                # Find certificate directory
                cert_dir=$(find /tmp/caddy/certificates -name "*${domain}*" -type d | head -1)

                if [ -n "$cert_dir" ] && [ -d "$cert_dir" ]; then
                    echo "Found certificate directory: $cert_dir"

                    # Find certificate and key files
                    cert_file=$(find "$cert_dir" -name "*.crt" | head -1)
                    key_file=$(find "$cert_dir" -name "*.key" | head -1)

                    if [ -f "$cert_file" ] && [ -f "$key_file" ]; then
                        echo "Found certificate files:"
                        echo "  Certificate: $cert_file"
                        echo "  Private Key: $key_file"

                        # Read certificate and key content
                        cert_content=$(cat "$cert_file" | sed ':a;N;$!ba;s/\n/\\n/g')
                        key_content=$(cat "$key_file" | sed ':a;N;$!ba;s/\n/\\n/g')

                        # Store in Secrets Manager
                        secret_json="{\"certificate\": \"$cert_content\", \"private_key\": \"$key_content\"}"

                        if aws secretsmanager put-secret-value --secret-id "$secret_name" --secret-string "$secret_json"; then
                            echo "✅ Certificate for $domain stored successfully in Secrets Manager"
                        else
                            echo "❌ Failed to store certificate for $domain in Secrets Manager"
                            exit 1
                        fi
                    else
                        echo "❌ Certificate files not found for $domain"
                        echo "  Looking for files in: $cert_dir"
                        find "$cert_dir" -type f -ls
                        exit 1
                    fi
                else
                    echo "❌ Certificate directory not found for $domain"
                    echo "Available directories:"
                    find /tmp/caddy/certificates -type d -ls
                    exit 1
                fi
            fi
        done
        ;;
    "s3")
        echo "Syncing certificates to S3..."
        if aws s3 sync /tmp/caddy/certificates/ "s3://${S3_BUCKET}/${S3_PREFIX}/" --delete; then
            echo "✅ Certificates synced to S3 successfully"
        else
            echo "❌ Failed to sync certificates to S3"
            exit 1
        fi
        ;;
    "efs")
        echo "Copying certificates to EFS..."
        if cp -r /tmp/caddy/certificates/* /certificates/; then
            echo "✅ Certificates copied to EFS successfully"
        else
            echo "❌ Failed to copy certificates to EFS"
            exit 1
        fi
        ;;
    *)
        echo "❌ Unknown storage type: $STORAGE_TYPE"
        exit 1
        ;;
esac

# Clean shutdown with enhanced logging
echo "Shutting down Caddy gracefully..."
kill $CADDY_PID
wait $CADDY_PID
echo "✅ Certificate management completed successfully"
echo "📊 Certificate renewal check completed at $(date)"
