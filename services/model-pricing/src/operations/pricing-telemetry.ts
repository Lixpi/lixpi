'use strict'

import type { CandidateHoldReason } from '../importer/types.ts'

const METRIC_NAMESPACE = 'Lixpi/ModelPricing'
const SERVICE_NAME = 'model-pricing'

type MetricUnit = 'Count' | 'Milliseconds' | 'Percent' | 'Seconds'

type MetricValue = {
    value: number
    unit: MetricUnit
}

type ActiveSnapshotObservation = {
    snapshotId: string
    activatedAt: string
}

type ConsumerRefreshAcknowledgement = {
    snapshotId: string
    acknowledgedAt: number
}

export type PricingHealthObservation = {
    activeSnapshot?: ActiveSnapshotObservation
    activeRecordCount: number
    catalogRouteCount: number
    coveragePercent: number
    heldRouteCount: number
    missingRouteCount: number
    parserFailureHoldCount: number
    reconciliationConfiguredRouteCount: number
    reconciliationOpenIncidentCount: number
    reconciliationMaterialIncidentCount: number
    reconciliationWatermarkLagSeconds: number
}

export type MaintenanceTask =
    | 'health'
    | 'import'
    | 'reconciliation'
    | 'reconciliation-pruning'
    | 'snapshot-pruning'

export const isParserFailureReason = (reason: CandidateHoldReason): boolean =>
    reason === 'provider-evidence-unavailable'
    || reason === 'provider-layout-changed'
    || reason === 'provider-source-challenged'
    || reason === 'provider-source-invalid'
    || reason === 'provider-source-too-large'
    || reason === 'provider-spec-inconsistent'

export class PricingTelemetry {
    private activeSnapshot?: ActiveSnapshotObservation
    private lastConsumerRefreshAcknowledgement?: ConsumerRefreshAcknowledgement
    private lastSuccessfulImportAt?: number
    private refreshPendingSince?: number
    private refreshedSnapshotId?: string

    constructor(private readonly stage: string) {}

    initializeActiveSnapshot(observation: ActiveSnapshotObservation): void {
        this.activeSnapshot = observation
        this.refreshPendingSince = Date.now()
        this.refreshedSnapshotId = undefined
    }

    observeActiveSnapshot(observation: ActiveSnapshotObservation): void {
        if (this.activeSnapshot?.snapshotId === observation.snapshotId) return
        this.activeSnapshot = observation
        const activatedAt = Date.parse(observation.activatedAt)
        this.refreshPendingSince = Number.isFinite(activatedAt) ? activatedAt : Date.now()
        this.refreshedSnapshotId = undefined
        if (this.lastConsumerRefreshAcknowledgement?.snapshotId === observation.snapshotId) {
            this.recordConsumerRefresh(
                observation.snapshotId,
                this.lastConsumerRefreshAcknowledgement.acknowledgedAt,
            )
        }
    }

    recordConsumerRefreshAcknowledged(snapshotId: string): void {
        const acknowledgedAt = Date.now()
        this.lastConsumerRefreshAcknowledgement = { snapshotId, acknowledgedAt }
        this.recordConsumerRefresh(snapshotId, acknowledgedAt)
    }

    recordImportSuccess({
        durationMs,
        snapshotId,
    }: {
        durationMs: number
        snapshotId: string
    }): void {
        this.lastSuccessfulImportAt = Date.now()
        this.emit({
            ImportSuccessCount: { value: 1, unit: 'Count' },
            ImportDurationMilliseconds: { value: durationMs, unit: 'Milliseconds' },
        }, {
            Event: 'pricing_import_succeeded',
            SnapshotId: snapshotId,
        })
    }

    recordReconciliationSuccess(durationMs: number): void {
        this.emit({
            ReconciliationSuccessCount: { value: 1, unit: 'Count' },
            ReconciliationDurationMilliseconds: { value: durationMs, unit: 'Milliseconds' },
        }, { Event: 'pricing_reconciliation_succeeded' })
    }

    recordMaintenanceFailure(task: MaintenanceTask, error: unknown): void {
        const errorMessage = error instanceof Error ? error.message : String(error)
        this.emit({
            MaintenanceFailureCount: { value: 1, unit: 'Count' },
        }, {
            Event: 'pricing_maintenance_failed',
            MaintenanceTask: task,
            ErrorName: error instanceof Error ? error.name : 'UnknownError',
            ErrorMessage: errorMessage.slice(0, 2048),
        })
    }

    emitHealth(observation: PricingHealthObservation): void {
        if (observation.activeSnapshot) this.observeActiveSnapshot(observation.activeSnapshot)

        const activeSnapshotAgeSeconds = observation.activeSnapshot
            ? this.ageSeconds(observation.activeSnapshot.activatedAt)
            : 0
        const successfulImportAgeSeconds = this.lastSuccessfulImportAt
            ? Math.max(0, (Date.now() - this.lastSuccessfulImportAt) / 1000)
            : activeSnapshotAgeSeconds
        const refreshPending = observation.activeSnapshot
            && this.refreshedSnapshotId !== observation.activeSnapshot.snapshotId
            ? 1
            : 0
        const refreshLagSeconds = refreshPending === 1
            ? Math.max(0, (Date.now() - (this.refreshPendingSince ?? Date.now())) / 1000)
            : 0

        this.emit({
            ActiveSnapshotPresent: { value: observation.activeSnapshot ? 1 : 0, unit: 'Count' },
            ActiveSnapshotAgeSeconds: { value: activeSnapshotAgeSeconds, unit: 'Seconds' },
            LastSuccessfulImportAgeSeconds: { value: successfulImportAgeSeconds, unit: 'Seconds' },
            ActiveRecordCount: { value: observation.activeRecordCount, unit: 'Count' },
            CatalogRouteCount: { value: observation.catalogRouteCount, unit: 'Count' },
            PricingCoveragePercent: { value: observation.coveragePercent, unit: 'Percent' },
            HeldRouteCount: { value: observation.heldRouteCount, unit: 'Count' },
            MissingRouteCount: { value: observation.missingRouteCount, unit: 'Count' },
            ParserFailureHoldCount: { value: observation.parserFailureHoldCount, unit: 'Count' },
            ConsumerRefreshPending: { value: refreshPending, unit: 'Count' },
            ConsumerRefreshLagSeconds: { value: refreshLagSeconds, unit: 'Seconds' },
            ReconciliationConfiguredRouteCount: { value: observation.reconciliationConfiguredRouteCount, unit: 'Count' },
            ReconciliationOpenIncidentCount: { value: observation.reconciliationOpenIncidentCount, unit: 'Count' },
            ReconciliationMaterialIncidentCount: { value: observation.reconciliationMaterialIncidentCount, unit: 'Count' },
            ReconciliationWatermarkLagSeconds: { value: observation.reconciliationWatermarkLagSeconds, unit: 'Seconds' },
        }, {
            Event: 'pricing_health',
            ...(observation.activeSnapshot && { SnapshotId: observation.activeSnapshot.snapshotId }),
        })
    }

    private ageSeconds(timestamp: string): number {
        const parsed = Date.parse(timestamp)
        return Number.isFinite(parsed) ? Math.max(0, (Date.now() - parsed) / 1000) : 0
    }

    private recordConsumerRefresh(snapshotId: string, acknowledgedAt: number): void {
        if (this.activeSnapshot?.snapshotId !== snapshotId || this.refreshedSnapshotId === snapshotId) return

        const pendingSince = this.refreshPendingSince ?? Date.now()
        if (acknowledgedAt < pendingSince) return
        this.refreshedSnapshotId = snapshotId
        this.refreshPendingSince = undefined
        this.emit({
            ConsumerRefreshSuccessCount: { value: 1, unit: 'Count' },
            ConsumerRefreshDurationSeconds: {
                value: Math.max(0, (acknowledgedAt - pendingSince) / 1000),
                unit: 'Seconds',
            },
        }, {
            Event: 'pricing_consumer_refreshed',
            SnapshotId: snapshotId,
        })
    }

    private emit(metrics: Record<string, MetricValue>, properties: Record<string, string>): void {
        const metricDefinitions = Object.entries(metrics).map(([Name, metric]) => ({
            Name,
            Unit: metric.unit,
            StorageResolution: 60,
        }))
        const metricValues = Object.fromEntries(Object.entries(metrics).map(([name, metric]) => [name, metric.value]))
        const event = {
            _aws: {
                Timestamp: Date.now(),
                CloudWatchMetrics: [{
                    Namespace: METRIC_NAMESPACE,
                    Dimensions: [['Service', 'Stage']],
                    Metrics: metricDefinitions,
                }],
            },
            Service: SERVICE_NAME,
            Stage: this.stage,
            ...metricValues,
            ...properties,
        }

        // CloudWatch's log extractor requires the EMF envelope as an unprefixed
        // JSON line, so this intentionally bypasses the human-oriented logger.
        console.log(JSON.stringify(event))
    }
}
