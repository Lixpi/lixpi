export type ComparableVersion = {
    major: number
    minor: number
    patch: number
}

export const comparableVersion = (value: string): ComparableVersion | undefined => {
    const match = value.match(/(?:^|[^\d])v?(\d+)\.(\d+)\.(\d+)(?:[-+][\dA-Za-z.-]+)?$/)

    if (!match)
        return undefined

    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
    }
}

export const compareVersions = (
    left: ComparableVersion,
    right: ComparableVersion,
): number => left.major - right.major
    || left.minor - right.minor
    || left.patch - right.patch

export const versionBetween = (
    candidate: ComparableVersion,
    current: ComparableVersion,
    latest: ComparableVersion,
): boolean => compareVersions(candidate, current) > 0
    && compareVersions(candidate, latest) <= 0

export const versionText = (version: ComparableVersion): string => `${version.major}.${version.minor}.${version.patch}`

export const pseudoVersionCommit = (value: string): string | undefined => value.match(/-\d{14}-([\da-f]{12,40})$/i)?.[1]
