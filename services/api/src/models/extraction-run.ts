'use strict'

import * as process from 'process'
import { v4 as uuid } from 'uuid'

import { getDynamoDbTableStageName, type ExtractionRun, type ExtractionRunStatus, type StageTraceEvent } from '@lixpi/constants'

const { ORG_NAME, STAGE } = process.env

export default {
    createRun: async ({ extractionRunId: providedId, workspaceId, userId, userText, modelConfig, sourceContextSnapshot }: {
        extractionRunId?: string; workspaceId: string; userId: string; userText?: string; modelConfig?: ExtractionRun['modelConfig']; sourceContextSnapshot?: object
    }): Promise<ExtractionRun | undefined> => {
        const now = Date.now()
        const run: ExtractionRun = {
            extractionRunId: providedId ?? uuid(),
            workspaceId, userId, status: 'pending',
            ...(userText ? { userText } : {}),
            ...(modelConfig ? { modelConfig } : {}),
            ...(sourceContextSnapshot ? { sourceContextSnapshot } : {}),
            createdAt: now, updatedAt: now,
        }
        try {
            await dynamoDBService.putItem({ tableName: getDynamoDbTableStageName('EXTRACTION_RUNS', ORG_NAME, STAGE), item: run, origin: 'ExtractionRun.createRun' })
            return run
        } catch (error) { console.error('Failed to create extraction run:', error) }
    },

    getRun: async ({ extractionRunId, workspaceId }: { extractionRunId: string; workspaceId: string }): Promise<ExtractionRun | { error: string }> => {
        const item = await dynamoDBService.getItem({ tableName: getDynamoDbTableStageName('EXTRACTION_RUNS', ORG_NAME, STAGE), key: { extractionRunId, workspaceId }, origin: `ExtractionRun.getRun(${extractionRunId})` })
        if (!item || Object.keys(item).length === 0) return { error: 'NOT_FOUND' }
        return item as ExtractionRun
    },

    listWorkspaceRuns: async ({ workspaceId }: { workspaceId: string }): Promise<ExtractionRun[]> => {
        const result = await dynamoDBService.scanItems({
            tableName: getDynamoDbTableStageName('EXTRACTION_RUNS', ORG_NAME, STAGE),
            fetchAllItems: true,
            origin: 'ExtractionRun.listWorkspaceRuns',
        })

        return (result?.items ?? [])
            .filter((item: ExtractionRun) => item.workspaceId === workspaceId)
            .sort((a: ExtractionRun, b: ExtractionRun) => b.updatedAt - a.updatedAt)
    },

    deleteRun: async ({ extractionRunId, workspaceId }: { extractionRunId: string; workspaceId: string }): Promise<void> => {
        await dynamoDBService.deleteItems({
            tableName: getDynamoDbTableStageName('EXTRACTION_RUNS', ORG_NAME, STAGE),
            key: { extractionRunId, workspaceId },
            origin: 'ExtractionRun.deleteRun',
        })
    },

    deleteWorkspaceRuns: async ({ workspaceId }: { workspaceId: string }): Promise<number> => {
        const runs = await dynamoDBService.scanItems({
            tableName: getDynamoDbTableStageName('EXTRACTION_RUNS', ORG_NAME, STAGE),
            fetchAllItems: true,
            origin: 'ExtractionRun.deleteWorkspaceRuns:list',
        })
        const matchingRuns = (runs?.items ?? []).filter((item: ExtractionRun) => item.workspaceId === workspaceId)

        for (const run of matchingRuns) {
            await dynamoDBService.deleteItems({
                tableName: getDynamoDbTableStageName('EXTRACTION_RUNS', ORG_NAME, STAGE),
                key: { extractionRunId: run.extractionRunId, workspaceId },
                origin: 'ExtractionRun.deleteWorkspaceRuns:delete',
            })
        }

        return matchingRuns.length
    },

    updateStatus: async ({ extractionRunId, workspaceId, status }: { extractionRunId: string; workspaceId: string; status: ExtractionRunStatus }): Promise<void> => {
        await dynamoDBService.updateItem({ tableName: getDynamoDbTableStageName('EXTRACTION_RUNS', ORG_NAME, STAGE), key: { extractionRunId, workspaceId }, updates: { status, updatedAt: Date.now() }, origin: 'ExtractionRun.updateStatus' })
    },

    appendTranscriptDelta: async ({ extractionRunId, workspaceId, transcriptJson }: { extractionRunId: string; workspaceId: string; transcriptJson: object }): Promise<void> => {
        await dynamoDBService.updateItem({ tableName: getDynamoDbTableStageName('EXTRACTION_RUNS', ORG_NAME, STAGE), key: { extractionRunId, workspaceId }, updates: { transcriptJson, updatedAt: Date.now() }, origin: 'ExtractionRun.appendTranscriptDelta' })
    },

    markComplete: async ({ extractionRunId, workspaceId, featureId }: { extractionRunId: string; workspaceId: string; featureId: string }): Promise<void> => {
        await dynamoDBService.updateItem({ tableName: getDynamoDbTableStageName('EXTRACTION_RUNS', ORG_NAME, STAGE), key: { extractionRunId, workspaceId }, updates: { status: 'completed' as ExtractionRunStatus, featureId, updatedAt: Date.now() }, origin: 'ExtractionRun.markComplete' })
    },

    markFailed: async ({ extractionRunId, workspaceId, error }: { extractionRunId: string; workspaceId: string; error: string }): Promise<void> => {
        await dynamoDBService.updateItem({ tableName: getDynamoDbTableStageName('EXTRACTION_RUNS', ORG_NAME, STAGE), key: { extractionRunId, workspaceId }, updates: { status: 'failed' as ExtractionRunStatus, error, updatedAt: Date.now() }, origin: 'ExtractionRun.markFailed' })
    },

    appendStageReasoning: async ({ extractionRunId, workspaceId, stage, text }: { extractionRunId: string; workspaceId: string; stage: string; text: string }): Promise<void> => {
        if (!stage || !text) return
        try {
            const existing = await dynamoDBService.getItem({
                tableName: getDynamoDbTableStageName('EXTRACTION_RUNS', ORG_NAME, STAGE),
                key: { extractionRunId, workspaceId },
                origin: 'ExtractionRun.appendStageReasoning:read',
            })
            const stageReasoning = {
                ...((existing as any)?.stageReasoning ?? {}),
                [stage]: `${(existing as any)?.stageReasoning?.[stage] ?? ''}${text}`,
            }
            await dynamoDBService.updateItem({
                tableName: getDynamoDbTableStageName('EXTRACTION_RUNS', ORG_NAME, STAGE),
                key: { extractionRunId, workspaceId },
                updates: { stageReasoning, updatedAt: Date.now() },
                origin: 'ExtractionRun.appendStageReasoning',
            })
        } catch (error) {
            console.error('Failed to append extraction-run reasoning:', error)
        }
    },

    saveFeatureCard: async ({ extractionRunId, workspaceId, featureCard }: { extractionRunId: string; workspaceId: string; featureCard: Record<string, any> }): Promise<void> => {
        await dynamoDBService.updateItem({
            tableName: getDynamoDbTableStageName('EXTRACTION_RUNS', ORG_NAME, STAGE),
            key: { extractionRunId, workspaceId },
            updates: { featureCard, updatedAt: Date.now() },
            origin: 'ExtractionRun.saveFeatureCard',
        })
    },

    // Append a StageTraceEvent to the run's trace[] log. Best-effort: failures are logged but not propagated
    // since the trace is observability, not the primary persistence path.
    appendTrace: async ({ extractionRunId, workspaceId, event }: { extractionRunId: string; workspaceId: string; event: StageTraceEvent }): Promise<void> => {
        try {
            const existing = await dynamoDBService.getItem({
                tableName: getDynamoDbTableStageName('EXTRACTION_RUNS', ORG_NAME, STAGE),
                key: { extractionRunId, workspaceId },
                origin: 'ExtractionRun.appendTrace:read',
            })
            const trace: StageTraceEvent[] = Array.isArray((existing as any)?.trace) ? (existing as any).trace : []
            // DynamoDB's marshaller rejects undefined values, and StageTraceEvent has many
            // optional fields. Drop undefined keys so the trace list persists cleanly.
            const cleanEvent = Object.fromEntries(
                Object.entries(event).filter(([, value]) => value !== undefined),
            ) as StageTraceEvent
            trace.push(cleanEvent)
            await dynamoDBService.updateItem({
                tableName: getDynamoDbTableStageName('EXTRACTION_RUNS', ORG_NAME, STAGE),
                key: { extractionRunId, workspaceId },
                updates: { trace, updatedAt: Date.now() },
                origin: 'ExtractionRun.appendTrace',
            })
        } catch (error) {
            console.error('Failed to append extraction-run trace:', error)
        }
    },
}
