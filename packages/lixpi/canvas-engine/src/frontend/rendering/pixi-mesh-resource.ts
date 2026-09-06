import {
    Container,
    Mesh,
    MeshGeometry,
    Texture,
    type Shader,
} from 'pixi.js'
import {
    type CanvasEngineRect,
    type Dispose,
} from '../../shared/index.ts'
import {
    type MeshData,
} from './resources.ts'
import { validateMesh } from './resource-validation.ts'
import { PixiMaterialResource } from './pixi-material-resource.ts'

type MeshSlot = {
    geometry: MeshGeometry
    mesh: Mesh<MeshGeometry, Shader>
    material?: {
        owner: PixiMaterialResource
        instance: ReturnType<PixiMaterialResource['createInstance']>
    }
}

// Private backend resource: components submit arrays without managing GPU buffers.
export class PixiMeshResource {
    readonly container = new Container()
    private slots: MeshSlot[] = []
    private active = -1
    private destroyed = false

    constructor(
        data: MeshData,
        private paint: Texture | PixiMaterialResource,
        private readonly retire: (dispose: Dispose) => void,
    ) {
        this.container.eventMode = 'none'
        this.update(data)
    }

    update(data: MeshData): void {
        if (this.destroyed)
            throw new Error('Mesh is disposed')

        validateMesh(data)
        const capacity = this.slots[0]?.geometry

        if (
            !capacity
            || capacity.positions.length < data.positions.length
            || capacity.indices.length < data.indices.length
        )
            this.replaceSlots(data)

        this.active = (this.active + 1) % this.slots.length
        const slot = this.slots[this.active]
        slot.geometry.positions.fill(0)
        slot.geometry.positions.set(data.positions)
        slot.geometry.uvs.fill(0)
        slot.geometry.uvs.set(data.uvs)
        slot.geometry.indices.fill(0)
        slot.geometry.indices.set(data.indices)
        slot.geometry.getBuffer('aPosition').update()
        slot.geometry.getBuffer('aUV').update()
        slot.geometry.getIndex().update()

        for (const entry of this.slots)
            entry.mesh.renderable = entry === slot
    }

    setPaint(paint: Texture | PixiMaterialResource): void {
        if (this.destroyed)
            throw new Error('Mesh is disposed')

        this.paint = paint

        for (const slot of this.slots)
            this.applyPaint(slot)
    }

    prepareProjection(bounds: CanvasEngineRect): void {
        const slot = this.slots[this.active]

        if (!slot?.material)
            return

        const matrix = slot.mesh.getGlobalTransform()
        const transform = slot.material.instance.transform
        const value = transform.uniforms.canvas_transform as Float32Array
        value.set([
            2 * matrix.a / bounds.width,
            -2 * matrix.b / bounds.height,
            0,
            2 * matrix.c / bounds.width,
            -2 * matrix.d / bounds.height,
            0,
            2 * (matrix.tx - bounds.x) / bounds.width - 1,
            1 - 2 * (matrix.ty - bounds.y) / bounds.height,
            1,
        ])
        transform.update()
    }

    private applyPaint(slot: MeshSlot): void {
        const previous = slot.material
        slot.material = undefined

        if (this.paint instanceof PixiMaterialResource) {
            const instance = this.paint.createInstance()
            slot.material = {
                owner: this.paint,
                instance,
            }
            slot.mesh.shader = instance.shader
        } else {
            slot.mesh.shader = null
            slot.mesh.texture = this.paint
        }

        if (previous)
            this.retire(() => previous.owner.releaseInstance(previous.instance))
    }

    private replaceSlots(data: MeshData): void {
        const previous = this.slots
        this.slots = []
        this.active = -1

        for (let index = 0; index < 3; index++) {
            const geometry = new MeshGeometry({
                positions: new Float32Array(data.positions.length),
                uvs: new Float32Array(data.uvs.length),
                indices: new Uint32Array(data.indices.length),
                shrinkBuffersToFit: false,
            })
            const mesh = new Mesh<MeshGeometry, Shader>({
                geometry,
                texture: Texture.EMPTY,
            })
            mesh.eventMode = 'none'
            mesh.renderable = false
            this.container.addChild(mesh)
            const slot = {
                geometry,
                mesh,
            }
            this.applyPaint(slot)
            this.slots.push(slot)
        }

        for (const slot of previous)
            this.container.removeChild(slot.mesh)

        if (previous.length > 0)
            this.retire(() => this.destroySlots(previous))
    }

    private destroySlots(slots: readonly MeshSlot[]): void {
        for (const slot of slots) {
            slot.mesh.destroy()
            slot.geometry.destroy()

            if (slot.material)
                slot.material.owner.releaseInstance(slot.material.instance)
        }
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true
        this.destroySlots(this.slots)
        this.slots = []
        this.container.destroy()
    }
}
