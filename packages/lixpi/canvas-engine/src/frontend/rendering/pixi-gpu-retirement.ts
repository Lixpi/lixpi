'use strict'

import type {
    Buffer,
    WebGPURenderer,
} from 'pixi.js'
import type { Dispose } from '../../shared/index.ts'

// Pixi can replace internal Graphics/uniform buffers during a render. Wrap the
// records allocated by this renderer, leaving native GPUBuffer prototypes and
// other canvas instances unchanged. Cleanup is queued after frame submission.
export class PixiGpuRetirement {
    private readonly create: WebGPURenderer['buffer']['createGPUBuffer']
    private restored = false

    constructor(private readonly renderer: WebGPURenderer, private readonly retire: (dispose: Dispose) => void) {
        this.create = renderer.buffer.createGPUBuffer
        renderer.buffer.createGPUBuffer = this.createBuffer
    }

    private createBuffer = (buffer: Buffer): GPUBuffer => {
        const native = this.create.call(this.renderer.buffer, buffer)
        const data = buffer._gpuData[this.renderer.uid] as { gpuBuffer: GPUBuffer | null; destroy: Dispose }
        let retired = false
        data.destroy = () => {
            if (retired) return
            retired = true
            data.gpuBuffer = null
            this.retire(() => native.destroy())
        }
        return native
    }

    destroy(): void {
        if (this.restored) return
        this.restored = true
        if (this.renderer.buffer.createGPUBuffer === this.createBuffer) this.renderer.buffer.createGPUBuffer = this.create
    }
}
