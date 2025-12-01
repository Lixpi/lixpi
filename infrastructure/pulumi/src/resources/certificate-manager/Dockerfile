FROM caddy:2.10-builder-alpine

# Install required packages (add bind-tools for dig + tar for persistence)
RUN apk add --no-cache aws-cli curl jq go git openssl bind-tools tar gzip

# Build xcaddy and use it to build caddy with route53 module explicitly
RUN go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
ENV PATH=$PATH:/root/go/bin
RUN xcaddy build --with github.com/caddy-dns/route53
RUN mv caddy /usr/bin/caddy && chmod +x /usr/bin/caddy

# Create necessary directories
RUN mkdir -p /certificates /caddy-config

# Copy the certificate management script and Caddyfiles
COPY cert-manager.sh /usr/local/bin/cert-manager.sh
COPY Caddyfile.local /caddy-config/Caddyfile.local
COPY Caddyfile.deployment /caddy-config/Caddyfile.deployment
RUN chmod +x /usr/local/bin/cert-manager.sh

# Support for Lambda runtime
# When running in Lambda, the cert-manager.sh script will detect AWS_LAMBDA_RUNTIME_API
# and switch to Lambda mode automatically
CMD ["/usr/local/bin/cert-manager.sh"]

# Set the entrypoint (kept for backwards compatibility with ECS)
ENTRYPOINT ["/usr/local/bin/cert-manager.sh"]
