import {
    type UserWorkspaceTrees,
    type WorkspaceTree,
} from '@lixpi/constants'

type Listener = (trees: UserWorkspaceTrees) => void

// A pending optimistic change. Rolling it back restores the trees from
// before the change unless the server has replaced them since.
export type WorkspaceTreeChangeToken = {
    revision: number
    previous: UserWorkspaceTrees
}

// Holds the user's workspace trees. Changes show at once and are replaced
// by the server's reply, or rolled back when the server rejects them.
export class WorkspaceTreeStore {
    private trees: UserWorkspaceTrees = { organizations: [] }
    private revision = 0
    private readonly listeners = new Set<Listener>()

    get current(): UserWorkspaceTrees {
        return this.trees
    }

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener)
        listener(this.trees)

        return () => this.listeners.delete(listener)
    }

    private set(trees: UserWorkspaceTrees): void {
        this.trees = trees
        this.revision += 1

        for (const listener of this.listeners)
            listener(trees)
    }

    replaceAll(trees: UserWorkspaceTrees): void {
        this.set(trees)
    }

    // Replaces one organization's tree with the server's copy.
    replace(tree: WorkspaceTree): void {
        const organizations = this.trees.organizations.some(existing => existing.organizationId === tree.organizationId)
            ? this.trees.organizations.map(existing => existing.organizationId === tree.organizationId ? tree : existing)
            : [...this.trees.organizations, tree]
        this.set({ organizations })
    }

    apply(
        organizationId: string,
        change: (tree: WorkspaceTree) => WorkspaceTree,
    ): WorkspaceTreeChangeToken {
        const previous = this.trees
        this.set({
            organizations: this.trees.organizations.map(tree => tree.organizationId === organizationId ? change(tree) : tree),
        })

        return {
            revision: this.revision,
            previous,
        }
    }

    rollback(token: WorkspaceTreeChangeToken): void {
        if (token.revision === this.revision)
            this.set(token.previous)
    }
}

// Shared by the workspace service and the navigation panel.
export const workspaceTreeStore = new WorkspaceTreeStore()
