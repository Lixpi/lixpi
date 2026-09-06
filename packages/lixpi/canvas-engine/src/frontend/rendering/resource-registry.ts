import {
    type Dispose,
} from '../../shared/index.ts'
import {
    type ResourceHandle,
    type ResourceKind,
} from './resources.ts'

type ResourceEntry = {
    value: unknown
    dispose: Dispose
    dependencies: Set<ResourceHandle>
    dependents: Set<ResourceHandle>
    children: Set<ResourceHandle>
    parent?: ResourceHandle
    released: boolean
}

// Handles are compared by identity, so copying an id/owner cannot forge access.
export class ResourceRegistry {
    private readonly owner = Symbol('canvas-resources')
    private readonly entries = new Map<ResourceHandle, ResourceEntry>()
    private readonly retired = new WeakSet<ResourceHandle>()
    private counter = 0
    private destroyed = false

    constructor(private readonly retire: (dispose: Dispose) => void) {}

    add<Kind extends ResourceKind>(
        kind: Kind,
        value: unknown,
        dispose: Dispose,
        options: {
            parent?: ResourceHandle
            dependencies?: readonly ResourceHandle[]
        } = {},
    ): ResourceHandle<Kind> {
        if (this.destroyed)
            throw new Error('Canvas resources are disposed')

        const dependencies = new Set(options.dependencies)

        if (options.parent)
            this.entry(options.parent)

        for (const dependency of dependencies) this.entry(dependency)

        const handle = Object.freeze({
            id: `resource-${++this.counter}`,
            kind,
            owner: this.owner,
        })
        this.entries.set(
            handle,
            {
                value,
                dispose,
                dependencies,
                dependents: new Set(),
                children: new Set(),
                parent: options.parent,
                released: false,
            },
        )

        for (const dependency of dependencies) this.entries.get(dependency)!.dependents.add(handle)

        if (options.parent)
            this.entries.get(options.parent)!.children.add(handle)

        return handle
    }

    get<Value>(
        handle: ResourceHandle,
        kind: ResourceKind,
    ): Value {
        if (handle.kind !== kind)
            throw new Error(`Expected ${kind} resource`)

        return this.entry(handle).value as Value
    }

    replaceDependencies(
        handle: ResourceHandle,
        dependencies: readonly ResourceHandle[],
    ): void {
        const entry = this.entry(handle)
        const next = new Set(dependencies)

        for (const dependency of next) {
            this.entry(dependency)

            if (
                dependency === handle
                || this.dependsOn(dependency, handle)
            )
                throw new Error('Cyclic resource dependency')
        }

        const previous = entry.dependencies
        entry.dependencies = next

        for (const dependency of next) this.entries.get(dependency)!.dependents.add(handle)

        for (const dependency of previous) {
            if (next.has(dependency))
                continue

            this.entries.get(dependency)?.dependents.delete(handle)
            this.collect(dependency)
        }
    }

    release(handle: ResourceHandle): void {
        if (this.retired.has(handle))
            return

        const entry = this.entries.get(handle)

        if (
            !entry
            || handle.owner !== this.owner
        )
            throw new Error('Unknown canvas resource')

        if (entry.released)
            return

        entry.released = true

        for (const child of Array.from(entry.children)) this.release(child)

        this.collect(handle)
    }

    private entry(handle: ResourceHandle): ResourceEntry {
        const entry = this.entries.get(handle)

        if (
            handle.owner !== this.owner
            || !entry
            || entry.released
        )
            throw new Error('Unknown or released canvas resource')

        return entry
    }

    private dependsOn(
        source: ResourceHandle,
        target: ResourceHandle,
        visited = new Set<ResourceHandle>(),
    ): boolean {
        if (visited.has(source))
            return false

        visited.add(source)

        for (const dependency of this.entries.get(source)?.dependencies ?? []) {
            if (
                dependency === target
                || this.dependsOn(
                    dependency,
                    target,
                    visited,
                )
            )
                return true
        }

        return false
    }

    private collect(handle: ResourceHandle): void {
        const entry = this.entries.get(handle)

        if (
            !entry?.released
            || entry.dependents.size > 0
            || entry.children.size > 0
        )
            return

        this.entries.delete(handle)
        this.retired.add(handle)
        // Physical destruction is queued by the backend after submitted GPU work settles.
        this.retire(entry.dispose)

        for (const dependency of entry.dependencies) {
            this.entries.get(dependency)?.dependents.delete(handle)
            this.collect(dependency)
        }

        if (entry.parent) {
            this.entries.get(entry.parent)?.children.delete(handle)
            this.collect(entry.parent)
        }
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true

        for (const handle of Array.from(
            this.entries.keys(),
        ).reverse()) this.release(handle)
    }
}
