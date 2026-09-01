import {
    type MaterialBinding,
    type MaterialProgram,
    type MeshData,
    type TextureInput,
} from './resources.ts'

const uniformLengths = { f32: 1, vec2f: 2, vec3f: 3, vec4f: 4, mat3f: 9, mat4f: 16 } as const

export function validateMesh(data: MeshData): void {
    if (data.positions.length % 2 !== 0 || data.uvs.length !== data.positions.length) {
        throw new RangeError('Mesh positions and UVs must contain matching pairs')
    }
    if (data.indices.length % 3 !== 0) throw new RangeError('Mesh indices must describe triangles')
    const vertices = data.positions.length / 2
    for (const value of data.positions) if (!Number.isFinite(value)) throw new RangeError('Mesh positions must be finite')
    for (const value of data.uvs) if (!Number.isFinite(value)) throw new RangeError('Mesh UVs must be finite')
    for (const index of data.indices) if (index >= vertices) throw new RangeError('Mesh index exceeds the vertex count')
}

export function validateTexture(input: TextureInput): void {
    const size = input.kind === 'pixels' ? input.size : input.source
    if (!Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width < 1 || size.height < 1) {
        throw new RangeError('Texture dimensions must be positive integers')
    }
    if (input.kind === 'pixels' && input.rgba.length !== size.width * size.height * 4) {
        throw new RangeError('Texture pixels must contain four channels per pixel')
    }
}

export function validateMaterialBindings(bindings: readonly MaterialBinding[]): void {
    const slots = new Set<number>()
    const names = new Set<string>()
    const reserveName = (name: string) => {
        if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(name) || names.has(name) || name.startsWith('canvas_')) throw new Error(`Invalid or reserved material name ${name}`)
        names.add(name)
    }
    const reserve = (slot: number) => {
        if (!Number.isInteger(slot) || slot < 0 || slots.has(slot)) throw new RangeError(`Invalid or duplicate material binding ${slot}`)
        slots.add(slot)
    }
    for (const binding of bindings) {
        reserveName(binding.name)
        reserve(binding.binding)
        if (binding.kind === 'texture') {
            reserveName(`${binding.name}_sampler`)
            reserve(binding.samplerBinding)
            if (binding.sampling !== 'linear' && binding.sampling !== 'nearest') throw new Error('Unsupported material sampling')
            continue
        }
        const values = typeof binding.value === 'number' ? [binding.value] : binding.value
        if (!(binding.type in uniformLengths) || values.length !== uniformLengths[binding.type]) throw new RangeError(`Invalid value length for ${binding.name}`)
        for (const value of values) if (!Number.isFinite(value)) throw new RangeError(`Non-finite uniform ${binding.name}`)
    }
}

export function validateMaterial(program: MaterialProgram): void {
    if (program.abi !== 'canvas-material-v1') throw new Error('Unsupported canvas material ABI')
    if (!program.webgl.vertex.trim() || !program.webgl.fragment.trim() || !program.webgpu.vertex.trim() || !program.webgpu.fragment.trim()) {
        throw new Error('Canvas materials require WebGL and WebGPU programs')
    }
    validateMaterialBindings(program.bindings)
}
