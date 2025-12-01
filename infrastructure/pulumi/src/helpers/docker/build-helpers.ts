'use strict'

import * as pulumi from '@pulumi/pulumi'
import * as aws from '@pulumi/aws'
import * as dockerBuild from '@pulumi/docker-build'

export type DockerImageBuildConfig = {
    imageName: string
    dockerBuildContext: string
    dockerfilePath: string
    platforms?: string[]
    buildArgs?: { [key: string]: string }
    push?: boolean
    buildOnPreview?: boolean
    noCache?: boolean
    additionalTags?: pulumi.Input<string>[]
    cache?: {
        from?: dockerBuild.types.input.CacheFrom[]
        to?: dockerBuild.types.input.CacheTo[]
    }
    exports?: dockerBuild.types.input.Export[]
    dependencies?: pulumi.Resource[]
    target?: string
    network?: string
    addHosts?: string[]
    secrets?: { [key: string]: pulumi.Input<string> }
}

export type ECRRepositoryConfig = {
    name: string
    enableImageScanning?: boolean
    imageTagMutability?: 'MUTABLE' | 'IMMUTABLE'
    forceDelete?: boolean
    tags?: { [key: string]: string }
}

export type DockerImageBuildResult = {
    repository: aws.ecr.Repository
    image: dockerBuild.Image
    imageRef: pulumi.Output<string>
    repositoryUrl: pulumi.Output<string>
    imageTag: string
}

export type DockerImageLocalResult = {
    image: dockerBuild.Image
    imageTag: string
}

export const createECRRepository = (config: ECRRepositoryConfig): aws.ecr.Repository => {
    const {
        name,
        enableImageScanning = true,
        imageTagMutability = 'MUTABLE',
        forceDelete = true,
        tags = {},
    } = config

    return new aws.ecr.Repository(`${name}-repo`, {
        name: name.toLowerCase(),
        imageScanningConfiguration: {
            scanOnPush: enableImageScanning,
        },
        imageTagMutability,
        forceDelete,
        tags,
    })
}

export const buildDockerImage = (config: DockerImageBuildConfig & {
    repository?: aws.ecr.Repository
}): DockerImageBuildResult | { image: dockerBuild.Image; imageTag: string } => {
    const {
        imageName,
        dockerBuildContext,
        dockerfilePath,
        platforms = ['linux/amd64'],
        buildArgs,
        push = false,
        buildOnPreview = true,
        noCache = true,
        additionalTags = [],
        cache,
        exports,
        dependencies = [],
        target,
        network,
        addHosts,
        secrets,
        repository: existingRepository,
    } = config

    const repository = existingRepository || (push ? createECRRepository({ name: imageName }) : undefined)
    const imageTag = `${Date.now()}`

    const tags: pulumi.Input<string>[] = repository
        ? [
            pulumi.interpolate`${repository.repositoryUrl}:${imageTag}`,
            pulumi.interpolate`${repository.repositoryUrl}:latest`,
            ...additionalTags,
        ]
        : [
            `${imageName}:latest`.toLowerCase(),
            ...additionalTags,
        ]

    const authToken = repository ? aws.ecr.getAuthorizationTokenOutput({
        registryId: repository.registryId,
    }) : undefined

    const image = new dockerBuild.Image(`${imageName}-image-${imageTag}`, {
        context: {
            location: dockerBuildContext,
        },
        dockerfile: {
            location: dockerfilePath,
        },
        platforms,
        tags,
        push,
        buildOnPreview,
        noCache,
        ...(buildArgs && { buildArgs }),
        ...(target && { target }),
        ...(network && { network }),
        ...(addHosts && { addHosts }),
        ...(secrets && { secrets }),
        ...(cache?.from && { cacheFrom: cache.from }),
        ...(cache?.to && { cacheTo: cache.to }),
        ...(exports && { exports }),
        ...(push && authToken && {
            registries: [{
                address: repository!.repositoryUrl,
                username: authToken.userName,
                password: authToken.password,
            }]
        }),
    }, {
        replaceOnChanges: ['*'],
        dependsOn: repository ? [repository, ...dependencies] : dependencies,
    })

    if (repository) {
        return {
            repository,
            image,
            imageRef: pulumi.interpolate`${repository.repositoryUrl}:${imageTag}`,
            repositoryUrl: repository.repositoryUrl,
            imageTag,
        }
    }

    return {
        image,
        imageTag: `${imageName}:latest`.toLowerCase(),
    }
}
