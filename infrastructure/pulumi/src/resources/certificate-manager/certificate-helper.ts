'use strict'

import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

/**
 * Helper functions for working with Caddy-managed certificates
 */

export interface CertificateHelper {
    /**
     * Gets certificate ARN or path for use in other services
     */
    getCertificateReference(): pulumi.Output<string>

    /**
     * Gets environment variables needed to access certificates
     */
    getCertificateEnvironment(): Array<{ name: string; value: string }>

    /**
     * Creates a script to download certificates for container use
     */
    getCertificateDownloadScript(): string
}

export const createCertificateHelper = (
    domain: string,
    storageType: 'secrets-manager' | 's3' | 'efs',
    storageConfig: {
        secretsManagerPrefix?: string
        s3Bucket?: pulumi.Input<string>
        s3Prefix?: string
        efsFileSystemId?: pulumi.Input<string>
    },
): CertificateHelper => {
    switch (storageType) {
        case 'secrets-manager':
            const secretName = `${storageConfig.secretsManagerPrefix}-${domain.replace(/\*/g, 'wildcard').replace(/\./g, '-')}`

            return {
                getCertificateReference: () => pulumi.output(secretName),

                getCertificateEnvironment: () => [
                    { name: 'CERT_STORAGE_TYPE', value: 'secrets-manager' },
                    { name: 'CERT_SECRET_NAME', value: secretName },
                    { name: 'CERT_DOMAIN', value: domain },
                ],

                getCertificateDownloadScript: () => `
                    # Enhanced certificate download from Secrets Manager with validation
                    echo "🔐 Downloading certificate for ${domain} from Secrets Manager..."

                    # Check if secret exists
                    if ! aws secretsmanager describe-secret --secret-id ${secretName} >/dev/null 2>&1; then
                        echo "❌ Secret ${secretName} not found"
                        return 1
                    fi

                    # Download and validate certificate
                    CERT_SECRET=$(aws secretsmanager get-secret-value --secret-id ${secretName} --query SecretString --output text)
                    if [ -z "$CERT_SECRET" ]; then
                        echo "❌ Failed to retrieve certificate secret"
                        return 1
                    fi

                    # Extract and validate certificate components
                    echo "$CERT_SECRET" | jq -e '.certificate' >/dev/null || {
                        echo "❌ Invalid certificate format in secret"
                        return 1
                    }

                    echo "$CERT_SECRET" | jq -e '.private_key' >/dev/null || {
                        echo "❌ Invalid private key format in secret"
                        return 1
                    }

                    # Create certificate directory if it doesn't exist
                    mkdir -p /etc/ssl/certs /etc/ssl/private

                    # Extract and save certificate files
                    echo "$CERT_SECRET" | jq -r '.certificate' > /etc/ssl/certs/server.crt
                    echo "$CERT_SECRET" | jq -r '.private_key' > /etc/ssl/private/server.key

                    # Set proper permissions
                    chmod 644 /etc/ssl/certs/server.crt
                    chmod 600 /etc/ssl/private/server.key

                    # Validate certificate files
                    if openssl x509 -in /etc/ssl/certs/server.crt -noout 2>/dev/null; then
                        echo "✅ Certificate downloaded and validated successfully"
                        openssl x509 -in /etc/ssl/certs/server.crt -noout -subject -dates
                    else
                        echo "❌ Downloaded certificate is invalid"
                        return 1
                    fi
                `,
            }

        case 's3':
            return {
                getCertificateReference: () => pulumi.interpolate`s3://${storageConfig.s3Bucket}/${storageConfig.s3Prefix || 'certificates'}`,

                getCertificateEnvironment: () => [
                    { name: 'CERT_STORAGE_TYPE', value: 's3' },
                    { name: 'CERT_S3_BUCKET', value: storageConfig.s3Bucket as string },
                    { name: 'CERT_S3_PREFIX', value: storageConfig.s3Prefix || 'certificates' },
                    { name: 'CERT_DOMAIN', value: domain },
                ],

                getCertificateDownloadScript: () => `
                    # Enhanced certificate download from S3 with validation
                    echo "📦 Downloading certificate for ${domain} from S3..."

                    # Check if S3 objects exist
                    if ! aws s3api head-object --bucket \${CERT_S3_BUCKET} --key \${CERT_S3_PREFIX}/${domain}/fullchain.pem >/dev/null 2>&1; then
                        echo "❌ Certificate not found in S3"
                        return 1
                    fi

                    if ! aws s3api head-object --bucket \${CERT_S3_BUCKET} --key \${CERT_S3_PREFIX}/${domain}/privkey.pem >/dev/null 2>&1; then
                        echo "❌ Private key not found in S3"
                        return 1
                    fi

                    # Create certificate directory if it doesn't exist
                    mkdir -p /etc/ssl/certs /etc/ssl/private

                    # Download certificate files
                    aws s3 cp s3://\${CERT_S3_BUCKET}/\${CERT_S3_PREFIX}/${domain}/fullchain.pem /etc/ssl/certs/server.crt || {
                        echo "❌ Failed to download certificate from S3"
                        return 1
                    }

                    aws s3 cp s3://\${CERT_S3_BUCKET}/\${CERT_S3_PREFIX}/${domain}/privkey.pem /etc/ssl/private/server.key || {
                        echo "❌ Failed to download private key from S3"
                        return 1
                    }

                    # Set proper permissions
                    chmod 644 /etc/ssl/certs/server.crt
                    chmod 600 /etc/ssl/private/server.key

                    # Validate certificate files
                    if openssl x509 -in /etc/ssl/certs/server.crt -noout 2>/dev/null; then
                        echo "✅ Certificate downloaded and validated successfully"
                        openssl x509 -in /etc/ssl/certs/server.crt -noout -subject -dates
                    else
                        echo "❌ Downloaded certificate is invalid"
                        return 1
                    fi
                `,
            }

        case 'efs':
            return {
                getCertificateReference: () => pulumi.interpolate`efs://${storageConfig.efsFileSystemId}/certificates`,

                getCertificateEnvironment: () => [
                    { name: 'CERT_STORAGE_TYPE', value: 'efs' },
                    { name: 'CERT_EFS_PATH', value: '/certificates' },
                    { name: 'CERT_DOMAIN', value: domain },
                ],

                getCertificateDownloadScript: () => `
                    # Enhanced certificate copy from EFS with validation
                    echo "📁 Copying certificate for ${domain} from EFS..."

                    # Check if certificate files exist in EFS
                    if [ ! -f "/certificates/${domain}/fullchain.pem" ]; then
                        echo "❌ Certificate not found in EFS: /certificates/${domain}/fullchain.pem"
                        return 1
                    fi

                    if [ ! -f "/certificates/${domain}/privkey.pem" ]; then
                        echo "❌ Private key not found in EFS: /certificates/${domain}/privkey.pem"
                        return 1
                    fi

                    # Create certificate directory if it doesn't exist
                    mkdir -p /etc/ssl/certs /etc/ssl/private

                    # Copy certificate files
                    cp /certificates/${domain}/fullchain.pem /etc/ssl/certs/server.crt || {
                        echo "❌ Failed to copy certificate from EFS"
                        return 1
                    }

                    cp /certificates/${domain}/privkey.pem /etc/ssl/private/server.key || {
                        echo "❌ Failed to copy private key from EFS"
                        return 1
                    }

                    # Set proper permissions
                    chmod 644 /etc/ssl/certs/server.crt
                    chmod 600 /etc/ssl/private/server.key

                    # Validate certificate files
                    if openssl x509 -in /etc/ssl/certs/server.crt -noout 2>/dev/null; then
                        echo "✅ Certificate copied and validated successfully"
                        openssl x509 -in /etc/ssl/certs/server.crt -noout -subject -dates
                    else
                        echo "❌ Copied certificate is invalid"
                        return 1
                    fi
                `,
            }
    }
}
