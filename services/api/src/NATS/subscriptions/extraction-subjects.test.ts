'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NATS_SUBJECTS } from '@lixpi/constants'

const publish = vi.fn()

const mocks = vi.hoisted(() => ({
    workspace: {
        getWorkspace: vi.fn(),
    },
    extractionRun: {
        createRun: vi.fn(),
        updateStatus: vi.fn(),
        markFailed: vi.fn(),
        getRun: vi.fn(),
        listWorkspaceRuns: vi.fn(),
        deleteRun: vi.fn(),
    },
    aiModel: {
        getAiModel: vi.fn(),
    },
    llmModule: {
        processExtraction: vi.fn(),
    },
}))

vi.mock('@lixpi/debug-tools', () => ({ info: vi.fn(), err: vi.fn() }))
vi.mock('@lixpi/nats-service', () => ({ default: { getInstance: vi.fn(() => ({ publish })) } }))
vi.mock('../../models/workspace.ts', () => ({ default: mocks.workspace }))
vi.mock('../../models/extraction-run.ts', () => ({ default: mocks.extractionRun }))
vi.mock('../../models/ai-model.ts', () => ({ default: mocks.aiModel }))
vi.mock('../../models/asset.ts', () => ({ default: {} }))
vi.mock('../../models/blob.ts', () => ({ default: {} }))
vi.mock('../../services/ai-interaction-event-relay.ts', () => ({ ensureAiInteractionEventRelay: vi.fn(() => 'live-subject') }))
vi.mock('../../services/asset-requester-context.ts', () => ({ getAssetRequesterContext: vi.fn(async () => ({ userId: 'user-1', workspaceIds: [], editableWorkspaceIds: [], organizationIds: [] })) }))

import { extractionSubjects, setExtractionLlmModule } from './extraction-subjects.ts'

const SUBJECTS = NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.FEATURE_EXTRACT
const RESPONSE = NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE
const getHandler = (subject: string) =>
    extractionSubjects.find((subscription) => subscription.subject === subject)!.handler

beforeEach(() => {
    vi.clearAllMocks()
    // organizationId is resolved server-side from the workspace record, not from the client payload.
    mocks.workspace.getWorkspace.mockResolvedValue({
        workspaceId: 'workspace-1',
        organizationId: 'org-1',
        accessList: [{ userId: 'user-1', accessLevel: 'owner' }],
    })
    mocks.extractionRun.markFailed.mockResolvedValue(undefined)
    setExtractionLlmModule(mocks.llmModule as any)
})

// =============================================================================
// START — run creation, snapshot persistence, pipeline kickoff
// =============================================================================

describe('Feature extraction START', () => {
    const baseData = {
        user: { userId: 'user-1' },
        workspaceId: 'workspace-1',
        extractionRunId: 'run-1',
        messages: [{ role: 'user', content: 'extract the palette' }],
        aiModel: 'openai:gpt-test',
    }

    it('creates the run with its source snapshot and starts the pipeline', async () => {
        mocks.aiModel.getAiModel.mockResolvedValue({ model: 'gpt-test' })
        mocks.llmModule.processExtraction.mockResolvedValue({ success: true })
        const sourceContextSnapshot = { imageNatsUrl: 'nats-obj://ws/file' }

        await getHandler(SUBJECTS.START)({ ...baseData, sourceContextSnapshot })

        expect(mocks.extractionRun.createRun).toHaveBeenCalledWith(expect.objectContaining({
            extractionRunId: 'run-1',
            workspaceId: 'workspace-1',
            userId: 'user-1',
            sourceContextSnapshot,
        }))
        expect(mocks.extractionRun.updateStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'analyzing' }))
        expect(mocks.llmModule.processExtraction).toHaveBeenCalledWith(expect.objectContaining({
            extractionRunId: 'run-1',
            workspaceId: 'workspace-1',
            // organizationId is resolved server-side from the workspace, not taken from the client.
            organizationId: 'org-1',
            intent: 'extract the palette',
        }))
    })

    it('ignores any client-supplied organizationId and resolves it server-side from the workspace', async () => {
        mocks.aiModel.getAiModel.mockResolvedValue({ model: 'gpt-test' })
        mocks.llmModule.processExtraction.mockResolvedValue({ success: true })

        // A client trying to inject another org has no effect — resolution is server-side.
        await getHandler(SUBJECTS.START)({ ...baseData, organizationId: 'attacker-org' })

        expect(mocks.llmModule.processExtraction).toHaveBeenCalledWith(expect.objectContaining({
            organizationId: 'org-1',
        }))
    })

    it('fails the run and publishes an error when the analysis model id is missing', async () => {
        await getHandler(SUBJECTS.START)({ ...baseData, aiModel: undefined })

        expect(mocks.extractionRun.markFailed).toHaveBeenCalledWith(expect.objectContaining({ extractionRunId: 'run-1' }))
        expect(mocks.llmModule.processExtraction).not.toHaveBeenCalled()
    })

    it('fails the run and publishes an error when the analysis model is unknown', async () => {
        mocks.aiModel.getAiModel.mockResolvedValue(null)

        await getHandler(SUBJECTS.START)({ ...baseData, aiModel: 'openai:missing' })

        expect(mocks.extractionRun.markFailed).toHaveBeenCalledWith(expect.objectContaining({ extractionRunId: 'run-1' }))
        expect(mocks.llmModule.processExtraction).not.toHaveBeenCalled()
        expect(publish).toHaveBeenCalledWith(
            expect.stringContaining(`${RESPONSE}.workspace-1.run-1`),
            expect.objectContaining({ error: expect.stringContaining('openai:missing') }),
        )
    })

    it('publishes an error and does not create a run when the workspace is not accessible', async () => {
        mocks.workspace.getWorkspace.mockResolvedValueOnce({ error: 'PERMISSION_DENIED' })

        await getHandler(SUBJECTS.START)(baseData)

        expect(mocks.extractionRun.createRun).not.toHaveBeenCalled()
        expect(publish).toHaveBeenCalledWith(
            expect.stringContaining(`${RESPONSE}.`),
            expect.objectContaining({ error: 'PERMISSION_DENIED' }),
        )
        const [subjectArg] = publish.mock.calls[0]!
        expect(subjectArg.endsWith('.workspace-1.run-1')).toBe(true)
    })
})

// =============================================================================
// STATUS — single run lookup, gated on workspace access
// =============================================================================

describe('Feature extraction STATUS', () => {
    it('returns the run for a workspace member', async () => {
        const run = { extractionRunId: 'run-1', status: 'completed' }
        mocks.extractionRun.getRun.mockResolvedValue(run)

        const result = await getHandler(SUBJECTS.STATUS)({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
            extractionRunId: 'run-1',
        })

        expect(result).toEqual(run)
    })

    it('refuses status for an inaccessible workspace', async () => {
        mocks.workspace.getWorkspace.mockResolvedValueOnce({ error: 'PERMISSION_DENIED' })

        const result = await getHandler(SUBJECTS.STATUS)({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
            extractionRunId: 'run-1',
        })

        expect(result).toEqual({ error: 'PERMISSION_DENIED' })
        expect(mocks.extractionRun.getRun).not.toHaveBeenCalled()
    })
})

// =============================================================================
// LIST_BY_WORKSPACE / DELETE — session history surface
// =============================================================================

describe('Feature extraction session history', () => {
    it('lists persisted extraction runs for a workspace member', async () => {
        const runs = [{ extractionRunId: 'run-1', workspaceId: 'workspace-1' }]
        mocks.extractionRun.listWorkspaceRuns.mockResolvedValueOnce(runs)

        const result = await getHandler(SUBJECTS.LIST_BY_WORKSPACE)({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
        })

        expect(result).toEqual(runs)
    })

    it('deletes only the extraction run record', async () => {
        const result = await getHandler(SUBJECTS.DELETE)({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
            extractionRunId: 'run-1',
        })

        expect(mocks.extractionRun.deleteRun).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            extractionRunId: 'run-1',
        })
        expect(result).toEqual({ success: true, extractionRunId: 'run-1' })
    })
})
