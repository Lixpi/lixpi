# Docker Build Helpers

Reusable function for building Docker images in Pulumi using the modern `@pulumi/docker-build` provider.

## Overview

This module provides a consistent, type-safe API for building Docker images across the application. It enforces the use of the modern `@pulumi/docker-build` provider which leverages BuildKit for advanced features like:

- **Multi-platform builds** (linux/amd64, linux/arm64, etc.)
- **Advanced caching** (registry, inline, S3, GitHub Actions, etc.)
- **Build secrets** with first-class Pulumi secrets support
- **Multiple export types** (registry, Docker daemon, tar, OCI layout)
- **Docker Build Cloud** support

## Core Function

### `buildDockerImage()`

Single function that handles all Docker image building scenarios. Use `push: true` for ECR/registry images, `push: false` for local builds.

**For ECR/Registry (ECS, Lambda, etc.):**
```typescript
import { buildDockerImage } from './helpers/docker/index.ts'

const { repository, image, imageRef, repositoryUrl } = buildDockerImage({
    imageName: 'my-api-service',
    dockerBuildContext: '/path/to/build/context',
    dockerfilePath: '/path/to/Dockerfile',
    platforms: ['linux/amd64'],
    push: true,
    buildArgs: {
        NODE_ENV: 'production',
    },
    cache: {
        from: [{ registry: { ref: pulumi.interpolate`${repositoryUrl}:latest` } }],
        to: [{ inline: {} }]
    }
}) as DockerImageBuildResult

// Use in ECS task definition
const taskDefinition = new aws.ecs.TaskDefinition('my-task', {
    containerDefinitions: pulumi.jsonStringify([{
        name: 'my-container',
        image: imageRef,
    }])
})

// Use in Lambda function
const lambdaFunction = new aws.lambda.Function('my-function', {
    packageType: 'Image',
    imageUri: imageRef,
})
```

**For Local Builds (no push):**
```typescript
import { buildDockerImage } from './helpers/docker/index.ts'

const { image, imageTag } = buildDockerImage({
    imageName: 'web-ui-builder',
    dockerBuildContext: '/path/to/web-ui',
    dockerfilePath: '/path/to/web-ui/Dockerfile',
    push: false,
    buildArgs: {
        VITE_API_URL: 'https://api.example.com',
    },
    exports: [{
        docker: { names: ['web-ui-builder:latest'] }
    }]
}) as { image: dockerBuild.Image; imageTag: string }
```

### `createECRRepository()`

Low-level function to create just an ECR repository without building an image.

```typescript
import { createECRRepository } from './helpers/docker/index.ts'

const repository = createECRRepository({
    name: 'my-custom-repo',
    enableImageScanning: true,
    imageTagMutability: 'MUTABLE',
    forceDelete: true,
})
```

## Configuration Options

### Common Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `imageName` | `string` | **required** | Unique name for the image resource |
| `dockerBuildContext` | `string` | **required** | Path to Docker build context |
| `dockerfilePath` | `string` | **required** | Path to Dockerfile |
| `platforms` | `string[]` | `['linux/amd64']` | Target platforms |
| `buildArgs` | `object` | `undefined` | Build-time variables |
| `push` | `boolean` | `true` | Whether to push to registry |
| `buildOnPreview` | `boolean` | `true` | Build during `pulumi preview` |
| `noCache` | `boolean` | `true` | Disable build cache |
| `additionalTags` | `string[]` | `[]` | Extra image tags |
| `dependencies` | `Resource[]` | `[]` | Pulumi resource dependencies |

### Advanced Options

| Option | Type | Description |
|--------|------|-------------|
| `cache.from` | `CacheFrom[]` | Cache sources (registry, local, s3, gha) |
| `cache.to` | `CacheTo[]` | Cache destinations |
| `target` | `string` | Target stage in multi-stage build |
| `network` | `string` | Network mode for build |
| `addHosts` | `string[]` | Additional host mappings |
| `secrets` | `object` | Build secrets (secure!) |
| `exports` | `Export[]` | Export targets (docker, oci, tar) |

## Caching Strategies

### Inline Cache (Recommended for Most Cases)

Embeds cache metadata in the pushed image itself:

```typescript
cache: {
    from: [{
        registry: {
            ref: pulumi.interpolate`${repositoryUrl}:latest`
        }
    }],
    to: [{ inline: {} }]
}
```

**Pros:** Simple, no extra storage needed
**Cons:** Increases image size slightly

### Registry Cache (Best for CI/CD)

Stores cache in a separate registry tag:

```typescript
cache: {
    from: [{
        registry: {
            ref: pulumi.interpolate`${repositoryUrl}:buildcache`
        }
    }],
    to: [{
        registry: {
            ref: pulumi.interpolate`${repositoryUrl}:buildcache`,
            mode: 'max' // max = cache all layers
        }
    }]
}
```

**Pros:** Doesn't bloat production images, faster
**Cons:** Requires separate cache management

### S3 Cache (Best for Large Teams)

Stores cache in S3 bucket:

```typescript
cache: {
    from: [{
        s3: {
            bucket: 's3://my-build-cache-bucket',
            region: 'us-east-1'
        }
    }],
    to: [{
        s3: {
            bucket: 's3://my-build-cache-bucket',
            region: 'us-east-1',
            mode: 'max'
        }
    }]
}
```

**Pros:** Shared across entire organization, fast
**Cons:** Requires S3 bucket setup and IAM permissions

## Multi-Platform Builds

Build images for multiple architectures:

```typescript
buildDockerImage({
    imageName: 'my-service',
    dockerBuildContext: './app',
    dockerfilePath: './app/Dockerfile',
    push: true,
    platforms: [
        'linux/amd64',  // Intel/AMD x86_64
        'linux/arm64',  // ARM (Graviton, Apple Silicon)
    ]
})
```

**Note:** Multi-platform builds require:
1. Base images that support all platforms
2. Any compiled binaries must be cross-compiled or built per-platform
3. BuildKit with QEMU emulation (enabled by default in Docker Desktop)

## Build Secrets

Securely pass secrets to Docker builds using Pulumi's secret management:

```typescript
const apiKey = pulumi.secret('my-secret-api-key')

buildDockerImage({
    imageName: 'my-service',
    dockerBuildContext: './app',
    dockerfilePath: './app/Dockerfile',
    push: true,
    secrets: {
        API_KEY: apiKey
    }
})
```

In your Dockerfile:
```dockerfile
# syntax=docker/dockerfile:1
FROM node:20

# Mount secret (won't be in final image)
RUN --mount=type=secret,id=API_KEY \
    API_KEY=$(cat /run/secrets/API_KEY) && \
    npm install --token=$API_KEY
```

## Migration Guide

### From Legacy Pattern to Helper Function

**Before:**
```typescript
const repository = new aws.ecr.Repository(`${serviceName}-repo`, {
    name: serviceName.toLowerCase(),
    imageScanningConfiguration: { scanOnPush: true },
    imageTagMutability: 'MUTABLE',
    forceDelete: true,
})

const imageTag = `${Date.now()}`
const image = new dockerBuild.Image(`${serviceName}-image-${imageTag}`, {
    context: { location: dockerBuildContext },
    dockerfile: { location: dockerfilePath },
    platforms: ['linux/amd64'],
    tags: [
        pulumi.interpolate`${repository.repositoryUrl}:${imageTag}`,
        pulumi.interpolate`${repository.repositoryUrl}:latest`
    ],
    push: true,
    registries: [{
        address: repository.repositoryUrl,
        username: aws.ecr.getAuthorizationTokenOutput({}).userName,
        password: aws.ecr.getAuthorizationTokenOutput({}).password,
    }],
    buildOnPreview: true,
    noCache: true,
}, {
    replaceOnChanges: ['*'],
    dependsOn: [repository],
})
```

**After:**
```typescript
import { buildDockerImage } from './helpers/docker/index.ts'

const { repository, image, imageRef, repositoryUrl } = buildDockerImage({
    imageName: serviceName,
    dockerBuildContext,
    dockerfilePath,
    push: true,
}) as DockerImageBuildResult
```

## Best Practices

1. **Use `push: true` for ECR images:** ECS and Lambda require images in ECR

2. **Use `push: false` for local builds:** Build containers that don't need registry storage

3. **Use appropriate cache strategy:** Inline cache for simple cases, registry cache for CI/CD

4. **Leverage multi-platform when needed:** But only when you actually need ARM support (costs more build time)

5. **Use build secrets properly:** Never hardcode secrets in Dockerfiles or build args

6. **Set dependencies correctly:** Ensure certificate managers, secrets, etc. are created before building

## Troubleshooting

### Build fails with "failed to solve with frontend dockerfile.v0"

**Solution:** Check your Dockerfile syntax and ensure base images exist for all platforms.

### Image pushes fail with authentication errors

**Solution:** Verify AWS credentials and ECR permissions. The helper automatically handles ECR auth.

### Cache not working

**Solution:**
- Verify cache source exists (for `cacheFrom`)
- Use `mode: 'max'` in `cacheTo` to cache all layers
- Check BuildKit version supports your cache type

### Multi-platform builds are slow

**Solution:**
- Use Docker Build Cloud for faster multi-arch builds
- Cache aggressively with registry or S3 cache
- Consider building single platform if ARM not needed

## References

- [Pulumi Docker Build Provider](https://www.pulumi.com/registry/packages/docker-build/)
- [Docker BuildKit Documentation](https://docs.docker.com/build/buildkit/)
- [Docker Build Cache Backends](https://docs.docker.com/build/cache/backends/)
- [AWS ECR Documentation](https://docs.aws.amazon.com/ecr/)
