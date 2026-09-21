import {
    type VersionCatalog,
} from '../shared/version-catalog.ts'

const imageRepository = (reference: string): string => {
    const withoutDigest = reference.split('@')[0]
    const lastSlash = withoutDigest.lastIndexOf('/')
    const tagSeparator = withoutDigest.indexOf(':', lastSlash + 1)

    return tagSeparator === -1
        ? withoutDigest
        : withoutDigest.slice(0, tagSeparator)
}

export const synchronizeDockerCompose = (
    path: string,
    source: string,
    catalog: VersionCatalog,
): string => {
    const referencesByRepository = new Map<string, string>()

    for (const reference of Object.values(
        catalog.resolvedContainerImages(),
    )) {
        const repository = imageRepository(reference)

        if (referencesByRepository.has(repository))
            throw new Error(`Container image repository is registered more than once: ${repository}`)

        referencesByRepository.set(repository, reference)
    }

    return source.split('\n').map((line, lineIndex) => {
        const declaration = line.match(/^(\s*image:\s*)(["']?)([^"'\s#]+)\2(\s*(?:#.*)?)$/)

        if (!declaration)
            return line

        const [, prefix, quote, currentReference, suffix] = declaration
        const repository = imageRepository(currentReference)

        if (repository.startsWith('lixpi/'))
            return line

        const selectedReference = referencesByRepository.get(repository)

        if (!selectedReference)
            throw new Error(`Register external container image ${repository} used by ${path}:${lineIndex + 1}`)

        return `${prefix}${quote}${selectedReference}${quote}${suffix}`
    }).join('\n')
}
