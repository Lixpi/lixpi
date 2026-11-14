import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type Buffer,
    type TextureSource,
    type WebGPURenderer,
} from 'pixi.js'
import { PixiGpuRetirement } from './pixi-gpu-retirement.ts'

type NativeTexture = { destroy: ReturnType<typeof vi.fn> }

type TextureRecord = {
    gpuTexture: NativeTexture | null
    textureView: object | null
    textureViews: Record<string, object> | null
    destroy: () => void
}

const rendererFixture = (uid: number) => {
    const created: Array<{ destroy: ReturnType<typeof vi.fn> }> = []
    const textures: NativeTexture[] = []
    const system = {
        createGPUBuffer: (buffer: Buffer) => {
            const native = { destroy: vi.fn() }
            created.push(native)
            buffer._gpuData[uid] = {
                gpuBuffer: native,
                destroy: () => native.destroy(),
            } as never

            return native
        },
    }
    // Mirrors Pixi's texture system: an initialized source keeps its record,
    // and a resize destroys the record and initializes a new one.
    const textureSystem = {
        initSource(source: TextureSource) {
            const existing = source._gpuData[uid] as TextureRecord | undefined

            if (existing?.gpuTexture)
                return existing.gpuTexture

            const native = { destroy: vi.fn() }
            textures.push(native)
            const record: TextureRecord = {
                gpuTexture: native,
                textureView: {},
                textureViews: {},
                destroy: () => {
                    record.gpuTexture?.destroy()
                    record.gpuTexture = null
                },
            }
            source._gpuData[uid] = record as never

            return native
        },
        resize(source: TextureSource) {
            ;(source._gpuData[uid] as TextureRecord).destroy()
            source._gpuData[uid] = null as never

            return this.initSource(source)
        },
    }

    return {
        renderer: {
            uid,
            buffer: system,
            texture: textureSystem,
        } as unknown as WebGPURenderer,
        created,
        textures,
        system,
        textureSystem,
    }
}

describe('renderer-owned GPU buffer retirement', () => {
    it('detaches a replaced buffer immediately but delays native destruction', () => {
        const {
            renderer,
            created,
        } = rendererFixture(1)
        const pending: Array<() => void> = []
        const retirement = new PixiGpuRetirement(renderer, dispose => pending.push(dispose))
        const buffer = { _gpuData: {} } as Buffer
        renderer.buffer.createGPUBuffer(buffer)
        const old = buffer._gpuData[1]
        old.destroy()
        old.destroy()
        expect((old as { gpuBuffer: unknown }).gpuBuffer).toBeNull()
        expect(created[0].destroy).not.toHaveBeenCalled()
        renderer.buffer.createGPUBuffer(buffer)
        expect(buffer._gpuData[1]).not.toBe(old)

        for (const dispose of pending) dispose()

        expect(created[0].destroy).toHaveBeenCalledOnce()
        expect(created[1].destroy).not.toHaveBeenCalled()
        retirement.destroy()
    })

    it('does not change another renderer and restores only its own allocator', () => {
        const first = rendererFixture(1)
        const second = rendererFixture(2)
        const original = first.system.createGPUBuffer
        const pending: Array<() => void> = []
        const retirement = new PixiGpuRetirement(first.renderer, dispose => pending.push(dispose))
        const buffer = { _gpuData: {} } as Buffer
        second.renderer.buffer.createGPUBuffer(buffer)
        buffer._gpuData[2].destroy()
        expect(second.created[0].destroy).toHaveBeenCalledOnce()
        expect(pending).toHaveLength(0)
        retirement.destroy()
        retirement.destroy()
        expect(first.system.createGPUBuffer).toBe(original)
    })
})

describe('renderer-owned GPU texture retirement', () => {
    it('keeps the old texture alive until submitted work settles when Pixi resizes it', () => {
        const {
            renderer,
            textures,
            textureSystem,
        } = rendererFixture(1)
        const pending: Array<() => void> = []
        const retirement = new PixiGpuRetirement(renderer, dispose => pending.push(dispose))
        const source = { _gpuData: {} } as TextureSource
        renderer.texture.initSource(source)
        const old = source._gpuData[1] as TextureRecord

        textureSystem.resize(source)

        expect(old.gpuTexture).toBeNull()
        expect(old.textureView).toBeNull()
        expect(old.textureViews).toBeNull()
        expect(textures).toHaveLength(2)
        expect(source._gpuData[1]).not.toBe(old)
        expect(textures[0].destroy).not.toHaveBeenCalled()

        for (const dispose of pending) dispose()

        expect(textures[0].destroy).toHaveBeenCalledOnce()
        expect(textures[1].destroy).not.toHaveBeenCalled()
        retirement.destroy()
    })

    it('retires a texture record once however often Pixi destroys it', () => {
        const {
            renderer,
            textures,
        } = rendererFixture(1)
        const pending: Array<() => void> = []
        const retirement = new PixiGpuRetirement(renderer, dispose => pending.push(dispose))
        const source = { _gpuData: {} } as TextureSource
        renderer.texture.initSource(source)
        renderer.texture.initSource(source)
        const record = source._gpuData[1] as TextureRecord

        record.destroy()
        record.destroy()

        expect(pending).toHaveLength(1)

        for (const dispose of pending) dispose()

        expect(textures).toHaveLength(1)
        expect(textures[0].destroy).toHaveBeenCalledOnce()
        retirement.destroy()
    })

    it('restores the texture initializer of its own renderer only', () => {
        const first = rendererFixture(1)
        const second = rendererFixture(2)
        const original = first.textureSystem.initSource
        const pending: Array<() => void> = []
        const retirement = new PixiGpuRetirement(first.renderer, dispose => pending.push(dispose))
        const source = { _gpuData: {} } as TextureSource
        second.renderer.texture.initSource(source)
        ;(source._gpuData[2] as TextureRecord).destroy()

        expect(second.textures[0].destroy).toHaveBeenCalledOnce()
        expect(pending).toHaveLength(0)

        retirement.destroy()

        expect(first.renderer.texture.initSource).toBe(original)
    })
})
