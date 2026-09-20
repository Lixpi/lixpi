export const releaseGroupNames = [
    'npmPackages',
    'goModules',
    'packageManagers',
    'runtimes',
    'tools',
    'goTools',
    'containerImages',
    'githubActions',
] as const

export type ReleaseGroup = typeof releaseGroupNames[number]

export type DependencyCoordinate = {
    group: ReleaseGroup
    name: string
}

export type AvailableDependencies = Record<ReleaseGroup, string[]>

const coordinateKey = (coordinate: DependencyCoordinate): string => `${coordinate.group}\0${coordinate.name}`

const allCoordinates = (available: AvailableDependencies): DependencyCoordinate[] =>
    releaseGroupNames.flatMap(
        group => available[group].map(
            name => ({
                group,
                name,
            }),
        ),
    )

const qualifiedCoordinate = (
    selector: string,
    available: AvailableDependencies,
): DependencyCoordinate | undefined => {
    const separatorIndex = selector.indexOf(':')

    if (separatorIndex === -1)
        return undefined

    const group = selector.slice(0, separatorIndex)
    const name = selector.slice(separatorIndex + 1)

    if (!releaseGroupNames.includes(group as ReleaseGroup))
        throw new Error(`Unknown dependency group: ${group}`)

    if (!available[group as ReleaseGroup].includes(name))
        throw new Error(`Unknown dependency: ${selector}`)

    return {
        group: group as ReleaseGroup,
        name,
    }
}

export const selectDependencies = (
    selectors: string[],
    available: AvailableDependencies,
): DependencyCoordinate[] => {
    const requestedSelectors = selectors.length ? selectors : ['all']
    const selected = new Map<string, DependencyCoordinate>()

    for (const selector of requestedSelectors) {
        if (selector === 'all') {
            for (const coordinate of allCoordinates(available))
                selected.set(
                    coordinateKey(coordinate),
                    coordinate,
                )

            continue
        }

        if (releaseGroupNames.includes(selector as ReleaseGroup)) {
            const group = selector as ReleaseGroup

            for (const name of available[group]) {
                const coordinate = {
                    group,
                    name,
                }
                selected.set(
                    coordinateKey(coordinate),
                    coordinate,
                )
            }

            continue
        }

        const qualified = qualifiedCoordinate(selector, available)

        if (qualified) {
            selected.set(
                coordinateKey(qualified),
                qualified,
            )

            continue
        }

        const matches = allCoordinates(available).filter(coordinate => coordinate.name === selector)

        if (!matches.length)
            throw new Error(`Unknown dependency or group: ${selector}`)

        if (matches.length > 1)
            throw new Error(
                `Dependency name is ambiguous; use one of: ${matches.map(coordinate => `${coordinate.group}:${coordinate.name}`).join(', ')}`,
            )

        selected.set(
            coordinateKey(matches[0]),
            matches[0],
        )
    }

    return [...selected.values()]
}
