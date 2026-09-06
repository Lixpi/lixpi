import {
    NATS_SUBJECTS,
    type PromptReferenceCategory,
} from '@lixpi/constants'
import {
    type CapabilityModuleCatalog,
} from '@lixpi/capability-system/backend'

import Workspace from '../../models/workspace.ts'
import Organization from '../../models/organization.ts'
import PromptReferenceRecentModel from '../../models/prompt-reference-recent.ts'
import { PromptReferenceCatalogService } from '../../services/prompt-reference-catalog-service.ts'
import { createAssetRequesterForWorkspaceUser } from '../../services/workspace-reference-scope.ts'

const {
    CAPABILITY_SUBJECTS,
    PROMPT_REFERENCE_SUBJECTS,
} = NATS_SUBJECTS
const VALID_CATEGORIES = new Set<PromptReferenceCategory>([
    'media',
    'artifacts',
    'capabilities',
    'tools',
    'skills',
])

let moduleCatalog: CapabilityModuleCatalog | undefined

export const setPromptReferenceModuleCatalog = (catalog: CapabilityModuleCatalog): void => void (moduleCatalog = catalog)

const getModuleCatalog = (): CapabilityModuleCatalog => {
    if (!moduleCatalog)
        throw new Error('CAPABILITY_MODULE_CATALOG_NOT_INITIALIZED')

    return moduleCatalog
}

const getWorkspaceCatalogContext = async (
    userId: string,
    workspaceId: string,
) => {
    const workspace = await Workspace.getWorkspace({
        userId,
        workspaceId,
    })

    if (
        'error' in workspace
        || workspace.deletingAt
    )
        return { error: 'WORKSPACE_ACCESS_DENIED' as const }

    const organization = await Organization.getOrganization({
        organizationId: workspace.organizationId,
        userId,
    })

    if ('error' in organization)
        return { error: 'ORGANIZATION_ACCESS_DENIED' as const }

    return {
        workspace,
        requester: createAssetRequesterForWorkspaceUser(
            workspace,
            userId,
            true,
        ),
    }
}

export const promptReferenceSubjects = [
    {
        subject: CAPABILITY_SUBJECTS.MODULES.LIST,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [CAPABILITY_SUBJECTS.MODULES.LIST] },
            sub: { allow: [] },
        },
        handler: async (data: any) => {
            const userId = data.user.userId as string
            const context = await getWorkspaceCatalogContext(userId, data.workspaceId)

            if ('error' in context)
                return context

            const service = new PromptReferenceCatalogService(
                getModuleCatalog(),
            )

            return {
                items: await service.listModules(
                    context.workspace,
                    context.requester,
                    typeof data.query === 'string' ? data.query : '',
                ),
            }
        },
    },
    {
        subject: CAPABILITY_SUBJECTS.MODULES.GET,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [CAPABILITY_SUBJECTS.MODULES.GET] },
            sub: { allow: [] },
        },
        handler: async (data: any) => {
            const userId = data.user.userId as string
            const context = await getWorkspaceCatalogContext(userId, data.workspaceId)

            if ('error' in context)
                return context

            const module = await new PromptReferenceCatalogService(
                getModuleCatalog(),
            )
                .getModule(
                    context.workspace,
                    context.requester,
                    data.moduleId,
                )

            return module ?? { error: 'CAPABILITY_MODULE_NOT_FOUND' }
        },
    },
    {
        subject: PROMPT_REFERENCE_SUBJECTS.LIST,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [PROMPT_REFERENCE_SUBJECTS.LIST] },
            sub: { allow: [] },
        },
        handler: async (data: any) => {
            try {
                const category = data.category as PromptReferenceCategory

                if (!VALID_CATEGORIES.has(category))
                    throw new Error('INVALID_PROMPT_REFERENCE_CATEGORY')

                const userId = data.user.userId as string
                const context = await getWorkspaceCatalogContext(userId, data.workspaceId)

                if ('error' in context)
                    throw new Error(context.error)

                return await new PromptReferenceCatalogService(
                    getModuleCatalog(),
                ).list({
                    workspace: context.workspace,
                    requester: context.requester,
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
        permissions: {
            pub: { allow: [] },
            sub: { allow: [] },
        },
        handler: async (data: any) => {
            await PromptReferenceRecentModel.recordAccepted({
                userId: data.user.userId,
                references: data.references ?? [],
            })

            return { success: true }
        },
    },
] as const
