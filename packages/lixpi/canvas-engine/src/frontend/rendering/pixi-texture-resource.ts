import {
    BufferImageSource,
    ImageSource,
    Texture,
} from 'pixi.js'
import {
    type TextureInput,
} from './resources.ts'
import { validateTexture } from './resource-validation.ts'

// Buffer uploads do not premultiply alpha in WebGPU. Normalize CPU pixels here
// so both backends use the same blending convention as browser image sources.
const copyPixels = (
    input: Uint8Array | Uint8ClampedArray,
    output: Uint8Array = new Uint8Array(input.length),
): Uint8Array => {
    for (let index = 0; index < input.length; index += 4) {
        const alpha = input[index + 3]
        output[index] = Math.round((input[index] * alpha) / 255)
        output[index + 1] = Math.round((input[index + 1] * alpha) / 255)
        output[index + 2] = Math.round((input[index + 2] * alpha) / 255)
        output[index + 3] = alpha
    }

    return output
}

export class PixiTextureResource {
    readonly texture: Texture
    private readonly kind: TextureInput['kind']
    private destroyed = false

    constructor(input: TextureInput) {
        validateTexture(input)
        this.kind = input.kind
        const source = input.kind === 'pixels'
            ? new BufferImageSource({
                width: input.size.width,
                height: input.size.height,
                resource: copyPixels(input.rgba),
                format: 'rgba8unorm',
                alphaMode: 'premultiplied-alpha',
            })
            : new ImageSource({
                resource: input.source,
                width: input.source.width,
                height: input.source.height,
            })
        source.autoGarbageCollect = false
        source.autoGenerateMipmaps = input.mipmaps ?? false
        this.texture = new Texture({ source })
    }

    update(input: TextureInput): void {
        if (this.destroyed)
            throw new Error('Texture is disposed')

        validateTexture(input)

        if (input.kind !== this.kind)
            throw new Error('Texture updates must preserve the source kind')

        const source = this.texture.source

        if (input.mipmaps !== undefined)
            source.autoGenerateMipmaps = input.mipmaps

        const size = input.kind === 'pixels' ? input.size : input.source

        if (input.kind === 'pixels') {
            const pixels = source.resource as Uint8Array
            source.resource = copyPixels(input.rgba, pixels.length === input.rgba.length ? pixels : undefined)
        } else
            source.resource = input.source

        source.resize(size.width, size.height)
        source.update()
        this.texture.update()
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true
        this.texture.destroy(true)
    }
}
