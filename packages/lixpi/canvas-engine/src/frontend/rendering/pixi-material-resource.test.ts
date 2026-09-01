import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { PixiMaterialResource } from './pixi-material-resource.ts'
import {
    type MaterialProgram,
} from './resources.ts'

function program(): MaterialProgram {
    const vertex = `
@group(0) @binding(0) var<uniform> canvas_transform: mat3x3<f32>;
struct Vertex {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}
@vertex fn mainVertex(@location(0) aPosition: vec2<f32>, @location(1) aUV: vec2<f32>) -> Vertex {
    var result: Vertex;
    let clip = canvas_transform * vec3<f32>(aPosition, 1.0);
    result.position = vec4<f32>(clip.xy, 0.0, 1.0);
    result.uv = aUV;
    return result;
}`
    const fragment = `
@group(1) @binding(0) var<uniform> amount: f32;
@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    return vec4<f32>(uv.x, uv.y, amount, 1.0);
}`
    return {
        abi: 'canvas-material-v1',
        webgpu: { vertex, fragment },
        webgl: {
            vertex: '#version 300 es\nin vec2 aPosition; in vec2 aUV; uniform mat3 canvas_transform; out vec2 uv; void main() { gl_Position = vec4((canvas_transform * vec3(aPosition, 1.0)).xy, 0.0, 1.0); uv = aUV; }',
            fragment: '#version 300 es\nprecision mediump float; in vec2 uv; uniform float amount; out vec4 color; void main() { color = vec4(uv, amount, 1.0); }',
        },
        bindings: [{ kind: 'uniform', name: 'amount', binding: 0, type: 'f32', value: 0.5 }],
    }
}

beforeEach(() => {
    // Pixi probes precision when constructing a GL program. Compilation and GPU
    // execution are not needed to verify the binding translation here.
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) })
})

afterEach(() => vi.unstubAllGlobals())

describe('material binding translation', () => {
    it('keeps transforms separate per mesh while sharing component uniform values', () => {
        const material = new PixiMaterialResource(program(), () => {
            throw new Error('No texture expected')
        })
        const first = material.createInstance()
        const second = material.createInstance()
        expect(first.transform).not.toBe(second.transform)
        expect(first.shader.gpuProgram!.autoAssignGlobalUniforms).toBe(false)
        expect(first.shader.gpuProgram!.autoAssignLocalUniforms).toBe(false)
        expect(first.shader.resources.amount).toBe(second.shader.resources.amount)
        material.update([{ kind: 'uniform', name: 'amount', binding: 0, type: 'f32', value: 0.8 }])
        expect(first.shader.resources.amount.uniforms.amount).toBe(0.8)
        expect(second.shader.resources.amount.uniforms.amount).toBe(0.8)
        material.releaseInstance(first)
        expect(second.shader.gpuProgram).not.toBeNull()
        material.destroy()
    })

    it('rejects shaders whose declared resource types disagree with the contract', () => {
        const invalid = program()
        invalid.bindings = [{ kind: 'uniform', name: 'amount', binding: 0, type: 'vec2f', value: new Float32Array([0, 1]) }]
        expect(() =>
            new PixiMaterialResource(invalid, () => {
                throw new Error('No texture expected')
            })
        ).toThrow('Unexpected material shader binding amount')
    })
})
