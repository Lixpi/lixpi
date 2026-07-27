'use strict'

import {
    NATS_SUBJECTS,
    type PromptReferenceCategory,
} from '@lixpi/constants'
import type { CapabilityModuleCatalog } from '@lixpi/capability-system/backend'

import Workspace from '../../models/workspace.ts'
import PromptReferenceRecentModel from '../../models/prompt-reference-recent.ts'
import { getAssetRequesterContext } from '../../services/asset-requester-context.ts'
import { PromptReferenceCatalogService } from '../../services/prompt-reference-catalog-service.ts'

const { CAPABILITY_SUBJECTS, PROMPT_REFERENCE_SUBJECTS } = NATS_SUBJECTS
const VALID_CATEGORIES = new Set<PromptReferenceCategory>(['media', 'artifacts', 'capabilities', 'tools', 'skills'])

let moduleCatalog: CapabilityModuleCatalog | undefined

export function setPromptReferenceModuleCatalog(catalog: CapabilityModuleCatalog): void {
    moduleCatalog = catalog
}

function getModuleCatalog(): CapabilityModuleCatalog {
    if (!moduleCatalog) throw new Error('CAPABILITY_MODULE_CATALOG_NOT_INITIALIZED')
    return moduleCatalog
}

export const promptReferenceSubjects = [
    {
        subject: CAPABILITY_SUBJECTS.MODULES.LIST,
        type: 'reply',
        payloadType: 'json',
        permissions: { pub: { allow: [CAPABILITY_SUBJECTS.MODULES.LIST] }, sub: { allow: [] } },
        handler: async (data: any) => {
            const userId = data.user.userId as string
            const [workspace, requester] = await Promise.all([
                Workspace.getWorkspace({ userId, workspaceId: data.workspaceId }),
                getAssetRequesterContext(userId),
            ])
            if ('error' in workspace || workspace.deletingAt) return { error: 'WORKSPACE_ACCESS_DENIED' }
            const service = new PromptReferenceCatalogService(getModuleCatalog())
            return { items: await service.listModules(requester, typeof data.query === 'string' ? data.query : '') }
        },
    },
    {
        subject: CAPABILITY_SUBJECTS.MODULES.GET,
        type: 'reply',
        payloadType: 'json',
        permissions: { pub: { allow: [CAPABILITY_SUBJECTS.MODULES.GET] }, sub: { allow: [] } },
        handler: async (data: any) => {
            const userId = data.user.userId as string
            const [workspace, requester] = await Promise.all([
                Workspace.getWorkspace({ userId, workspaceId: data.workspaceId }),
                getAssetRequesterContext(userId),
            ])
            if ('error' in workspace || workspace.deletingAt) return { error: 'WORKSPACE_ACCESS_DENIED' }
            const module = await new PromptReferenceCatalogService(getModuleCatalog())
                .getModule(requester, data.moduleId)
            return module ?? { error: 'CAPABILITY_MODULE_NOT_FOUND' }
        },
    },
    {
        subject: PROMPT_REFERENCE_SUBJECTS.LIST,
        type: 'reply',
        payloadType: 'json',
        permissions: { pub: { allow: [PROMPT_REFERENCE_SUBJECTS.LIST] }, sub: { allow: [] } },
        handler: async (data: any) => {
            try {
                const category = data.category as PromptReferenceCategory
                if (!VALID_CATEGORIES.has(category)) throw new Error('INVALID_PROMPT_REFERENCE_CATEGORY')
                const userId = data.user.userId as string
                const [workspace, requester] = await Promise.all([
                    Workspace.getWorkspace({ userId, workspaceId: data.workspaceId }),
                    getAssetRequesterContext(userId),
                ])
                if ('error' in workspace || workspace.deletingAt) throw new Error('WORKSPACE_ACCESS_DENIED')
                return await new PromptReferenceCatalogService(getModuleCatalog()).list({
                    workspace,
                    requester,
                    category,
                    query: typeof data.query === 'string' ? data.query : '',
                    limit: typeof data.limit === 'number' ? data.limit : undefined,
                    cursor: typeof data.cursor === 'string' ? data.cursor : undefined,
                })
            } catch (error) {
                return { error: (error as Error).message }
            }
        },
    },
    {
        subject: PROMPT_REFERENCE_SUBJECTS.RECORD_ACCEPTED_USE,
        type: 'reply',
        payloadType: 'json',
        permissions: { pub: { allow: [] }, sub: { allow: [] } },
        handler: async (data: any) => {
            await PromptReferenceRecentModel.recordAccepted({
                userId: data.user.userId,
                references: data.references ?? [],
            })
            return { success: true }
        },
    },
] as const
