import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

import { type CapabilityManifest } from '@lixpi/constants'
import { validateCapabilityManifest } from '../../../shared/capability-validation.ts'
import { validateJsonSchemaValue } from '../../../shared/capability-json-schema.ts'
import { createMediaSequenceModule } from './index.ts'

describe('Media sequence module registration', () => {
    it('resolves a draft source through the original rendition without requiring an invented rendition name', async () => {
        const resolve = vi.fn(async (_access, input) => ({
            ...input,
            blobHash: 'image-hash',
            kind: 'image',
            byteSize: 40,
            timeBase: {
                numerator: 1,
                denominator: 1_000_000,
            },
            duration: 0,
            width: 320,
            height: 180,
        }))
        const commit = vi.fn()
        const exportSequence = vi.fn()
        const module = createMediaSequenceModule({
            ports: {
                authorize: vi.fn(),
                load: vi.fn(),
                readMutation: vi.fn(),
                listRevisions: vi.fn(),
                resolveSource: vi.fn(),
                commit,
                now: () => '2026-10-24T00:00:00Z',
            },
            resolveAccess: async () => ({
                userId: 'user',
                organizationId: 'org',
                workspaceId: 'workspace',
            }),
            exportSequence,
            resolveSourceSelection: resolve,
            capabilityStorage: {
                storeResource: vi.fn(),
                seedBuiltInCapability: vi.fn(),
            },
        })
        const tool = module.agentTools!.find(tool => tool.name === 'resolve_sequence_source')!
        const input = {
            sourceId: 'blue',
            assetId: 'blue-image',
        }
        expect(validateJsonSchemaValue(tool.schema, input).valid).toBe(true)
        expect(await tool.execute(input, {} as never)).toMatchObject({
            status: 'completed',
            data: {
                renditionId: 'original',
                blobHash: 'image-hash',
            },
        })
        expect(resolve).toHaveBeenCalledWith(expect.anything(), {
            ...input,
            renditionId: 'original',
        })
        expect(commit).not.toHaveBeenCalled()
        expect(exportSequence).not.toHaveBeenCalled()
        resolve.mockRejectedValueOnce(new Error('MEDIA_SEQUENCE_SOURCE_UNAVAILABLE'))
        await expect(tool.execute({
            ...input,
            renditionId: 'source',
        }, {} as never)).resolves.toMatchObject({
            status: 'error',
            error: {
                code: 'MEDIA_SEQUENCE_SOURCE_UNAVAILABLE',
                recoverable: true,
            },
        })
        expect(resolve).toHaveBeenLastCalledWith(expect.anything(), {
            ...input,
            renditionId: 'source',
        })
        resolve.mockRejectedValueOnce(new Error('AGENT_CONTEXT_CHANGED'))
        await expect(tool.execute(input, {} as never)).rejects.toThrow('AGENT_CONTEXT_CHANGED')
    })

    it('returns model-correctable edit and export rejections as recoverable tool results', async () => {
        const authorize = vi.fn(async () => {
            throw new Error('MEDIA_SEQUENCE_TRACK_LOCKED:video-1')
        })
        const exportSequence = vi.fn(async () => {
            throw new Error('MEDIA_RENDER_INVALID_PRESET')
        })
        const module = createMediaSequenceModule({
            ports: {
                authorize,
                load: vi.fn(),
                readMutation: vi.fn(),
                listRevisions: vi.fn(),
                resolveSource: vi.fn(),
                commit: vi.fn(),
                now: () => '2026-10-24T00:00:00Z',
            },
            resolveAccess: async () => ({
                userId: 'user',
                organizationId: 'org',
                workspaceId: 'workspace',
                origin: {
                    kind: 'conversation',
                    conversationAssetId: 'conversation',
                    turnId: 'turn',
                    operationId: 'operation',
                },
            }),
            exportSequence,
            resolveSourceSelection: vi.fn(),
            capabilityStorage: {
                storeResource: vi.fn(),
                seedBuiltInCapability: vi.fn(),
            },
        })
        const patch = module.agentTools!.find(tool => tool.name === 'patch_sequence')!
        const exporter = module.agentTools!.find(tool => tool.name === 'export_sequence')!
        const patchInput = {
            sequenceId: 'sequence',
            baseRevision: 1,
            clientMutationId: 'mutation',
            operations: [{
                op: 'set-properties',
                values: { width: 320 },
            }],
        }
        const exportInput = {
            sequenceId: 'sequence',
            revision: 2,
            clientMutationId: 'export',
            preset: { presetId: 'mp4-h264-aac' },
        }

        await expect(patch.execute(patchInput, {} as never)).resolves.toMatchObject({
            status: 'error',
            error: {
                code: 'MEDIA_SEQUENCE_TRACK_LOCKED',
                recoverable: true,
            },
        })
        await expect(exporter.execute(exportInput, {} as never)).resolves.toMatchObject({
            status: 'error',
            error: {
                code: 'MEDIA_RENDER_INVALID_PRESET',
                recoverable: true,
            },
        })
        authorize.mockRejectedValueOnce(new Error('MEDIA_SEQUENCE_EDITING_UNAVAILABLE'))
        await expect(patch.execute(patchInput, {} as never)).rejects.toThrow('MEDIA_SEQUENCE_EDITING_UNAVAILABLE')
        exportSequence.mockRejectedValueOnce(new Error('MEDIA_RENDER_TENANT_MISMATCH'))
        await expect(exporter.execute(exportInput, {} as never)).rejects.toThrow('MEDIA_RENDER_TENANT_MISMATCH')
    })

    it('seeds manifests accepted by the production Capability validator', async () => {
        const saved: CapabilityManifest[] = []
        const module = createMediaSequenceModule({
            ports: {
                authorize: vi.fn(),
                load: vi.fn(),
                readMutation: vi.fn(),
                listRevisions: vi.fn(),
                resolveSource: vi.fn(),
                commit: vi.fn(),
                now: () => '2026-10-24T00:00:00Z',
            },
            resolveAccess: vi.fn(),
            exportSequence: vi.fn(),
            resolveSourceSelection: vi.fn(),
            capabilityStorage: {
                storeResource: async resource => ({
                    resourceId: resource.resourceId,
                    blobHash: createHash('sha256').update(resource.bytes).digest('hex'),
                    mediaType: resource.mediaType,
                    role: resource.role,
                    name: resource.name,
                }),
                seedBuiltInCapability: async input => {
                    const validation = validateCapabilityManifest(input.manifest, { allowedActions: input.allowedActions })
                    expect(validation.issues).toEqual([])
                    expect(validation.valid).toBe(true)
                    saved.push(input.manifest)
                },
            },
        })
        const context = {
            parentModuleId: module.moduleId,
            catalogExposure: 'module-internal' as const,
            allowedActions: new Set(['media-sequence.execute']),
        }

        for (const skill of module.skills)
            await skill.seed(context)

        for (const tool of module.tools)
            await tool.seed(context)

        expect(saved).toHaveLength(2)
        expect(saved.find(manifest => manifest.kind === 'tool')?.tool?.modelAxisPolicy).toEqual({
            reasoning: 'ignore',
            image: 'ignore',
            video: 'ignore',
            outputMode: 'capability-only',
        })
        expect(module.agentTools?.find(tool => tool.name === 'resolve_sequence_source')?.intent).toBe('inspect')
    })
})
