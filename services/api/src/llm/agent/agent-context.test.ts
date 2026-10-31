import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HumanMessage } from '@langchain/core/messages'
import { type ConversationSourceSnapshot, type ConversationTurn } from '@lixpi/constants'
import { AgentContext } from './agent-context.ts'
import { createConversationExecutionFixture } from './conversation-test-support.ts'

const mocks = vi.hoisted(() => ({
    resolve: vi.fn(),
    modelInput: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    references: vi.fn(),
    operationKeys: vi.fn(),
    validateDocument: vi.fn(),
}))
vi.mock('./conversation-adapters.ts', () => ({ ConversationAdapters: class {
    authorize = async () => ({
        userId: 'user',
        organizationId: 'org',
        workspaceId: 'workspace',
    })
    resolveReferences = mocks.resolve
} }))
vi.mock('../../models/asset.ts', () => ({
    default: {
        get: mocks.get,
        listAvailable: mocks.list,
    },
    buildAssetScopeAndOwnerKey: () => 'workspace',
}))
vi.mock('../../models/blob.ts', () => ({
    default: { get: async ({ blobHash }: { blobHash: string }) => ({
        blobHash,
        blobKey: blobHash,
    }) },
    buildBlobReferenceOperations: () => [],
}))
vi.mock('../../services/blob-storage.ts', () => ({ getContentAddressedBlob: async () => Buffer.from(JSON.stringify({
    type: 'doc',
    content: [{
        type: 'text',
        text: 'Source material.',
    }],
})) }))
vi.mock('../../capability-system/capability-artifacts.ts', () => ({ capabilityArtifactBackendRegistry: { require: () => ({ shared: {
    collectSourceReferences: mocks.references,
    collectOperationKeys: mocks.operationKeys,
    assertInitialDocument: mocks.validateDocument,
} }) } }))
vi.mock('../../capability-system/capability-model-input-adapter.ts', () => ({ resolveAuthorizedAssetModelInput: mocks.modelInput }))

const source: ConversationSourceSnapshot = {
    assetId: 'source',
    role: 'content',
    revision: 1,
    documentVersion: 1,
    blobHash: 'source-hash',
    acquiredBy: 'discovery',
    relationshipPath: ['source'],
}
const fixture = async (mode: ConversationTurn['settings']['contextMode'] = 'mixed', references: ConversationSourceSnapshot[] = []) => {
    const test = await createConversationExecutionFixture()
    const turn = {
        ...test.turn,
        commandSeq: 3,
        references,
        settings: {
            ...test.turn.settings,
            contextMode: mode,
        },
    }
    const prior = {
        ...test.turn,
        turnId: 'prior',
        commandSeq: 1,
        references: [],
        settings: {
            ...test.turn.settings,
            contextMode: 'mixed' as const,
        },
    }
    await test.repository.commit([
        test.repository.put(test.owner.partition, 'TURN#prior', prior),
        test.repository.put(test.owner.partition, 'MESSAGE#0001', {
            messageId: 'old-answer',
            turnId: 'prior',
            role: 'assistant',
            text: 'Private source-derived material.',
            complete: true,
            createdAt: 1,
        }),
        test.repository.put(test.owner.partition, 'MESSAGE_CONTEXT#old-answer', {
            revision: 1,
            turnId: 'prior',
            sources: [source],
        }),
    ])
    mocks.resolve.mockImplementation(async (_access, references) => references.map(reference => ({
        ...source,
        ...reference,
        revision: 2,
        blobHash: source.blobHash,
    })))
    const context = new AgentContext(test.repository, test.owner, turn, test.payloads)

    return {
        ...test,
        turn,
        context,
    }
}
beforeEach(() => {
    vi.resetAllMocks()
    mocks.references.mockReturnValue([])
    mocks.operationKeys.mockReturnValue([])
})

it('describes only admitted frozen execution targets and rechecks their access and document identity', async () => {
    const selected = {
        ...source,
        assetId: 'blue-pipeline',
        role: 'artifact' as const,
        acquiredBy: 'explicit' as const,
    }
    const f = await fixture('explicit', [selected])
    mocks.get.mockResolvedValue({
        assetId: selected.assetId,
        title: 'Blue hold',
        organizationId: 'org',
        artifact: { artifactTypeId: 'media-pipeline' },
    })
    mocks.operationKeys.mockReturnValue(['sequence.create', 'sequence.export'])
    await f.repository.commit([f.repository.put(f.owner.partition, `CONTEXT#${f.turn.turnId}#discovered`, { source: {
        ...selected,
        assetId: 'discovered-only-pipeline',
        acquiredBy: 'discovery',
    } })])
    await f.context.initialize()
    expect(await f.context.executionTargets()).toEqual([{
        assetId: 'blue-pipeline',
        title: 'Blue hold',
        artifactTypeId: 'media-pipeline',
        revision: 1,
        operationKeys: ['sequence.create', 'sequence.export'],
    }])
    expect(mocks.validateDocument).toHaveBeenCalledOnce()
    mocks.resolve.mockResolvedValueOnce([{
        ...selected,
        blobHash: 'changed',
    }])
    await expect(f.context.executionTargets()).rejects.toThrow('AGENT_SOURCE_CHANGED')
    mocks.resolve.mockRejectedValueOnce(new Error('ACCESS_REVOKED'))
    await expect(f.context.executionTargets()).rejects.toThrow('ACCESS_REVOKED')
})

describe('attributable conversation context', () => {
    it.each([undefined, 'original'])('admits a discovered original rendition %s also bound by an existing sequence', async renditionId => {
        const f = await fixture('discovery')
        const media = {
            assetId: 'image',
            role: 'media',
            revision: 3,
            blobHash: 'unchanged-image',
            ...(renditionId ? { renditionId } : {}),
        }
        mocks.list.mockResolvedValue({ items: [
            {
                assetId: 'image',
                title: 'Solid Blue Field',
                primaryCategory: 'image',
                scopeOwnerId: 'workspace',
            },
            {
                assetId: 'sequence',
                title: 'Existing sequence',
                primaryCategory: 'capabilityArtifact',
                scopeOwnerId: 'workspace',
            },
        ] })
        mocks.resolve.mockImplementation(async (_access, references) => references.map(reference => ({
            ...(reference.assetId === 'image' ? media : {
                assetId: 'sequence',
                role: 'artifact',
                revision: 12,
                documentVersion: 11,
                blobHash: 'sequence-document',
            }),
            ...reference,
            revision: reference.assetId === 'image' ? 3 : 12,
            acquiredBy: 'explicit',
            relationshipPath: [reference.assetId],
        })))
        mocks.get.mockResolvedValue({
            assetId: 'sequence',
            artifact: { artifactTypeId: 'media-sequence' },
        })
        mocks.references.mockReturnValue([{
            assetId: 'image',
            role: 'media',
            renditionId: 'original',
            blobHash: 'unchanged-image',
        }])
        await f.context.initialize()
        await f.context.discover('')
        await expect(f.context.refreshOutputs()).resolves.toBeUndefined()
        await expect(f.context.assertReadTarget('image')).resolves.toBeUndefined()
        await f.context.recordMessageSources('draft-answer')
        const attribution = await f.repository.read<{ payload: unknown }>(f.owner.partition, 'MESSAGE_CONTEXT#draft-answer')
        const sources = JSON.parse(Buffer.from(await f.payloads.read(attribution!.payload as never)).toString('utf8'))
        expect(sources.filter((entry: ConversationSourceSnapshot) => entry.assetId === 'image')).toHaveLength(1)
        await expect(new AgentContext(f.repository, f.owner, f.turn, f.payloads).initialize()).resolves.toBeUndefined()
        mocks.references.mockReturnValue([{
            assetId: 'image',
            role: 'media',
            renditionId: 'preview',
            blobHash: 'unchanged-image',
        }])
        await expect(f.context.refreshOutputs()).resolves.toBeUndefined()
        await expect(f.context.assertReadTarget('image')).resolves.toBeUndefined()
        await f.context.recordMessageSources('preview-answer')
        const previewAttribution = await f.repository.read<{ payload: unknown }>(f.owner.partition, 'MESSAGE_CONTEXT#preview-answer')
        const previewSources = JSON.parse(Buffer.from(await f.payloads.read(previewAttribution!.payload as never)).toString('utf8'))
        expect(previewSources.filter((entry: ConversationSourceSnapshot) => entry.assetId === 'image').map((entry: ConversationSourceSnapshot) => entry.renditionId ?? 'original').sort()).toEqual(['original', 'preview'])
        mocks.references.mockReturnValue([{
            assetId: 'image',
            role: 'media',
            renditionId: 'original',
            blobHash: 'changed-image',
        }])
        await expect(f.context.refreshOutputs()).rejects.toThrow('AGENT_SOURCE_DEPENDENCY_CHANGED')
    })

    it('excludes discovered material when the new turn narrows to explicit sources', async () => {
        const f = await fixture('explicit')
        const messages = await f.context.history()
        expect(messages.map(message => message.text)).not.toContain('Private source-derived material.')
    })

    it('rechecks attributed discoveries in mixed mode and propagates their attribution', async () => {
        const f = await fixture()
        expect((await f.context.history()).map(message => message.text)).toContain('Private source-derived material.')
        await f.context.recordMessageSources('new-answer')
        const attribution = await f.repository.read<{ payload: unknown }>(f.owner.partition, 'MESSAGE_CONTEXT#new-answer')
        expect(JSON.parse(Buffer.from(await f.payloads.read(attribution!.payload as never)).toString('utf8'))).toEqual([source])
        mocks.resolve.mockRejectedValue(new Error('SOURCE_REVOKED'))
        await expect(f.context.assertSources()).rejects.toThrow('SOURCE_REVOKED')
        expect((await new AgentContext(f.repository, f.owner, f.turn, f.payloads).history()).map(message => message.text)).not.toContain('Private source-derived material.')
    })

    it('excludes changed sources and older discovery answers without attribution', async () => {
        const f = await fixture()
        mocks.resolve.mockImplementation(async () => [{
            ...source,
            blobHash: 'changed',
        }])
        expect((await f.context.history()).map(message => message.text)).not.toContain('Private source-derived material.')
        await f.repository.commit([f.repository.remove(f.owner.partition, 'MESSAGE_CONTEXT#old-answer')])
        mocks.resolve.mockResolvedValue([source])
        expect((await f.context.history()).map(message => message.text)).not.toContain('Private source-derived material.')
    })

    it('does not reject an unchanged frozen blob when unrelated Asset metadata changes', async () => {
        const f = await fixture('explicit', [{
            ...source,
            acquiredBy: 'explicit',
        }])
        await expect(f.context.initialize()).resolves.toBeUndefined()
        expect(mocks.resolve).toHaveBeenCalledWith(expect.anything(), [expect.objectContaining({ revision: undefined })])
    })

    it('attaches native image blocks without putting image bytes in tool results', async () => {
        const media = {
            ...source,
            role: 'media' as const,
            documentVersion: undefined,
            renditionId: 'original',
            acquiredBy: 'explicit' as const,
        }
        const f = await fixture('explicit', [media])
        mocks.resolve.mockResolvedValue([media])
        mocks.get.mockResolvedValue({
            assetId: 'source',
            title: 'Source',
            media: {
                kind: 'image',
                renditions: {
                    original: {
                        name: 'original',
                        status: 'ready',
                        blobHash: 'source-hash',
                    },
                    preview: {
                        name: 'preview',
                        status: 'ready',
                        blobHash: 'different-representation',
                    },
                },
            },
        })
        mocks.modelInput.mockResolvedValue({
            kind: 'image',
            assetId: 'source',
            title: 'Source',
            marker: 'source',
            mimeType: 'image/png',
            bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4VQAAAAASUVORK5CYII=', 'base64'),
        })
        const metadata = await f.context.readSource('source')
        expect(JSON.stringify(metadata)).not.toContain('base64')
        const original = [new HumanMessage({
            id: 'human',
            content: 'Describe the attached image.',
        })]
        const profile = {
            thinkingMode: 'none' as const,
            supportsTemperature: false,
            supportsSystemPrompt: true,
            requiresAutoToolChoiceWithThinking: false,
            requiresClosedJsonSchema: false,
            supportedInputKinds: ['image' as const],
        }
        const first = await f.context.modelMessages(original, profile)
        expect(first[0].content).toEqual(expect.arrayContaining([expect.objectContaining({
            type: 'image',
            source: expect.objectContaining({
                type: 'base64',
                media_type: 'image/png',
            }),
        })]))
        expect(original[0].content).toBe('Describe the attached image.')
        expect(mocks.modelInput.mock.calls[0][0].media.renditions).toEqual({ original: expect.objectContaining({ blobHash: 'source-hash' }) })
        expect(await f.context.modelMessages(original, profile)).toEqual(first)
        await expect(f.context.modelMessages(original, {
            ...profile,
            supportedInputKinds: [],
        })).rejects.toThrow('AGENT_MODEL_INPUT_UNSUPPORTED:image')
    })

    it('admits prior conversation outputs in explicit mode after rechecking Asset access', async () => {
        const f = await fixture('explicit')
        await f.repository.commit([f.repository.put(f.owner.partition, 'CREATED#output', {
            assetId: 'output',
            runId: 'prior-run',
        })])
        mocks.get.mockResolvedValue({
            assetId: 'output',
            organizationId: 'org',
            artifact: { artifactTypeId: 'media-sequence' },
        })
        mocks.resolve.mockImplementation(async (_access, references) => references.map(reference => ({
            ...source,
            ...reference,
        })))
        await f.context.initialize()
        expect(f.context.targetAssetIds()).toContain('output')
        await expect(f.context.assertReadTarget('output')).resolves.toBeUndefined()
        await expect(f.context.assertReadTarget('unrelated-output')).rejects.toThrow('AGENT_READ_TARGET_NOT_IN_CONTEXT')
        mocks.resolve.mockRejectedValue(new Error('ACCESS_REVOKED'))
        await expect(f.context.assertReadTarget('output')).rejects.toThrow('ACCESS_REVOKED')
    })

    it('retains earlier explicitly attached source context without retaining discoveries', async () => {
        const f = await fixture('explicit')
        const explicit = {
            ...source,
            acquiredBy: 'explicit' as const,
        }
        await f.repository.commit([
            f.repository.replace(f.owner.partition, 'TURN#prior', {
                ...f.turn,
                turnId: 'prior',
                commandSeq: 1,
                references: [explicit],
            }),
            f.repository.replace(f.owner.partition, 'MESSAGE_CONTEXT#old-answer', {
                revision: 1,
                turnId: 'prior',
                sources: [explicit],
            }),
        ])
        expect((await f.context.history()).map(message => message.text)).toContain('Private source-derived material.')
        expect(f.context.targetAssetIds()).toContain('source')
    })

    it('admits frozen Artifact dependencies through their declared reference hook', async () => {
        const parent = {
            ...source,
            role: 'artifact' as const,
            acquiredBy: 'explicit' as const,
        }
        const f = await fixture('explicit', [parent])
        mocks.get.mockResolvedValue({
            assetId: 'source',
            organizationId: 'org',
            artifact: { artifactTypeId: 'media-sequence' },
        })
        mocks.references.mockReturnValue([{
            assetId: 'child',
            role: 'media',
            renditionId: 'original',
            blobHash: 'child-hash',
        }])
        mocks.resolve.mockImplementation(async (_access, references) => references.map(reference => ({
            ...source,
            ...reference,
            blobHash: reference.assetId === 'child' ? 'child-hash' : 'source-hash',
        })))
        await f.context.initialize()
        expect(f.context.targetAssetIds()).toEqual(['source', 'child'])
        await expect(f.context.assertReadTarget('child')).resolves.toBeUndefined()
        await f.context.recordMessageSources('new-answer')
        const attribution = await f.repository.read<{ payload: unknown }>(f.owner.partition, 'MESSAGE_CONTEXT#new-answer')
        expect(JSON.parse(Buffer.from(await f.payloads.read(attribution!.payload as never)).toString('utf8'))).toContainEqual(expect.objectContaining({
            assetId: 'child',
            relationshipPath: ['source', 'child'],
            acquiredBy: 'explicit',
        }))
        mocks.references.mockReturnValue([{
            assetId: 'child',
            role: 'media',
            blobHash: 'stale-hash',
        }])
        await expect(new AgentContext(f.repository, f.owner, f.turn, f.payloads).initialize()).rejects.toThrow('AGENT_SOURCE_DEPENDENCY_CHANGED')
    })
})
