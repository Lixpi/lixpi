import {
    GpuProgram,
    GlProgram,
    Shader,
    TextureStyle,
    UniformGroup,
    type Texture,
} from 'pixi.js'
import {
    type MaterialBinding,
    type MaterialProgram,
    type ResourceHandle,
} from './resources.ts'
import {
    validateMaterial,
    validateMaterialBindings,
} from './resource-validation.ts'

const uniformTypes = {
    f32: 'f32',
    vec2f: 'vec2<f32>',
    vec3f: 'vec3<f32>',
    vec4f: 'vec4<f32>',
    mat3f: 'mat3x3<f32>',
    mat4f: 'mat4x4<f32>',
} as const

type MaterialInstance = {
    shader: Shader
    transform: UniformGroup
}

export class PixiMaterialResource {
    private readonly gpu: GpuProgram
    private readonly gl: GlProgram
    private readonly instances = new Set<MaterialInstance>()
    private readonly samplers = new Map<string, TextureStyle>()
    private readonly uniforms = new Map<string, UniformGroup>()
    private readonly textures = new Map<string, Texture>()
    private bindings: readonly MaterialBinding[]

    constructor(
        program: MaterialProgram,
        private readonly texture: (handle: ResourceHandle<'texture'>) => Texture,
    ) {
        validateMaterial(program)
        this.bindings = program.bindings
        // Engine transforms occupy group 0; components use group 1. These names
        // deliberately avoid Pixi's automatic global/local uniform substitution.
        this.gpu = new GpuProgram({
            vertex: {
                source: program.webgpu.vertex,
                entryPoint: 'mainVertex',
            },
            fragment: {
                source: program.webgpu.fragment,
                entryPoint: 'mainFragment',
            },
        })
        let gl: GlProgram | undefined

        try {
            this.validateGpuBindings(program.bindings)
            this.gl = gl = new GlProgram(program.webgl)
            this.update(program.bindings)
        } catch (error) {
            this.gpu.destroy()
            gl?.destroy()

            for (const sampler of this.samplers.values()) sampler.destroy()

            for (const uniform of this.uniforms.values()) uniform.buffer?.destroy()

            throw error
        }
    }

    private validateGpuBindings(bindings: readonly MaterialBinding[]): void {
        const declared = this.gpu.structsAndGroups.groups
        const expected = new Map<string, {
            group: number
            binding: number
            type: string
        }>([['canvas_transform', {
            group: 0,
            binding: 0,
            type: 'mat3x3<f32>',
        }]])

        for (const binding of bindings) {
            expected.set(
                binding.name,
                {
                    group: 1,
                    binding: binding.binding,
                    type: binding.kind === 'uniform' ? uniformTypes[binding.type] : 'texture_2d<f32>',
                },
            )

            if (binding.kind === 'texture')
                expected.set(
                    `${binding.name}_sampler`,
                    {
                        group: 1,
                        binding: binding.samplerBinding,
                        type: 'sampler',
                    },
                )
        }

        if (declared.length !== expected.size)
            throw new Error('Material shader bindings do not match its declared resources')

        for (const binding of declared) {
            const entry = expected.get(binding.name)

            if (
                !entry
                || entry.group !== binding.group
                || entry.binding !== binding.binding
                || entry.type !== binding.type
            )
                throw new Error(`Unexpected material shader binding ${binding.name}`)
        }
    }

    update(bindings: readonly MaterialBinding[]): void {
        validateMaterialBindings(bindings)
        this.validateGpuBindings(bindings)
        const textures = new Map<string, Texture>()

        // Resolve every input before changing uniforms or samplers. An invalid
        // texture must not leave an otherwise valid material partially updated.
        for (const binding of bindings) {
            const previous = this.bindings.find(entry => entry.name === binding.name)

            if (
                previous
                && (previous.kind !== binding.kind || (previous.kind === 'uniform' && binding.kind === 'uniform' && previous.type !== binding.type))
            )
                throw new Error('Material updates cannot change binding types')

            if (binding.kind === 'texture')
                textures.set(
                    binding.name,
                    this.texture(binding.texture),
                )
        }

        for (const binding of bindings) {
            if (binding.kind === 'uniform') {
                const value = typeof binding.value === 'number' ? binding.value : new Float32Array(binding.value)
                const group = this.uniforms.get(binding.name)

                if (group) {
                    group.uniforms[binding.name] = value
                    group.update()
                } else
                    this.uniforms.set(
                        binding.name,
                        new UniformGroup({ [binding.name]: {
                            type: uniformTypes[binding.type],
                            value,
                        } }),
                    )
            } else {
                let sampler = this.samplers.get(binding.name)

                if (!sampler) {
                    sampler = new TextureStyle({ scaleMode: binding.sampling })
                    this.samplers.set(binding.name, sampler)
                }

                sampler.scaleMode = binding.sampling
                this.textures.set(binding.name, textures.get(binding.name)!)
            }
        }

        this.bindings = bindings.map(
            binding => binding.kind === 'uniform'
                && typeof binding.value !== 'number'
                ? {
                    ...binding,
                    value: new Float32Array(binding.value),
                }
                : { ...binding },
        )

        for (const instance of this.instances) this.apply(instance.shader)
    }

    createInstance(): MaterialInstance {
        const transform = new UniformGroup({ canvas_transform: {
            type: 'mat3x3<f32>',
            value: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
        } })
        const resources: Record<string, unknown> = { canvas_transform: transform }

        for (const binding of this.bindings) {
            if (binding.kind === 'uniform')
                resources[binding.name] = this.uniforms.get(binding.name)!
            else {
                resources[binding.name] = this.textures.get(binding.name)!.source
                resources[`${binding.name}_sampler`] = this.samplers.get(binding.name)!
            }
        }

        const shader = new Shader({
            gpuProgram: this.gpu,
            glProgram: this.gl,
            resources,
        })
        const instance = {
            shader,
            transform,
        }
        this.instances.add(instance)

        return instance
    }

    releaseInstance(instance: MaterialInstance): void {
        if (!this.instances.delete(instance))
            return

        instance.shader.destroy()
        instance.transform.buffer?.destroy()
    }

    private apply(shader: Shader): void {
        for (const binding of this.bindings) {
            if (binding.kind === 'uniform')
                shader.resources[binding.name] = this.uniforms.get(binding.name)!
            else {
                shader.resources[binding.name] = this.textures.get(binding.name)!.source
                shader.resources[`${binding.name}_sampler`] = this.samplers.get(binding.name)!
            }
        }
    }

    destroy(): void {
        for (const instance of Array.from(this.instances)) this.releaseInstance(instance)

        for (const sampler of this.samplers.values()) sampler.destroy()

        for (const uniform of this.uniforms.values()) uniform.buffer?.destroy()

        this.samplers.clear()
        this.uniforms.clear()
        this.textures.clear()
        this.gpu.destroy()
        this.gl.destroy()
    }
}
