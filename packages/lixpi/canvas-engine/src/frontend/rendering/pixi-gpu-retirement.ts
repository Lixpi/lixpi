import {
    type Buffer,
    type TextureSource,
    type WebGPURenderer,
} from 'pixi.js'
import {
    type Dispose,
} from '../../shared/index.ts'

type TextureGpuData = {
    gpuTexture: GPUTexture | null
    textureView: GPUTextureView | null
    textureViews: Record<string, GPUTextureView> | null
    destroy: Dispose
}

// Pixi destroys some of its own GPU objects while a frame that uses them can
// still be running on the GPU. It replaces internal Graphics and uniform
// buffers during a render, and it destroys a texture's GPU storage the moment
// the texture is resized, as a capture is when its bounds change. WebGPU lets
// a page destroy an object that submitted work still uses, and Chrome holds it
// until that work finishes. WebKit frees the Metal resource at once, the
// command buffer then fails with an invalid resource error, and WebKit ends
// its GPU process, which loses the device for the whole canvas.
//
// This wraps the buffer and texture records this renderer allocates, leaving
// native GPUBuffer and GPUTexture prototypes and other canvas instances
// unchanged. A record Pixi drops is detached at once, so Pixi creates a fresh
// one, and its native object is destroyed after submitted work settles.
export class PixiGpuRetirement {
    private readonly createBuffer: WebGPURenderer['buffer']['createGPUBuffer']
    private readonly initTexture: WebGPURenderer['texture']['initSource']
    private readonly retiringTextures = new WeakSet<TextureGpuData>()
    private restored = false

    constructor(
        private readonly renderer: WebGPURenderer,
        private readonly retire: (dispose: Dispose) => void,
    ) {
        this.createBuffer = renderer.buffer.createGPUBuffer
        this.initTexture = renderer.texture.initSource
        renderer.buffer.createGPUBuffer = this.createRetiringBuffer
        renderer.texture.initSource = this.initRetiringTexture
    }

    private createRetiringBuffer = (buffer: Buffer): GPUBuffer => {
        const native = this.createBuffer.call(this.renderer.buffer, buffer)
        const data = buffer._gpuData[this.renderer.uid] as {
            gpuBuffer: GPUBuffer | null
            destroy: Dispose
        }
        let retired = false
        data.destroy = () => {
            if (retired)
                return

            retired = true
            data.gpuBuffer = null
            this.retire(() => native.destroy())
        }

        return native
    }

    // Pixi creates every texture's GPU storage here, including the
    // replacement after a resize. An initialized source returns early with
    // its existing record, which is already wrapped.
    private initRetiringTexture = (source: TextureSource): GPUTexture => {
        const native = this.initTexture.call(this.renderer.texture, source)
        const data = source._gpuData[this.renderer.uid] as TextureGpuData | undefined

        if (
            !data
            || this.retiringTextures.has(data)
        )
            return native

        this.retiringTextures.add(data)
        let retired = false
        data.destroy = () => {
            if (retired)
                return

            retired = true
            const texture = data.gpuTexture
            data.gpuTexture = null
            data.textureView = null
            data.textureViews = null

            if (texture)
                this.retire(() => texture.destroy())
        }

        return native
    }

    destroy(): void {
        if (this.restored)
            return

        this.restored = true

        if (this.renderer.buffer.createGPUBuffer === this.createRetiringBuffer)
            this.renderer.buffer.createGPUBuffer = this.createBuffer

        if (this.renderer.texture.initSource === this.initRetiringTexture)
            this.renderer.texture.initSource = this.initTexture
    }
}
