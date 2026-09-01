'use strict'

import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { NATS_SUBJECTS } from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    getWorkspace: vi.fn(),
    getOrganization: vi.fn(),
    getRequester: vi.fn(),
    listReferences: vi.fn(),
    listModules: vi.fn(),
    getModule: vi.fn(),
    recordAccepted: vi.fn(),
}))

vi.mock('../../models/workspace.ts', () => ({
    default: { getWorkspace: mocks.getWorkspace },
}))
vi.mock('../../models/organization.ts', () => ({
    default: { getOrganization: mocks.getOrganization },
}))
vi.mock('../../models/prompt-reference-recent.ts', () => ({
    default: { recordAccepted: mocks.recordAccepted },
}))
vi.mock('../../services/asset-requester-context.ts', () => ({
    getAssetRequesterContext: mocks.getRequester,
}))
vi.mock('../../services/prompt-reference-catalog-service.ts', () => ({
    PromptReferenceCatalogService: class {
        list = mocks.listReferences
        listModules = mocks.listModules
        getModule = mocks.getModule
    },
}))

import {
    promptReferenceSubjects,
    setPromptReferenceModuleCatalog,
} from './prompt-reference-subjects.ts'

const { MODULES } = NATS_SUBJECTS.CAPABILITY_SUBJECTS
const { LIST } = NATS_SUBJECTS.PROMPT_REFERENCE_SUBJECTS
const handler = (subject: string) => promptReferenceSubjects.find(candidate => candidate.subject === subject)!.handler
const moduleMeta = {
    moduleId: 'character-creator',
    name: 'Character Creator',
    normalizedName: 'character creator',
    summary: 'Character sheets.',
    tags: ['character'],
    status: 'active' as const,
}
const moduleCatalog = {
    listModules: vi.fn(() => [moduleMeta]),
    getModule: vi.fn(() => ({
        ...moduleMeta,
        entry: { capabilityId: 'global.character-creator', kind: 'tool' },
        tools: [{ capabilityId: 'global.character-creator' }],
        skills: [{ capabilityId: 'global.character-sheet-layout' }],
    })),
    getModuleMeta: vi.fn(() => moduleMeta),
}

beforeEach(() => {
    vi.clearAllMocks()
    setPromptReferenceModuleCatalog(moduleCatalog as any)
    mocks.getWorkspace.mockResolvedValue({
        workspaceId: 'workspace-1',
        organizationId: 'organization-1',
        accessList: [{ userId: 'user-1', accessLevel: 'owner' }],
        canvasState: { nodes: [], edges: [] },
    })
    mocks.getOrganization.mockResolvedValue({ organizationId: 'organization-1' })
    mocks.getRequester.mockResolvedValue({
        userId: 'user-1',
        workspaceIds: ['workspace-1'],
        editableWorkspaceIds: ['workspace-1'],
        organizationIds: ['organization-1'],
    })
    mocks.listReferences.mockResolvedValue({ items: [] })
    mocks.listModules.mockResolvedValue([moduleMeta])
    mocks.getModule.mockResolvedValue({
        meta: moduleMeta,
        entry: { capabilityId: 'global.character-creator', kind: 'tool' },
    })
})

describe('prompt-reference transport', () => {
    it('requires Workspace access before listing top-level modules', async () => {
        const allowed = await handler(MODULES.LIST)({ user: { userId: 'user-1' }, workspaceId: 'workspace-1' })
        expect(allowed).toEqual({ items: [moduleMeta] })
        expect(allowed).not.toHaveProperty('tools')
        expect(allowed).not.toHaveProperty('skills')

        mocks.getWorkspace.mockResolvedValueOnce({ error: 'WORKSPACE_NOT_FOUND' })
        await expect(handler(MODULES.LIST)({ user: { userId: 'user-2' }, workspaceId: 'workspace-1' }))
            .resolves.toEqual({ error: 'WORKSPACE_ACCESS_DENIED' })
    })

    it('returns only the module entry identity from module get', async () => {
        const result = await handler(MODULES.GET)({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
            moduleId: 'character-creator',
        })

        expect(result).toEqual({
            meta: moduleMeta,
            entry: { capabilityId: 'global.character-creator', kind: 'tool' },
        })
    })

    it('routes valid categories and rejects invalid category or cursor input through the catalog service', async () => {
        await handler(LIST)({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
            category: 'media',
            query: 'portrait',
            cursor: 'opaque',
        })
        expect(mocks.listReferences).toHaveBeenCalledWith(expect.objectContaining({
            category: 'media',
            query: 'portrait',
            cursor: 'opaque',
        }))

        await expect(
            handler(LIST)({
                user: { userId: 'user-1' },
                workspaceId: 'workspace-1',
                category: 'internal-tools',
            }),
        ).resolves.toEqual({ error: 'INVALID_PROMPT_REFERENCE_CATEGORY' })
    })

    it('does not grant browsers direct access to accepted-use recording', () => {
        const accepted = promptReferenceSubjects.find(candidate => candidate.subject === NATS_SUBJECTS.PROMPT_REFERENCE_SUBJECTS.RECORD_ACCEPTED_USE)!
        expect(accepted.permissions.pub.allow).toEqual([])
    })
})
