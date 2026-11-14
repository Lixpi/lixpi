import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HumanMessage } from '@langchain/core/messages'
import { type ConversationSourceSnapshot, type ConversationTurn } from '@lixpi/constants'
import { AgentContext } from './agent-context.ts'
import { agentArtifactEditKey } from './agent-execution-scope.ts'
import { createConversationExecutionFixture } from './conversation-test-support.ts'

const mocks = vi.hoisted(() => ({
    resolve: vi.fn(),
    modelInput: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    references: vi.fn(),
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
vi.mock('../../capability-system/capability-artifacts.ts', () => {
    const sequence = { shared: {
        collectSourceReferences: mocks.references,
        serializeForModel: () => ({ text: 'Sequence document.' }),
    } }

    return { capabilityArtifactBackendRegistry: {
        get: (id: string) => id === 'media-sequence' ? sequence : undefined,
        require: () => sequence,
    } }
})
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
const fixture = async (mode: ConversationTurn['settings']['contextMode'] = 'mixed', references: ConversationSourceSnapshot[] = [], history = false) => {
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
        ...history ? [test.repository.put(test.owner.partition, 'MESSAGE#0001', {
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
        })] : [],
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
})

const historicalImage = async (mode: ConversationTurn['settings']['contextMode'] = 'explicit') => {
    const f = await fixture(mode)
    const media: ConversationSourceSnapshot = {
        assetId: 'previous-image',
        role: 'media',
        renditionId: 'original',
        revision: 1,
        blobHash: 'image-hash',
        acquiredBy: 'explicit',
        relationshipPath: ['previous-image'],
    }
    await f.repository.commit([
        f.repository.replace(f.owner.partition, 'TURN#prior', {
            ...f.turn,
            turnId: 'prior',
            commandSeq: 1,
            references: [media],
        }),
        f.repository.put(f.owner.partition, 'MESSAGE#0001', {
            messageId: 'attached-message',
            turnId: 'prior',
            role: 'user',
            text: 'Use this image. A string such as invented-asset is not an attachment.',
            complete: true,
            createdAt: 1,
        }),
    ])
    mocks.resolve.mockImplementation(async (_access, references) => references.map(reference => ({
        ...reference,
        revision: 2,
    })))

    return {
        ...f,
        media,
    }
}

describe('attributable conversation context', () => {
    it.each(['explicit', 'mixed', 'discovery'] as const)('restores accepted image identities before pinned context without relying on an assistant reply in %s mode', async mode => {
        const f = await historicalImage(mode)
        await f.context.initialize()
        const pinned = JSON.parse(await f.context.pinned())
        expect(pinned.explicitSources).toEqual([expect.objectContaining({ source: f.media })])
        expect(pinned.sourceMessages).toEqual([{
            messageId: 'attached-message',
            turnId: 'prior',
            commandSeq: 1,
            messageText: 'Use this image. A string such as invented-asset is not an attachment.',
            references: [f.media],
        }])
        await expect(f.context.assertReadTarget(f.media.assetId)).resolves.toBeUndefined()
        const messages = [new HumanMessage('Make the previous image look like a 60s pinup.')]
        expect(await f.context.modelMessages(messages, { supportedInputKinds: [] } as never)).toBe(messages)
        expect(mocks.modelInput).not.toHaveBeenCalled()
        mocks.resolve.mockClear()
        await expect(f.context.assertReadTarget('invented-asset')).rejects.toThrow('AGENT_READ_TARGET_NOT_IN_CONTEXT')
        expect(mocks.resolve).not.toHaveBeenCalled()
    })

    it('bounds pinned origin text without losing the full historical user message', async () => {
        const f = await historicalImage()
        const text = 'x'.repeat(700)
        await f.repository.commit([f.repository.replace(f.owner.partition, 'MESSAGE#0001', {
            messageId: 'attached-message',
            turnId: 'prior',
            role: 'user',
            text,
            complete: true,
            createdAt: 1,
        })])
        await f.context.initialize()
        expect(JSON.parse(await f.context.pinned()).sourceMessages[0]).toMatchObject({
            messageText: text.slice(0, 500),
            textTruncated: true,
        })
        expect((await f.context.history())[0].text).toBe(text)
    })

    it('restores a previously inspected historical image before native checkpoint recovery', async () => {
        const f = await historicalImage()
        await f.context.initialize()
        await f.context.readSource(f.media.assetId)
        const recovered = new AgentContext(f.repository, f.owner, f.turn, f.payloads)
        await recovered.initialize()
        await expect(recovered.assertReadTarget(f.media.assetId)).resolves.toBeUndefined()
        mocks.get.mockResolvedValue({
            assetId: f.media.assetId,
            media: {
                kind: 'image',
                renditions: { original: {
                    status: 'ready',
                    blobHash: f.media.blobHash,
                } },
            },
        })
        mocks.modelInput.mockResolvedValue({
            kind: 'image',
            mimeType: 'image/png',
            bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4VQAAAAASUVORK5CYII=', 'base64'),
        })
        const messages = await recovered.modelMessages(
            [new HumanMessage('Continue the image edit.')],
            { supportedInputKinds: ['image'] } as never,
        )
        expect(messages[0].content).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'image' }),
            expect.objectContaining({
                type: 'text',
                text: expect.stringContaining(`Asset ${f.media.assetId}, frozen SHA-256 ${f.media.blobHash}`),
            }),
        ]))
    })

    it.each(['revoked', 'changed'])('omits %s historical attachments from model identities and read admission', async state => {
        const f = await historicalImage()

        if (state === 'revoked')
            mocks.resolve.mockRejectedValue(new Error('ACCESS_REVOKED'))
        else
            mocks.resolve.mockResolvedValue([{
                ...f.media,
                blobHash: 'replacement-image',
            }])

        await f.context.initialize()
        expect(JSON.parse(await f.context.pinned())).toMatchObject({
            explicitSources: [],
            sourceMessages: [],
        })
        await expect(f.context.assertReadTarget(f.media.assetId)).rejects.toThrow('AGENT_READ_TARGET_NOT_IN_CONTEXT')
    })

    it('keeps a newly accepted image snapshot instead of the older historical identity', async () => {
        const f = await historicalImage()
        const current = {
            ...f.media,
            revision: 3,
            blobHash: 'newly-attached-image',
        }
        const context = new AgentContext(f.repository, f.owner, {
            ...f.turn,
            references: [current],
        }, f.payloads)
        mocks.resolve.mockResolvedValue([current])
        await context.initialize()
        const pinned = JSON.parse(await context.pinned())
        expect(pinned.explicitSources).toEqual([expect.objectContaining({ source: current })])
        expect(pinned.sourceMessages).toEqual([])
        await expect(context.assertReadTarget(current.assetId)).resolves.toBeUndefined()
        await context.recordMessageSources('current-answer')
        const attribution = await f.repository.read<{ payload: unknown }>(f.owner.partition, 'MESSAGE_CONTEXT#current-answer')
        expect(JSON.parse(Buffer.from(await f.payloads.read(attribution!.payload as never)).toString('utf8'))).toEqual([current])
    })

    it('keeps the current rendition when historical assistant attribution includes another authorized rendition', async () => {
        const f = await historicalImage()
        const current = {
            ...f.media,
            renditionId: 'preview',
            blobHash: 'preview-image',
        }
        await f.repository.commit([
            f.repository.put(f.owner.partition, 'MESSAGE#0002', {
                messageId: 'prior-answer',
                turnId: 'prior',
                role: 'assistant',
                text: 'The original image is attached.',
                complete: true,
                createdAt: 2,
            }),
            f.repository.put(f.owner.partition, 'MESSAGE_CONTEXT#prior-answer', {
                revision: 1,
                turnId: 'prior',
                sources: [f.media],
            }),
        ])
        const context = new AgentContext(f.repository, f.owner, {
            ...f.turn,
            references: [current],
        }, f.payloads)
        await context.initialize()
        expect(JSON.parse(await context.pinned()).explicitSources).toEqual([expect.objectContaining({ source: current })])
        await expect(context.readSource(current.assetId)).resolves.toMatchObject({ source: current })
    })

    it('does not restore discovered historical sources when checkpoint context narrows to explicit', async () => {
        const f = await fixture('mixed', [], true)
        await f.context.initialize()
        await expect(f.context.assertReadTarget(source.assetId)).resolves.toBeUndefined()
        const narrowed = new AgentContext(f.repository, f.owner, {
            ...f.turn,
            settings: {
                ...f.turn.settings,
                contextMode: 'explicit',
            },
        }, f.payloads)
        await narrowed.initialize()
        await expect(narrowed.assertReadTarget(source.assetId)).rejects.toThrow('AGENT_READ_TARGET_NOT_IN_CONTEXT')
        expect((await narrowed.history()).map(message => message.text)).not.toContain('Private source-derived material.')
    })

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

    it('admits an agent edit of an already discovered Artifact across recovery and retains the original attribution', async () => {
        const f = await fixture('discovery')
        const artifact = {
            ...source,
            assetId: 'sequence',
            role: 'artifact' as const,
        }
        let pointer = artifact
        mocks.get.mockResolvedValue({
            assetId: artifact.assetId,
            organizationId: 'org',
            artifact: { artifactTypeId: 'media-sequence' },
        })
        mocks.resolve.mockImplementation(async (_access, references) => references.map(reference => ({
            ...reference,
            revision: pointer.revision,
            documentVersion: pointer.documentVersion,
            blobHash: pointer.blobHash,
        })))
        await f.repository.commit([f.repository.put(f.owner.partition, `CONTEXT#${f.turn.turnId}#sequence`, { source: artifact })])
        await f.context.initialize()
        await f.context.recordMessageSources('edited-answer')
        await f.repository.commit([f.repository.put(
            f.owner.partition,
            agentArtifactEditKey(f.turn.turnId, artifact.assetId, 1),
            {
                previous: {
                    version: 1,
                    blobHash: artifact.blobHash,
                },
                next: {
                    version: 2,
                    blobHash: 'edited-hash',
                },
            },
        )])
        pointer = {
            ...artifact,
            revision: 2,
            documentVersion: 2,
            blobHash: 'edited-hash',
        }

        const recovered = new AgentContext(f.repository, f.owner, f.turn, f.payloads)
        await expect(recovered.initialize()).resolves.toBeUndefined()
        await expect(recovered.readSource(artifact.assetId)).resolves.toMatchObject({ source: pointer })
        await recovered.recordMessageSources('edited-answer')
        const attribution = await f.repository.read<{ payload: unknown }>(f.owner.partition, 'MESSAGE_CONTEXT#edited-answer')
        const sources = JSON.parse(Buffer.from(await f.payloads.read(attribution!.payload as never)).toString('utf8'))
        expect(sources).toEqual([artifact, pointer])

        const narrowed = new AgentContext(f.repository, f.owner, {
            ...f.turn,
            settings: {
                ...f.turn.settings,
                contextMode: 'explicit',
            },
        }, f.payloads)
        await narrowed.initialize()
        await expect(narrowed.assertReadTarget(artifact.assetId)).rejects.toThrow('AGENT_READ_TARGET_NOT_IN_CONTEXT')

        pointer = {
            ...pointer,
            revision: 3,
            documentVersion: 3,
            blobHash: 'other-writer',
        }
        await expect(recovered.assertSources()).rejects.toThrow('AGENT_SOURCE_CHANGED')
        await expect(new AgentContext(f.repository, f.owner, f.turn, f.payloads).initialize()).rejects.toThrow('AGENT_SOURCE_CHANGED')
    })

    it('skips unsupported Artifacts discovered implicitly and rejects explicit unsupported references', async () => {
        const f = await fixture('discovery')
        const artifact = {
            ...source,
            role: 'artifact' as const,
        }
        mocks.get.mockResolvedValue({
            assetId: artifact.assetId,
            organizationId: 'org',
            artifact: { artifactTypeId: 'retired-artifact' },
        })
        await f.repository.commit([
            f.repository.put(f.owner.partition, `CONTEXT#${f.turn.turnId}#${artifact.assetId}`, { source: artifact }),
            f.repository.put(f.owner.partition, `CREATED#${artifact.assetId}`, { assetId: artifact.assetId }),
        ])
        await expect(f.context.initialize()).resolves.toBeUndefined()
        await expect(f.context.assertReadTarget(artifact.assetId)).rejects.toThrow('AGENT_READ_TARGET_NOT_IN_CONTEXT')
        const attached = new AgentContext(f.repository, f.owner, {
            ...f.turn,
            references: [{
                ...artifact,
                acquiredBy: 'explicit',
            }],
            settings: {
                ...f.turn.settings,
                contextMode: 'explicit',
            },
        }, f.payloads)
        await expect(attached.initialize()).rejects.toThrow('CAPABILITY_ARTIFACT_BACKEND_UNKNOWN')
    })

    it('excludes discovered material when the new turn narrows to explicit sources', async () => {
        const f = await fixture('explicit', [], true)
        const messages = await f.context.history()
        expect(messages.map(message => message.text)).not.toContain('Private source-derived material.')
    })

    it('rechecks attributed discoveries in mixed mode and propagates their attribution', async () => {
        const f = await fixture('mixed', [], true)
        expect((await f.context.history()).map(message => message.text)).toContain('Private source-derived material.')
        await f.context.recordMessageSources('new-answer')
        const attribution = await f.repository.read<{ payload: unknown }>(f.owner.partition, 'MESSAGE_CONTEXT#new-answer')
        expect(JSON.parse(Buffer.from(await f.payloads.read(attribution!.payload as never)).toString('utf8'))).toEqual([source])
        mocks.resolve.mockRejectedValue(new Error('SOURCE_REVOKED'))
        await expect(f.context.assertSources()).rejects.toThrow('SOURCE_REVOKED')
        expect((await new AgentContext(f.repository, f.owner, f.turn, f.payloads).history()).map(message => message.text)).not.toContain('Private source-derived material.')
    })

    it('excludes changed sources and older discovery answers without attribution', async () => {
        const f = await fixture('mixed', [], true)
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
        await expect(f.context.assertReadTarget('output')).resolves.toBeUndefined()
        await expect(f.context.assertReadTarget('unrelated-output')).rejects.toThrow('AGENT_READ_TARGET_NOT_IN_CONTEXT')
        mocks.resolve.mockRejectedValue(new Error('ACCESS_REVOKED'))
        await expect(f.context.assertReadTarget('output')).rejects.toThrow('ACCESS_REVOKED')
    })

    it('retains earlier explicitly attached source context without retaining discoveries', async () => {
        const f = await fixture('explicit', [], true)
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
        await expect(f.context.assertReadTarget('source')).resolves.toBeUndefined()
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
        await expect(f.context.assertReadTarget('source')).resolves.toBeUndefined()
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
