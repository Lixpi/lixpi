import {
    type WorkspaceMeta,
} from '@lixpi/constants'

import { WorkspaceNavigationReadFence } from './workspace-navigation-read-fence.ts'
import {
    type WorkspaceSubtreeEntry,
} from './subtree-outline.ts'
import {
    type WorkspaceTreeRepository,
} from './workspace-tree-repository.ts'

// Lists every heading and workspace under a workspace in outline order,
// depth first. Workspaces being deleted, and what is under them, are left out.
export const loadWorkspaceSubtree = async (
    repository: Pick<WorkspaceTreeRepository, 'listChildRows' | 'getWorkspaceMetas' | 'readNavigationFences'>,
    root: Pick<WorkspaceMeta, 'workspaceId' | 'organizationId'>,
): Promise<WorkspaceSubtreeEntry[]> =>
    await new WorkspaceNavigationReadFence(repository).run([root.organizationId], async () => await loadWorkspaceSubtreeUnfenced(repository, root))

const loadWorkspaceSubtreeUnfenced = async (
    repository: Pick<WorkspaceTreeRepository, 'listChildRows' | 'getWorkspaceMetas'>,
    root: Pick<WorkspaceMeta, 'workspaceId' | 'organizationId'>,
): Promise<WorkspaceSubtreeEntry[]> => {
    const entries: WorkspaceSubtreeEntry[] = []

    const visit = async (
        parentWorkspaceId: string,
        depth: number,
    ): Promise<void> => {
        const rows = await repository.listChildRows(root.organizationId, parentWorkspaceId)
        const metas = new Map(
            (await repository.getWorkspaceMetas(
                rows.filter(row => row.entryType === 'workspace').map(row => row.entryId),
            )).map(meta => [meta.workspaceId, meta]),
        )

        for (const row of rows) {
            if (row.entryType === 'heading') {
                entries.push({
                    entryType: 'heading',
                    id: row.entryId,
                    name: row.name ?? '',
                    depth,
                    level: row.level ?? 1,
                    ...(row.note ? { note: row.note } : {}),
                    parentWorkspaceId,
                })

                continue
            }

            const meta = metas.get(row.entryId)

            if (
                !meta
                || meta.deletingAt !== undefined
            )
                continue

            entries.push({
                entryType: 'workspace',
                id: meta.workspaceId,
                name: meta.name,
                depth,
                ...(meta.note ? { note: meta.note } : {}),
                parentWorkspaceId,
            })
            await visit(meta.workspaceId, depth + 1)
        }
    }

    await visit(root.workspaceId, 1)

    return entries
}
