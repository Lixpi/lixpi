import {
    info,
    warn,
} from '@lixpi/debug-tools'

import {
    type DriftFinding,
} from './types.ts'

export type DriftReport = {
    pricing: DriftFinding[]
    other: DriftFinding[]
    total: number
}

// Turns merge disagreements into something a human acts on. It never changes a
// value: the authored file stays authoritative and this only says where an external
// source now disagrees with it.
//
// Pricing is separated because it reaches billing over the `metrics.*` wire, so a
// price the vendor changed underneath a hand-verified number is a money bug, while
// a context window that moved is a display bug.
//
// This is drift between the catalog and a source. Disagreement between two sources
// is a different thing and is recorded per field in the fetched file by the fetcher.
export class DriftReporter {
    build(findings: DriftFinding[]): DriftReport {
        const pricing = findings.filter(finding => finding.isPricing)
        const other = findings.filter(finding => !finding.isPricing)

        return {
            pricing,
            other,
            total: findings.length,
        }
    }

    private describe(finding: DriftFinding): string {
        return `${finding.provider}/${finding.modelId} ${finding.field}: catalog ${JSON.stringify(finding.lixpiValue)}, ${finding.source} ${JSON.stringify(finding.fetchedValue)}`
    }

    log(report: DriftReport): void {
        if (report.total === 0) {
            info('No catalog drift: every external source agrees with the authored values')

            return
        }

        for (const finding of report.pricing)
            warn(`PRICE DRIFT ${this.describe(finding)}`)

        for (const finding of report.other)
            warn(`DRIFT ${this.describe(finding)}`)

        warn(`Catalog drift: ${report.pricing.length} pricing, ${report.other.length} other`)
    }
}
