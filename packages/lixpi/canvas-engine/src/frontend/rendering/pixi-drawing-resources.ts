'use strict'

import {
    Container,
    DisplacementFilter,
    Graphics,
    Matrix,
    RenderTexture,
    Sprite,
    Texture,
    type Renderer,
} from 'pixi.js'
import type {
    CanvasEnginePoint,
    CanvasEngineRect,
    CanvasViewport,
    Dispose,
} from '../../shared/index.ts'
import type {
    CanvasLayer,
    CaptureResource,
    CaptureSpec,
    DrawingResources,
    DrawingSpace,
    GroupTransform,
    MaterialBinding,
    MaterialProgram,
    MeshData,
    PaintHandle,
    ResourceHandle,
    TextureInput,
    VectorShape,
} from './resources.ts'
import { PixiMaterialResource } from './pixi-material-resource.ts'
import { PixiMeshResource } from './pixi-mesh-resource.ts'
import { PixiTextureResource } from './pixi-texture-resource.ts'
import { ResourceRegistry } from './resource-registry.ts'
import {
    dashVectorPath,
    projectVectorPath,
} from './pixi-vector-path.ts'

type Layer = { world: Container; screen: Container }
type Group = { container: Container; space: DrawingSpace }
type Capture = { spec: CaptureSpec; texture: RenderTexture; handle: ResourceHandle<'texture'>; dirty: boolean }
type TextureResource = { texture: Texture; update?: (input: TextureInput) => void }
type SceneChange = { bounds: CanvasEngineRect; ancestors: Set<Container> }

// This backend never leaves the package. Public drawing contexts expose only
// DrawingResources and handles, not this class or any Pixi object.
export class PixiDrawingResources implements DrawingResources {
    private readonly registry: ResourceRegistry
    private readonly layers = new Map<CanvasLayer, Layer>()
    private readonly captures = new Map<ResourceHandle<'capture'>, Capture>()
    private readonly captureTextures = new Set<ResourceHandle<'texture'>>()
    private readonly meshes = new Map<ResourceHandle<'mesh'>, PixiMeshResource>()
    private readonly samples = new Map<Container, readonly ResourceHandle<'texture'>[]>()
    private readonly materialTextures = new Map<ResourceHandle<'material'>, readonly ResourceHandle<'texture'>[]>()
    private readonly meshPaint = new Map<ResourceHandle<'mesh'>, PaintHandle>()
    private readonly masks = new Map<ResourceHandle<'group'>, ResourceHandle<'path'>>()
    private readonly changes = new Map<Container, SceneChange>()
    private viewport: CanvasViewport = { x: 0, y: 0, zoom: 1 }

    constructor(private readonly stage: Container, private readonly retire: (dispose: Dispose) => void, private readonly invalidate: () => void) {
        this.registry = new ResourceRegistry(retire)
    }

    addLayer(): CanvasLayer {
        const layer = { world: new Container(), screen: new Container() }
        layer.world.eventMode = 'none'
        layer.screen.eventMode = 'none'
        this.stage.addChild(layer.world, layer.screen)
        const handle = this.registry.add('layer', layer, () => {
            layer.world.destroy()
            layer.screen.destroy()
            this.layers.delete(handle)
        })
        this.layers.set(handle, layer)
        this.applyViewport(layer.world)
        return handle
    }

    setViewport(viewport: CanvasViewport): void {
        if (![viewport.x, viewport.y, viewport.zoom].every(Number.isFinite) || viewport.zoom <= 0) throw new RangeError('Viewport coordinates must be finite and zoom must be positive')
        this.viewport = { ...viewport }
        for (const layer of this.layers.values()) this.applyViewport(layer.world)
        this.invalidateCaptures()
        this.invalidate()
    }

    private applyViewport(container: Container): void {
        container.position.set(this.viewport.x, this.viewport.y)
        container.scale.set(this.viewport.zoom)
    }

    createGroup(options: { space: DrawingSpace; layer: CanvasLayer | ResourceHandle<'group'> }): ResourceHandle<'group'> {
        const container = new Container()
        container.eventMode = 'none'
        container.sortableChildren = true
        let parent: Container
        if (options.layer.kind === 'layer') parent = this.registry.get<Layer>(options.layer, 'layer')[options.space]
        else {
            const group = this.registry.get<Group>(options.layer, 'group')
            if (group.space !== options.space) throw new Error('Nested drawing groups must use the same coordinate space')
            parent = group.container
        }
        parent.addChild(container)
        const handle = this.registry.add('group', { container, space: options.space }, () => container.destroy(), { parent: options.layer })
        this.invalidate()
        return handle
    }

    updateGroup(handle: ResourceHandle<'group'>, transform: Partial<GroupTransform>): void {
        const { container } = this.registry.get<Group>(handle, 'group')
        const values = [transform.position?.x, transform.position?.y, transform.scale?.x, transform.scale?.y, transform.rotation, transform.order]
        if (values.some(value => value !== undefined && !Number.isFinite(value))) throw new RangeError('Group transforms must be finite')
        this.changed(container)
        if (transform.position) container.position.set(transform.position.x, transform.position.y)
        if (transform.scale) container.scale.set(transform.scale.x, transform.scale.y)
        if (transform.rotation !== undefined) container.rotation = transform.rotation
        if (transform.order !== undefined) container.zIndex = transform.order
        this.changed(container)
        this.invalidate()
    }

    private display(handle: ResourceHandle<'group' | 'mesh' | 'path'>): Container {
        if (handle.kind === 'group') return this.registry.get<Group>(handle, 'group').container
        if (handle.kind === 'mesh') return this.registry.get<PixiMeshResource>(handle, 'mesh').container
        return this.registry.get<Graphics>(handle, 'path')
    }

    setVisible(handle: ResourceHandle<'group' | 'mesh' | 'path'>, visible: boolean): void {
        const container = this.display(handle)
        if (container.renderable === visible) return
        this.changed(container)
        container.renderable = visible
        this.invalidate()
    }

    createTexture(input: TextureInput): ResourceHandle<'texture'> {
        return this.createOwnedTexture(input, () => {})
    }

    createOwnedTexture(input: TextureInput, releaseInput: Dispose): ResourceHandle<'texture'> {
        const resource = new PixiTextureResource(input)
        try {
            return this.registry.add('texture', { texture: resource.texture, update: (value: TextureInput) => resource.update(value) }, () => {
                resource.destroy()
                releaseInput()
            })
        } catch (error) {
            resource.destroy()
            throw error
        }
    }

    updateTexture(handle: ResourceHandle<'texture'>, input: TextureInput): void {
        const resource = this.registry.get<TextureResource>(handle, 'texture')
        if (!resource.update) throw new Error('Capture textures are read-only')
        resource.update(input)
        for (const [container, textures] of this.samples) if (textures.includes(handle)) this.changed(container)
        this.invalidate()
    }

    private texture = (handle: ResourceHandle<'texture'>): Texture => this.registry.get<TextureResource>(handle, 'texture').texture

    createMaterial(program: MaterialProgram): ResourceHandle<'material'> {
        const textures = this.bindingTextures(program.bindings)
        const material = new PixiMaterialResource(program, this.texture)
        const handle = this.registry.add('material', material, () => {
            material.destroy()
            this.materialTextures.delete(handle)
        }, { dependencies: textures })
        this.materialTextures.set(handle, textures)
        return handle
    }

    updateMaterial(handle: ResourceHandle<'material'>, bindings: readonly MaterialBinding[]): void {
        const material = this.registry.get<PixiMaterialResource>(handle, 'material')
        material.update(bindings)
        const textures = this.bindingTextures(bindings)
        this.registry.replaceDependencies(handle, textures)
        this.materialTextures.set(handle, textures)
        for (const [meshHandle, paint] of this.meshPaint) {
            if (paint !== handle) continue
            const container = this.meshes.get(meshHandle)!.container
            this.samples.set(container, textures)
            this.changed(container)
        }
        this.invalidate()
    }

    private bindingTextures(bindings: readonly MaterialBinding[]): ResourceHandle<'texture'>[] {
        return bindings.flatMap(binding => binding.kind === 'texture' ? [binding.texture] : [])
    }

    private paint(handle: PaintHandle): Texture | PixiMaterialResource {
        if (!handle) return Texture.EMPTY
        return handle.kind === 'texture' ? this.texture(handle) : this.registry.get<PixiMaterialResource>(handle, 'material')
    }

    createMesh(group: ResourceHandle<'group'>, data: MeshData, paint: PaintHandle): ResourceHandle<'mesh'> {
        const parent = this.registry.get<Group>(group, 'group').container
        const mesh = new PixiMeshResource(data, this.paint(paint), this.retire)
        parent.addChild(mesh.container)
        const handle = this.registry.add('mesh', mesh, () => {
            this.samples.delete(mesh.container)
            this.meshes.delete(handle)
            this.meshPaint.delete(handle)
            mesh.destroy()
        }, { parent: group, dependencies: paint ? [paint] : [] })
        this.meshes.set(handle, mesh)
        this.meshPaint.set(handle, paint)
        this.samples.set(mesh.container, paint?.kind === 'texture' ? [paint] : paint ? this.materialTextures.get(paint)! : [])
        this.changed(mesh.container)
        this.invalidate()
        return handle
    }

    updateMesh(handle: ResourceHandle<'mesh'>, data: MeshData): void {
        const mesh = this.registry.get<PixiMeshResource>(handle, 'mesh')
        this.changed(mesh.container)
        mesh.update(data)
        this.changed(mesh.container)
        this.invalidate()
    }

    setPaint(handle: ResourceHandle<'mesh'>, paint: PaintHandle): void {
        const mesh = this.registry.get<PixiMeshResource>(handle, 'mesh')
        mesh.setPaint(this.paint(paint))
        this.registry.replaceDependencies(handle, paint ? [paint] : [])
        this.meshPaint.set(handle, paint)
        this.samples.set(mesh.container, paint?.kind === 'texture' ? [paint] : paint ? this.materialTextures.get(paint)! : [])
        this.changed(mesh.container)
        this.invalidate()
    }

    createPath(group: ResourceHandle<'group'>, shapes: readonly VectorShape[]): ResourceHandle<'path'> {
        const graphics = new Graphics()
        graphics.eventMode = 'none'
        this.registry.get<Group>(group, 'group').container.addChild(graphics)
        const handle = this.registry.add('path', graphics, () => graphics.destroy(), { parent: group })
        this.updatePath(handle, shapes)
        return handle
    }

    updatePath(handle: ResourceHandle<'path'>, shapes: readonly VectorShape[]): void {
        const graphics = this.registry.get<Graphics>(handle, 'path')
        this.changed(graphics)
        graphics.clear()
        for (const shape of shapes) {
            const path = projectVectorPath(shape.path, shape.projection)
            if (shape.fill) {
                graphics.beginPath().path(path).fill(shape.fill)
                for (const hole of shape.holes ?? []) graphics.beginPath().path(projectVectorPath(hole, shape.projection)).cut()
            }
            if (shape.stroke) {
                const { dash, ...stroke } = shape.stroke
                graphics.beginPath().path(dash ? dashVectorPath(path, dash) : path).stroke(stroke)
            }
        }
        this.changed(graphics)
        for (const [group, mask] of this.masks) if (mask === handle) this.changed(this.display(group))
        this.invalidate()
    }

    setMask(group: ResourceHandle<'group'>, mask: ResourceHandle<'path'> | null): void {
        const { container } = this.registry.get<Group>(group, 'group')
        this.changed(container)
        container.mask = mask ? this.registry.get<Graphics>(mask, 'path') : null
        if (mask) this.masks.set(group, mask)
        else this.masks.delete(group)
        this.invalidate()
    }

    capture(input: CaptureSpec): CaptureResource {
        const spec = this.captureSpec(input)
        const texture = RenderTexture.create({ width: spec.bounds.width, height: spec.bounds.height, resolution: spec.resolution ?? 1, dynamic: true })
        const record = { spec, texture, dirty: true } as Capture
        const handle = this.registry.add('capture', record, () => {
            this.captures.delete(handle)
        })
        const textureHandle = this.registry.add('texture', { texture }, () => {
            this.captureTextures.delete(textureHandle)
            texture.destroy(true)
        }, { parent: handle })
        this.captureTextures.add(textureHandle)
        record.handle = textureHandle
        this.captures.set(handle, record)
        this.invalidate()
        return { handle, texture: textureHandle }
    }

    updateCapture(handle: ResourceHandle<'capture'>, input: CaptureSpec): void {
        const capture = this.registry.get<Capture>(handle, 'capture')
        capture.spec = this.captureSpec(input)
        if (capture.texture.width !== capture.spec.bounds.width || capture.texture.height !== capture.spec.bounds.height || capture.texture.source.resolution !== (capture.spec.resolution ?? 1)) {
            capture.texture.resize(capture.spec.bounds.width, capture.spec.bounds.height, capture.spec.resolution ?? 1)
        }
        capture.dirty = true
        this.invalidate()
    }

    private captureSpec(input: CaptureSpec): CaptureSpec {
        const { width, height, x, y } = input.bounds
        if (![width, height, x, y, input.resolution ?? 1].every(Number.isFinite) || width <= 0 || height <= 0 || (input.resolution ?? 1) <= 0) throw new RangeError('Capture bounds and resolution must be finite and positive')
        for (const handle of input.include) this.registry.get(handle, handle.kind)
        for (const handle of input.exclude) this.registry.get(handle, 'group')
        for (const bounds of input.sampleBounds ?? []) {
            if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) throw new RangeError('Capture sample bounds must be finite and positive')
        }
        return { ...input, bounds: { ...input.bounds }, sampleBounds: input.sampleBounds?.map(bounds => ({ ...bounds })), include: [...input.include], exclude: [...input.exclude] }
    }

    displace(group: ResourceHandle<'group'>, source: ResourceHandle<'texture'>, map: ResourceHandle<'texture'>, options: { bounds: CanvasEngineRect; scale: CanvasEnginePoint }): Dispose {
        const owner = this.registry.get<Group>(group, 'group')
        const container = new Container()
        const sprite = new Sprite(this.texture(source))
        const displacement = new Sprite(this.texture(map))
        const filter = new DisplacementFilter({ sprite: displacement, scale: options.scale })
        sprite.filters = [filter]
        for (const node of [sprite, displacement]) {
            node.position.set(options.bounds.x, options.bounds.y)
            node.width = options.bounds.width
            node.height = options.bounds.height
            node.eventMode = 'none'
        }
        displacement.renderable = false
        container.addChild(sprite, displacement)
        owner.container.addChild(container)
        const handle = this.registry.add('group', { container, space: owner.space }, () => {
            this.samples.delete(container)
            sprite.filters = []
            sprite.destroy()
            displacement.destroy()
            filter.destroy()
            container.destroy()
        }, { parent: group, dependencies: [source, map] })
        this.samples.set(container, [source, map])
        this.changed(container)
        this.invalidate()
        return () => this.release(handle)
    }

    private includedContainers(spec: CaptureSpec): Container[] {
        return spec.include.flatMap(handle => {
            if (handle.kind === 'group') return [this.registry.get<Group>(handle, 'group').container]
            const layer = this.registry.get<Layer>(handle, 'layer')
            return spec.space === 'world' ? [layer.world] : [layer.world, layer.screen]
        })
    }

    private contains(parent: Container, child: Container): boolean {
        for (let node: Container | null = child; node; node = node.parent) if (node === parent) return true
        return false
    }

    private samplesCapture(capture: Capture, container: Container): boolean {
        const includes = this.includedContainers(capture.spec)
        const excludes = capture.spec.exclude.map(handle => this.registry.get<Group>(handle, 'group').container)
        return includes.some(parent => this.contains(parent, container)) && !excludes.some(parent => this.contains(parent, container))
    }

    private changed(container: Container): void {
        if (!container.parent) return
        const bounds = container.getBounds().rectangle
        const ancestors = new Set<Container>()
        for (let node: Container | null = container; node; node = node.parent) ancestors.add(node)
        const previous = this.changes.get(container)
        const x = Math.min(bounds.x, previous?.bounds.x ?? bounds.x)
        const y = Math.min(bounds.y, previous?.bounds.y ?? bounds.y)
        const right = Math.max(bounds.right, previous ? previous.bounds.x + previous.bounds.width : bounds.right)
        const bottom = Math.max(bounds.bottom, previous ? previous.bounds.y + previous.bounds.height : bounds.bottom)
        for (const ancestor of previous?.ancestors ?? []) ancestors.add(ancestor)
        this.changes.set(container, { bounds: { x, y, width: right - x, height: bottom - y }, ancestors })
    }

    private screenSampleBounds(capture: Capture): readonly CanvasEngineRect[] {
        const regions = capture.spec.sampleBounds ?? [capture.spec.bounds]
        if (capture.spec.space === 'screen') return regions
        return regions.map(bounds => ({ x: bounds.x * this.viewport.zoom + this.viewport.x, y: bounds.y * this.viewport.zoom + this.viewport.y, width: bounds.width * this.viewport.zoom, height: bounds.height * this.viewport.zoom }))
    }

    private overlaps(first: CanvasEngineRect, second: CanvasEngineRect): boolean {
        return first.x <= second.x + second.width && first.x + first.width >= second.x && first.y <= second.y + second.height && first.y + first.height >= second.y
    }

    // Explicit invalidation uses screen coordinates. Resource mutations already
    // record both old and new bounds, including mutations before the next frame.
    invalidateCaptures(bounds?: CanvasEngineRect): void {
        for (const capture of this.captures.values()) {
            if (!bounds || this.screenSampleBounds(capture).some(region => this.overlaps(bounds, region))) capture.dirty = true
        }
    }

    private captureChanged(capture: Capture): boolean {
        const includes = this.includedContainers(capture.spec)
        const excludes = capture.spec.exclude.map(handle => this.registry.get<Group>(handle, 'group').container)
        const regions = this.screenSampleBounds(capture)
        for (const [container, change] of this.changes) {
            if (!regions.some(bounds => this.overlaps(change.bounds, bounds))) continue
            if (!includes.some(parent => change.ancestors.has(parent) || this.contains(container, parent))) continue
            if (excludes.some(parent => change.ancestors.has(parent))) continue
            return true
        }
        return false
    }

    renderCaptures(renderer: Renderer): void {
        const visiting = new Set<Capture>()
        const ordered: Capture[] = []
        const dependencies = new Map<Capture, Set<Capture>>()
        const byTexture = new Map(Array.from(this.captures.values(), capture => [capture.handle, capture]))
        const visit = (capture: Capture) => {
            if (visiting.has(capture)) throw new Error('Cyclic canvas capture dependency')
            if (dependencies.has(capture)) return
            visiting.add(capture)
            const inputs = new Set<Capture>()
            dependencies.set(capture, inputs)
            for (const [container, textures] of this.samples) {
                if (!this.samplesCapture(capture, container)) continue
                for (const texture of textures) {
                    const dependency = byTexture.get(texture)
                    if (dependency) {
                        inputs.add(dependency)
                        visit(dependency)
                    }
                }
            }
            visiting.delete(capture)
            ordered.push(capture)
        }
        for (const capture of this.captures.values()) visit(capture)
        const refreshed = new Set<Capture>()
        for (const capture of ordered) {
            if (capture.spec.enabled === false) continue
            if (!capture.dirty && !this.captureChanged(capture) && !Array.from(dependencies.get(capture)!).some(input => refreshed.has(input))) continue
            this.renderCapture(renderer, capture)
            capture.dirty = false
            refreshed.add(capture)
        }
        this.changes.clear()
    }

    private renderCapture(renderer: Renderer, capture: Capture): void {
        const includes = this.includedContainers(capture.spec)
        const excludes = capture.spec.exclude.map(handle => this.registry.get<Group>(handle, 'group').container)
        const visibility = new Map<Container, boolean>()
        const visit = (node: Container) => {
            visibility.set(node, node.renderable)
            const included = includes.some(parent => this.contains(parent, node) || this.contains(node, parent))
            if (!included || excludes.some(parent => this.contains(parent, node))) node.renderable = false
            for (const child of node.children) visit(child)
        }
        try {
            visit(this.stage)
            if (capture.spec.space === 'world') {
                for (const layer of this.layers.values()) {
                    layer.world.position.set(0, 0)
                    layer.world.scale.set(1)
                }
            }
            this.prepareProjection(capture.spec.bounds)
            renderer.render({ container: this.stage, target: capture.texture, clear: true, transform: new Matrix().translate(-capture.spec.bounds.x, -capture.spec.bounds.y) })
        } finally {
            for (const [node, renderable] of visibility) node.renderable = renderable
            if (capture.spec.space === 'world') { for (const layer of this.layers.values()) this.applyViewport(layer.world) }
        }
    }

    prepareProjection(bounds: CanvasEngineRect): void {
        for (const mesh of this.meshes.values()) mesh.prepareProjection(bounds)
    }

    release(handle: ResourceHandle): void {
        if (handle.kind === 'layer') throw new Error('Canvas layers are borrowed resources')
        if (handle.kind === 'texture' && this.captureTextures.has(handle as ResourceHandle<'texture'>)) throw new Error('Capture textures are borrowed resources')
        if (handle.kind === 'capture') this.captures.delete(handle as ResourceHandle<'capture'>)
        if (handle.kind === 'group' || handle.kind === 'mesh' || handle.kind === 'path') {
            // Detach immediately; physical GPU disposal happens after submission.
            let removed: Container
            try {
                removed = this.display(handle as ResourceHandle<'group' | 'mesh' | 'path'>)
            } catch {
                // Validate repeat releases without hiding errors in scene cleanup.
                this.registry.release(handle)
                return
            }
            this.changed(removed)
            for (const [group, mask] of this.masks) {
                if (this.contains(removed, this.display(group)) || this.contains(removed, this.display(mask))) this.setMask(group, null)
            }
            for (const capture of this.captures.values()) {
                const retained = (item: CanvasLayer | ResourceHandle<'group'>) => item.kind === 'layer' || !this.contains(removed, this.display(item))
                const include = capture.spec.include.filter(retained)
                const exclude = capture.spec.exclude.filter(retained)
                if (include.length !== capture.spec.include.length || exclude.length !== capture.spec.exclude.length) {
                    capture.spec = { ...capture.spec, include, exclude }
                    capture.dirty = true
                }
            }
            removed.removeFromParent()
        }
        this.registry.release(handle)
        this.invalidate()
    }

    destroy(): void {
        this.stage.removeChildren()
        this.masks.clear()
        this.changes.clear()
        this.captures.clear()
        this.registry.destroy()
    }
}
