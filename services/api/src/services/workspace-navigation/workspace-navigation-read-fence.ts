import { WORKSPACE_TREE_ERROR } from '@lixpi/constants'
import { WorkspaceTreeError } from './workspace-tree-errors.ts'
import {
    type WorkspaceTreeRepository,
} from './workspace-tree-repository.ts'

// Every bulk projection is unpublished while its organization lock exists.
// Each side of the fence reads every organization's lock and navigation head
// in one consistent read. Comparing the heads on both sides also detects an
// operation that starts and finishes between them, when neither lock read
// would otherwise see it.
export class WorkspaceNavigationReadFence {
    constructor(private readonly repository: Pick<WorkspaceTreeRepository, 'readNavigationFences'>) {}

    async run<Result>(
        organizationIds: string[],
        read: () => Promise<Result>,
    ): Promise<Result> {
        const ids = [...new Set(organizationIds)]

        if (!ids.length)
            return await read()

        const before = await this.repository.readNavigationFences(ids)

        if ([...before.values()].some(fence => fence.locked))
            throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.BUSY)

        const result = await read()
        const after = await this.repository.readNavigationFences(ids)

        for (const organizationId of ids) {
            const fence = after.get(organizationId)

            if (
                !fence
                || fence.locked
                || fence.revisionId !== before.get(organizationId)?.revisionId
            )
                throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.BUSY)
        }

        return result
    }
}
