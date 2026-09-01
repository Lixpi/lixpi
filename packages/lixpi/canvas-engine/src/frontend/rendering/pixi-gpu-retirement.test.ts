import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type Buffer,
    type WebGPURenderer,
} from 'pixi.js'
import { PixiGpuRetirement } from './pixi-gpu-retirement.ts'

function rendererFixture(uid: number) {
    const created: Array<{ destroy: ReturnType<typeof vi.fn> }> = []
    const system = {
        createGPUBuffer: (buffer: Buffer) => {
            const native = { destroy: vi.fn() }
            created.push(native)
            buffer._gpuData[uid] = { gpuBuffer: native, destroy: () => native.destroy() } as never
            return native
        },
    }
    return { renderer: { uid, buffer: system } as unknown as WebGPURenderer, created, system }
}

describe('renderer-owned GPU buffer retirement', () => {
    it('detaches a replaced buffer immediately but delays native destruction', () => {
        const { renderer, created } = rendererFixture(1)
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
