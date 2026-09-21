import { RepositoryFiles } from '../shared/repository-files.ts'
import { VersionCatalog } from '../shared/version-catalog.ts'
import {
    planRepositorySynchronization,
    writeRepositoryChanges,
} from '../sync/repository-synchronizer.ts'
import {
    applyReleaseToCatalog,
    writeVersionCatalogs,
} from './catalog-updater.ts'
import {
    releaseGroupNames,
    selectDependencies,
    type AvailableDependencies,
    type DependencyCoordinate,
    type ReleaseGroup,
} from './dependency-selector.ts'
import {
    LatestReleaseResolver,
    type ResolvedDependencyRelease,
} from './latest-release-resolver.ts'
import { ReleaseNotesResolver } from './release-notes-resolver.ts'
import {
    type ReleaseNotesReview,
} from './release-notes.ts'
import {
    ReleaseClient,
    type ReleaseEvidence,
} from './release-client.ts'

type Command = 'apply' | 'list'

type ParsedCommand = {
    command: Command
    dryRun: boolean
    selectors: string[]
}

type ReviewedDependencyRelease = ResolvedDependencyRelease & {
    releaseNotes: ReleaseNotesReview
}

type ReleaseReportEntry = {
    currentVersion: string
    latestVersion: string
    changed: boolean
    releaseSource: ReleaseEvidence
    releaseNotes: ReleaseNotesReview
}

const usage = 'Usage: command.ts apply [--dry-run] [all|group|group:name|name ...]\n       command.ts list'

const parseCommand = (arguments_: string[]): ParsedCommand => {
    if (!arguments_.length)
        throw new Error(usage)

    const [command, ...argumentsAfterCommand] = arguments_

    if (command === 'list') {
        if (argumentsAfterCommand.length)
            throw new Error(usage)

        return {
            command,
            dryRun: true,
            selectors: [],
        }
    }

    if (command !== 'apply')
        throw new Error(usage)

    const dryRun = argumentsAfterCommand.includes('--dry-run')
    const selectors = argumentsAfterCommand.filter(argument => argument !== '--dry-run')

    if (selectors.some(selector => selector.startsWith('--')))
        throw new Error(usage)

    return {
        command: 'apply',
        dryRun,
        selectors: selectors.length ? selectors : ['all'],
    }
}

const printAvailableDependencies = (available: AvailableDependencies): void => {
    for (const group of releaseGroupNames) {
        process.stdout.write(`${group}\n`)

        for (const name of available[group])
            process.stdout.write(`  ${group}:${name}\n`)
    }
}

const coordinateKey = (coordinate: DependencyCoordinate): string => `${coordinate.group}\0${coordinate.name}`

const resolveDependencies = async (
    coordinates: DependencyCoordinate[],
    resolver: LatestReleaseResolver,
    client: ReleaseClient,
): Promise<ResolvedDependencyRelease[]> => {
    const resolved = new Map<string, ResolvedDependencyRelease>()

    await client.inBatches(
        coordinates,
        async coordinate => {
            resolved.set(
                coordinateKey(coordinate),
                await resolver.resolve(coordinate),
            )
        },
    )

    return coordinates.map(coordinate => {
        const release = resolved.get(
            coordinateKey(coordinate),
        )

        if (!release)
            throw new Error(`No release result for ${coordinate.group}:${coordinate.name}`)

        return release
    })
}

const reviewDependencies = async (
    releases: ResolvedDependencyRelease[],
    resolver: ReleaseNotesResolver,
    client: ReleaseClient,
): Promise<ReviewedDependencyRelease[]> => {
    const reviewed = new Map<string, ReviewedDependencyRelease>()

    await client.inBatches(
        releases,
        async release => {
            reviewed.set(
                coordinateKey(release),
                {
                    ...release,
                    releaseNotes: await resolver.review(release),
                },
            )
        },
    )

    return releases.map(release => {
        const review = reviewed.get(
            coordinateKey(release),
        )

        if (!review)
            throw new Error(`No release-note review for ${release.group}:${release.name}`)

        return review
    })
}

const releaseReport = (
    releases: ReviewedDependencyRelease[],
    client: ReleaseClient,
): Record<ReleaseGroup, Record<string, ReleaseReportEntry>> => {
    const report = Object.fromEntries(
        releaseGroupNames.map(
            group => [
                group,
                {},
            ],
        ),
    ) as Record<ReleaseGroup, Record<string, ReleaseReportEntry>>

    for (const release of releases) {
        const releaseSource = client.evidence[release.group][release.name]

        if (!releaseSource)
            throw new Error(`No publisher lookup evidence for ${release.group}:${release.name}`)

        report[release.group][release.name] = {
            currentVersion: release.currentVersion,
            latestVersion: release.latestVersion,
            changed: release.currentVersion !== release.latestVersion,
            releaseSource,
            releaseNotes: release.releaseNotes,
        }
    }

    return report
}

const writeReports = (
    files: RepositoryFiles,
    dryRun: boolean,
    selectors: string[],
    releases: ReviewedDependencyRelease[],
    client: ReleaseClient,
): void => {
    const fetchedAt = new Date().toISOString()

    files.writeRegistryJson(
        'reports/update-plan.json',
        {
            fetchedAt,
            command: 'apply',
            dryRun,
            selectors,
            updates: releaseReport(releases, client),
        },
    )
}

const printReleaseNotes = (release: ReviewedDependencyRelease): void => {
    const review = release.releaseNotes

    if (review.status === 'unchanged')
        return

    if (review.status === 'unavailable') {
        process.stdout.write(`  Release notes unavailable: ${review.message ?? 'The upstream source did not publish release notes.'}\n`)

        if (review.sourceUrl)
            process.stdout.write(`  ${review.sourceUrl}\n`)

        return
    }

    process.stdout.write(`  Release changes from ${review.sourceType ?? 'upstream'}:\n`)

    if (review.sourceUrl)
        process.stdout.write(`  ${review.sourceUrl}\n`)

    for (const change of review.changes) {
        process.stdout.write(`\n  ${change.version}: ${change.title}\n`)
        process.stdout.write(`  ${change.url}\n`)

        if (change.notes)
            process.stdout.write(`${change.notes}\n`)
    }
}

const printReleaseReview = (releases: ReviewedDependencyRelease[]): void => {
    const changed = releases.filter(release => release.currentVersion !== release.latestVersion)

    process.stdout.write(`Resolved ${releases.length} dependencies; ${changed.length} updates available.\n`)

    for (const release of changed) {
        process.stdout.write(`\n${release.group}:${release.name} ${release.currentVersion} to ${release.latestVersion}\n`)
        printReleaseNotes(release)
    }
}

const unavailableReleaseNotes = (releases: ReviewedDependencyRelease[]): ReviewedDependencyRelease[] => releases.filter(
    release => release.currentVersion !== release.latestVersion
        && release.releaseNotes.status === 'unavailable',
)

const run = async (): Promise<void> => {
    const parsed = parseCommand(
        process.argv.slice(2),
    )
    const files = new RepositoryFiles()
    const currentCatalog = new VersionCatalog(files)
    const client = new ReleaseClient()
    const releaseResolver = new LatestReleaseResolver(currentCatalog, client)
    const available = releaseResolver.availableDependencies()

    if (parsed.command === 'list') {
        printAvailableDependencies(available)

        return
    }

    const coordinates = selectDependencies(parsed.selectors, available)
    const resolved = await resolveDependencies(
        coordinates,
        releaseResolver,
        client,
    )
    const reviewed = await reviewDependencies(
        resolved,
        new ReleaseNotesResolver(client),
        client,
    )
    printReleaseReview(reviewed)

    if (parsed.dryRun) {
        writeReports(
            files,
            parsed.dryRun,
            parsed.selectors,
            reviewed,
            client,
        )
        process.stdout.write('\nDry run complete; authoritative catalogs and native consumers were not changed.\n')

        return
    }

    const unavailable = unavailableReleaseNotes(reviewed)

    if (unavailable.length)
        throw new Error(
            `Cannot apply updates without complete upstream release information: ${unavailable
                .map(release => `${release.group}:${release.name}`).join(', ')}. Run apply --dry-run to inspect the missing sources.`,
        )

    const prospectiveData = structuredClone(currentCatalog.data)

    for (const release of reviewed)
        applyReleaseToCatalog(prospectiveData, release)

    const prospectiveCatalog = new VersionCatalog(files, prospectiveData)
    const nativeChanges = planRepositorySynchronization(files, prospectiveCatalog)

    writeReports(
        files,
        parsed.dryRun,
        parsed.selectors,
        reviewed,
        client,
    )
    writeVersionCatalogs(files, prospectiveData)
    writeRepositoryChanges(files, nativeChanges)
    const changedCount = reviewed.filter(release => release.currentVersion !== release.latestVersion).length
    process.stdout.write(`\nApplied ${changedCount} catalog updates and synchronized ${nativeChanges.size} native files.\n`)
}

try {
    await run()
} catch (error) {
    const message = error instanceof AggregateError
        ? error.errors.map(String).join('\n')
        : String(error)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
}
