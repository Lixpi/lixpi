import {
    type CanvasEnginePoint,
    type CanvasEngineRect,
    type Dispose,
} from '../../shared/index.ts'
import {
    type Lifetime,
} from '../runtime/lifetime.ts'
import {
    type CanvasLayer,
    type CaptureResource,
    type CaptureSpec,
    type DrawingResources,
    type DrawingSpace,
    type GroupTransform,
    type MaterialBinding,
    type MaterialProgram,
    type MeshData,
    type PaintHandle,
    type ResourceHandle,
    type TextureInput,
    type VectorShape,
} from './resources.ts'

// A component can sample borrowed resources, but can only mutate or release
// allocations made through its own scope.
export class ScopedDrawingResources implements DrawingResources {
    private readonly owned = new Map<ResourceHandle, Dispose>()
    private readonly released = new WeakSet<ResourceHandle>()

    constructor(private readonly backend: DrawingResources, private readonly lifetime: Lifetime) {}

    private live(): void {
        if (this.lifetime.signal.aborted) throw new Error('Drawing scope is disposed')
    }

    private own<Handle extends ResourceHandle>(handle: Handle): Handle {
        const release = this.lifetime.own(() => {
            this.owned.delete(handle)
            this.released.add(handle)
            this.backend.release(handle)
        })
        this.owned.set(handle, release)
        return handle
    }

    private requireOwned(handle: ResourceHandle): void {
        this.live()
        if (!this.owned.has(handle)) throw new Error('Drawing scope cannot modify a borrowed resource')
    }

    createGroup(options: { space: DrawingSpace; layer: CanvasLayer | ResourceHandle<'group'> }): ResourceHandle<'group'> {
        this.live()
        if (options.layer.kind === 'group') this.requireOwned(options.layer)
        return this.own(this.backend.createGroup(options))
    }

    updateGroup(group: ResourceHandle<'group'>, transform: Partial<GroupTransform>): void {
        this.requireOwned(group)
        this.backend.updateGroup(group, transform)
    }

    setVisible(resource: ResourceHandle<'group' | 'mesh' | 'path'>, visible: boolean): void {
        this.requireOwned(resource)
        this.backend.setVisible(resource, visible)
    }

    createTexture(input: TextureInput): ResourceHandle<'texture'> {
        this.live()
        return this.own(this.backend.createTexture(input))
    }

    updateTexture(texture: ResourceHandle<'texture'>, input: TextureInput): void {
        this.requireOwned(texture)
        this.backend.updateTexture(texture, input)
    }

    createMaterial(program: MaterialProgram): ResourceHandle<'material'> {
        this.live()
        return this.own(this.backend.createMaterial(program))
    }

    updateMaterial(material: ResourceHandle<'material'>, bindings: readonly MaterialBinding[]): void {
        this.requireOwned(material)
        this.backend.updateMaterial(material, bindings)
    }

    createMesh(group: ResourceHandle<'group'>, data: MeshData, paint: PaintHandle): ResourceHandle<'mesh'> {
        this.requireOwned(group)
        return this.own(this.backend.createMesh(group, data, paint))
    }

    updateMesh(mesh: ResourceHandle<'mesh'>, data: MeshData): void {
        this.requireOwned(mesh)
        this.backend.updateMesh(mesh, data)
    }

    setPaint(mesh: ResourceHandle<'mesh'>, paint: PaintHandle): void {
        this.requireOwned(mesh)
        this.backend.setPaint(mesh, paint)
    }

    createPath(group: ResourceHandle<'group'>, shapes: readonly VectorShape[]): ResourceHandle<'path'> {
        this.requireOwned(group)
        return this.own(this.backend.createPath(group, shapes))
    }

    updatePath(path: ResourceHandle<'path'>, shapes: readonly VectorShape[]): void {
        this.requireOwned(path)
        this.backend.updatePath(path, shapes)
    }

    setMask(group: ResourceHandle<'group'>, mask: ResourceHandle<'path'> | null): void {
        this.requireOwned(group)
        this.backend.setMask(group, mask)
    }

    capture(input: CaptureSpec): CaptureResource {
        this.live()
        const capture = this.backend.capture(input)
        this.own(capture.handle)
        return capture
    }

    updateCapture(capture: ResourceHandle<'capture'>, input: CaptureSpec): void {
        this.requireOwned(capture)
        this.backend.updateCapture(capture, input)
    }

    displace(group: ResourceHandle<'group'>, source: ResourceHandle<'texture'>, map: ResourceHandle<'texture'>, options: { bounds: CanvasEngineRect; scale: CanvasEnginePoint }): Dispose {
        this.requireOwned(group)
        return this.lifetime.own(this.backend.displace(group, source, map, options))
    }

    release(resource: ResourceHandle): void {
        if (this.released.has(resource)) return
        // Abort listeners dispose their component before lifetime cleanup runs.
        // Releasing owned resources remains valid after abort; mutations do not.
        if (!this.owned.has(resource)) throw new Error('Drawing scope cannot release a borrowed resource')
        this.owned.get(resource)!()
    }
}
