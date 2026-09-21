import {
    type VersionCatalog,
} from '../shared/version-catalog.ts'

const managedArgumentNamePattern = /_(?:IMAGE_REFERENCE|VERSION)$/

const directVersionPatterns = [
    /\bpnpm@v?\d/,
    /\btypescript@v?\d/,
    /\bgo install\s+\S+@v?\d/,
]

export const synchronizeDockerfile = (
    path: string,
    source: string,
    catalog: VersionCatalog,
): string => {
    const selectedArguments = catalog.dockerBuildArgumentValues()
    const declaredArguments = new Set<string>()
    const localImageArguments = new Set<string>()
    const managedArgumentsWithDefaults = new Set<string>()
    const stageNames = new Set<string>()

    return source.split('\n').map((line, lineIndex) => {
        const argument = line.match(/^ARG\s+([A-Z][A-Z0-9_]*)(?:=(\S+))?$/)

        if (argument) {
            const [, name, currentValue] = argument
            declaredArguments.add(name)
            const selectedValue = selectedArguments[name]

            if (selectedValue) {
                if (currentValue !== undefined) {
                    managedArgumentsWithDefaults.add(name)

                    return `ARG ${name}=${selectedValue}`
                }

                if (!managedArgumentsWithDefaults.has(name))
                    throw new Error(
                        `Give registered Docker build argument ${name} a generated default before redeclaring it in ${path}:${lineIndex + 1}`,
                    )

                return line
            }

            if (currentValue?.startsWith('lixpi/'))
                localImageArguments.add(name)

            if (
                currentValue !== undefined
                && managedArgumentNamePattern.test(name)
            )
                throw new Error(`Register Docker build argument ${name} used by ${path}:${lineIndex + 1}`)

            return line
        }

        const from = line.match(/^FROM(?:\s+--platform=\S+)?\s+(\S+)(?:\s+AS\s+(\S+))?$/i)

        if (from) {
            const [, imageReference, stageName] = from
            const argumentReference = imageReference.match(/^\$\{([A-Z][A-Z0-9_]*)\}$/)?.[1]
            const isInternalStage = imageReference === 'scratch'
                || stageNames.has(imageReference)

            if (
                !isInternalStage
                && !argumentReference
            )
                throw new Error(`Use a registered image-reference argument in ${path}:${lineIndex + 1}`)

            if (
                argumentReference
                && (
                    !declaredArguments.has(argumentReference)
                    || (
                        !selectedArguments[argumentReference]
                        && !localImageArguments.has(argumentReference)
                    )
                )
            )
                throw new Error(`Register external image argument ${argumentReference} before ${path}:${lineIndex + 1}`)

            if (stageName)
                stageNames.add(stageName)
        }

        if (
            !line.trimStart().startsWith('#')
            && directVersionPatterns.some(pattern => pattern.test(line))
        )
            throw new Error(`Use a registered Docker build argument for the version in ${path}:${lineIndex + 1}`)

        return line
    }).join('\n')
}
