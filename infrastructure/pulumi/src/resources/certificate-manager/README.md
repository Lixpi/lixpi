# Caddy Certificate Management

Previously considered https://certbot.eff.org/pages/about but for some reason decided to go with Caddy.

## Lambda Issuance Flow (Updated)

1. Restore persisted ACME account (optional, Secrets Manager) to reduce cold issuance latency.
2. Generate runtime Caddyfile (domains appended dynamically).
3. Start Caddy with Route53 DNS provider (auto DNS-01 challenges).
4. (Best-effort) Poll public DNS for `_acme-challenge.<domain>` TXT visibility (up to 60s) to differentiate record propagation vs. ACME pending.
5. Adaptive certificate wait loop per domain:
   - Poll every 5s for first 60s, then every 10s until timeout (default 300s).
   - After 90s, capture Caddy admin API internal automation state for diagnostics.
6. On success: export cert + key to Secrets Manager per domain and (if enabled) persist ACME account tarball.
7. On timeout: dump storage tree + partial ACME order traces for debugging before failing invocation.

## Environment Variables (Key)

| Variable | Purpose | Default |
|----------|---------|---------|
| DOMAINS | Comma-separated list of FQDNs | (required) |
| CADDY_EMAIL | ACME account email | (required) |
| STORAGE_TYPE | secrets-manager | secrets-manager |
| SECRETS_PREFIX | Prefix for Secrets Manager secrets | caddy-cert |
| AWS_HOSTED_ZONE_ID | Explicit hosted zone for Route53 plugin | auto-detect if empty |
| CADDY_PERSIST_MODE | If 'secrets-manager', persist ACME account | (disabled) |
| CERT_TIMEOUT_SECONDS | Total wait for issuance (Lambda path) | 300 |

## Persistence Strategy

When `CADDY_PERSIST_MODE=secrets-manager` the `/tmp/caddy/acme` directory is archived and base64 stored at `${SECRETS_PREFIX}-caddy-acme-account`. On next cold start it is restored prior to starting Caddy, avoiding repeated new ACME account registration and speeding re-issuance / renewal.

## Diagnostics Added

- DNS TXT presence check (non-fatal) for each domain.
- Admin API snapshots (certificates + locks) if issuance exceeds 90s.
- Storage tree + ACME order grep on timeout.

## Diagram

```
┌──────────────────┐
│ Lambda Invoke    │
└───────┬──────────┘
	   │
	   ▼
   (Optional) Restore ACME account
	   │
	   ▼
   Generate runtime Caddyfile
	   │
	   ▼
	Start Caddy
	   │
	   ▼
  DNS TXT pre-check loop
	   │
	   ▼
 Adaptive cert wait loop
  (poll fs + admin API)
	   │
   ┌─────┴─────┐
   │ Success   │ Timeout
   │           │
   ▼           ▼
 Export &      Dump state + fail
 Persist ACME
```
Also in another article https://medium.com/@slimm609/ssl-for-local-development-43c9d75c7ee2 they talked about using public dns record that points to localhost. That would allow to generate a certificate and use dns challenge while running locally, but it makes the service vendor locked. Idally when running locally we don't want to depend on any specific cloud too much.

In this article instead https://deliciousbrains.com/ssl-certificate-authority-for-local-https-development/ they talked about creating a local Certificate Authority that browser can trust. That sounds reasonable, that's why we decided to go with Caddy. Because it allows to automage a lot of these steps.

Caddy uses Route53 module. https://github.com/caddy-dns/route53?tab=readme-ov-file

## Local Development Certificate Setup

This system uses Caddy to generate a local Certificate Authority (CA) and SSL certificates for development. The certificates are automatically generated when starting the development environment.

### Certificate Installation for Browsers

To avoid TLS handshake errors when connecting to `wss://localhost:9222`, you need to install the local CA certificate in your browser/system.

#### 1. Extract CA Certificate

```bash
# Extract CA certificate from Docker volume
docker run --rm -v lixpi_caddy-certs:/certs busybox cat /certs/ca.crt > ca.crt
```

#### 2. Install Certificate by Operating System

**macOS:**
```bash
# Method 1: Command line (requires admin password)
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ca.crt

# Method 2: Keychain Access GUI
# 1. Open Keychain Access app
# 2. Go to File → Import Items
# 3. Select ca.crt file
# 4. Choose "System" keychain
# 5. Find "Lixpi Local Development CA" certificate
# 6. Double-click → Trust → "Always Trust"
```

**Linux (Ubuntu/Debian):**
```bash
# Copy certificate to trusted directory
sudo cp ca.crt /usr/local/share/ca-certificates/lixpi-local-ca.crt

# Update certificate store
sudo update-ca-certificates

# For Firefox (uses its own certificate store)
# Go to Preferences → Privacy & Security → Certificates → View Certificates
# Authorities → Import → Select ca.crt → Trust for websites
```

**Windows:**
```bash
# Method 1: Command line (run as Administrator)
certlm.msc
# Import ca.crt into "Trusted Root Certification Authorities"

# Method 2: PowerShell (run as Administrator)
Import-Certificate -FilePath "ca.crt" -CertStoreLocation Cert:\LocalMachine\Root
```

#### 3. Browser-Specific Instructions

**Chrome/Edge:**
- Restart browser after system certificate installation
- Certificate should be automatically trusted

**Firefox:**
- Go to `about:preferences#privacy`
- Scroll to "Certificates" → "View Certificates"
- Click "Authorities" tab → "Import"
- Select `ca.crt` → Check "Trust this CA to identify websites"

**Safari:**
- Uses macOS system certificates automatically
- Restart Safari after installing via Keychain Access

#### 4. Alternative: Download via Browser

If you have the web-ui running, you can download the certificate directly:
```
http://localhost:3001/certs/ca.crt
```

### Verification

After installation, verify the certificate is trusted:

```bash
# Test the WebSocket connection
openssl s_client -connect localhost:9222 -servername localhost -verify_return_error -CAfile ca.crt

# Should show "Verify return code: 0 (ok)"
```

## Architecture

### Local Development Mode
- Uses Caddy's internal PKI to generate local CA
- Creates localhost certificates signed by the local CA
- Serves certificates via shared Docker volume

### Production Mode
- Uses Let's Encrypt ACME with Route53 DNS validation
- Stores certificates in AWS Secrets Manager
- Automatic renewal every 30 days

## Configuration

### Environment Variables

- `CADDY_LOCAL_MODE`: Set to "true" for local development
- `DOMAINS`: Comma-separated list of domains for certificates
- `CADDY_EMAIL`: Email for Let's Encrypt registration
- `CERTIFICATE_VALIDATION_EMAIL`: Fallback email configuration

### Certificate Storage

**Local Development:**
- Storage: Docker volume `caddy-certs`
- CA Certificate: `/certificates/ca.crt`
- Server Certificate: `/certificates/localhost.crt`
- Private Key: `/certificates/localhost.key`

**Production:**
- Storage: AWS Secrets Manager
- Format: JSON with `certificate` and `private_key` fields
