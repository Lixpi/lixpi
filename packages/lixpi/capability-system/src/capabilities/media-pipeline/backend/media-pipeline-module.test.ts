import { describe, expect, it, vi } from 'vitest'

import { CapabilityActionRegistry } from '../../../backend/capability-action-registry.ts'
import { CapabilityModuleCatalog } from '../../../backend/capability-module.ts'
import { validateCapabilityManifest } from '../../../shared/capability-validation.ts'
import {
    createMediaPipelineModule,
    type MediaPipelineModuleDependencies,
    type MediaPipelineModuleExtension,
} from './media-pipeline-module.ts'

describe('media pipeline module installation', () => {
    it('owns sealed Tools and its Skill and publishes a typed runtime extension', async () => {
        const seedBuiltInCapability = vi.fn(async input => {
            const validation = validateCapabilityManifest(input.manifest, { allowedActions: input.allowedActions })
            expect(validation).toMatchObject({ valid: true })
        })
        const dependencies: MediaPipelineModuleDependencies = {
            ports: {} as MediaPipelineModuleDependencies['ports'],
            resolveContext: async () => undefined,
            capabilityStorage: {
                storeResource: async input => ({
                    resourceId: input.resourceId,
                    blobHash: 'test-hash',
                    mediaType: input.mediaType,
                    role: input.role,
                    name: input.name,
                }),
                seedBuiltInCapability,
            },
        }
        const modules = new CapabilityModuleCatalog()
        const actions = new CapabilityActionRegistry()
        modules.registerModule(createMediaPipelineModule(dependencies))
        modules.registerActions(actions)
        await modules.seedAll(actions)
        expect(seedBuiltInCapability).toHaveBeenCalledTimes(7)

        for (const call of seedBuiltInCapability.mock.calls)
            expect(call[0]).toMatchObject({
                parentModuleId: 'media-pipeline',
                catalogExposure: 'module-internal',
            })

        expect([...actions.allowedActionKeys()]).toEqual(['media-pipeline.get', 'media-pipeline.save', 'media-pipeline.save-matrix', 'media-pipeline.prepare-matrix', 'media-pipeline.submit', 'media-pipeline.retry'])
        expect(modules.listAgentTools().map(tool => [tool.name, tool.intent, tool.operationFamilies])).toEqual([
            ['list_pipeline_operations', 'inspect', []],
            ['get_pipeline', 'inspect', []], ['save_pipeline', 'plan', []], ['save_pipeline_matrix', 'plan', []], ['prepare_pipeline_matrix', 'plan', []], ['submit_pipeline', 'execute', []],
            ['retry_pipeline', 'execute', []],
        ])
        expect(modules.getExtension<MediaPipelineModuleExtension>('media-pipeline', 'media-pipeline')?.tools.map(tool => tool.name)).toEqual(['get_pipeline', 'save_pipeline', 'save_pipeline_matrix', 'prepare_pipeline_matrix', 'submit_pipeline', 'retry_pipeline'])
        expect(actions.get('media-pipeline.save').validateInput({ request: {
            baseRevision: 0,
            clientMutationId: 'mutation',
            patch: { requestedOutcome: 'Requested change.' },
        } })).toEqual({ valid: true })
        expect(actions.get('media-pipeline.submit').validateInput({ request: {
            pipelineId: 'pipeline-1',
            revision: 1,
            clientSubmissionId: 'submit',
            authority: 'forged',
        } })).toMatchObject({ valid: false })
    })

    it('rejects a resolver context bound to another account', async () => {
        const modules = new CapabilityModuleCatalog()
        const actions = new CapabilityActionRegistry()
        modules.registerModule(createMediaPipelineModule({
            ports: {} as MediaPipelineModuleDependencies['ports'],
            capabilityStorage: {} as MediaPipelineModuleDependencies['capabilityStorage'],
            resolveContext: async () => ({
                userId: 'another-user',
                organizationId: 'org',
                workspaceId: 'workspace',
                conversationAssetId: 'conversation',
                turnId: 'turn',
                responseMessageId: 'response',
                runId: 'run',
                epoch: 1,
                continuationEpoch: 1,
                authority: 'scope',
            }),
        }))
        modules.registerActions(actions)
        expect(await actions.get('media-pipeline.submit').authorize({
            userId: 'user',
            organizationId: 'org',
            workspaceId: 'workspace',
            conversationAssetId: 'conversation',
            rootCapabilityId: 'global.submit-pipeline',
            runId: 'run',
            origin: 'model',
            variant: {
                axis: 'request',
                variantKey: 'request',
            },
        }, {})).toBe(false)
    })
})
