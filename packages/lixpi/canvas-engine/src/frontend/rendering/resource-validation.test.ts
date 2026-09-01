import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    validateMaterialBindings,
    validateMesh,
    validateTexture,
} from './resource-validation.ts'

describe('drawing resource validation', () => {
    it('rejects invalid geometry before a backend allocates buffers', () => {
        expect(() => validateMesh({ positions: new Float32Array([0, 0]), uvs: new Float32Array([0, 0]), indices: new Uint32Array([0, 1, 0]), version: 1 })).toThrow('vertex count')
        expect(() => validateMesh({ positions: new Float32Array([NaN, 0]), uvs: new Float32Array([0, 0]), indices: new Uint32Array([0, 0, 0]), version: 1 })).toThrow('finite')
    })

    it('rejects truncated pixel data and invalid dimensions', () => {
        expect(() => validateTexture({ kind: 'pixels', size: { width: 2, height: 2 }, rgba: new Uint8Array(4) })).toThrow('four channels')
        expect(() => validateTexture({ kind: 'pixels', size: { width: 0, height: 1 }, rgba: new Uint8Array() })).toThrow('positive integers')
    })

    it('rejects colliding material bindings and invalid uniform lengths', () => {
        expect(() =>
            validateMaterialBindings([
                { kind: 'uniform', name: 'amount', binding: 0, type: 'f32', value: 1 },
                { kind: 'uniform', name: 'color', binding: 0, type: 'vec3f', value: new Float32Array([1, 0, 0]) },
            ])
        ).toThrow('duplicate material binding')
        expect(() => validateMaterialBindings([{ kind: 'uniform', name: 'color', binding: 0, type: 'vec3f', value: new Float32Array([1, 0]) }])).toThrow('value length')
    })

    it('reserves engine binding names and validates sampler collisions', () => {
        expect(() => validateMaterialBindings([{ kind: 'uniform', name: 'canvas_transform', binding: 0, type: 'f32', value: 1 }])).toThrow('reserved')
        expect(() => validateMaterialBindings([{ kind: 'texture', name: 'image', binding: 0, samplerBinding: 0, sampling: 'linear', texture: { id: 'one', kind: 'texture', owner: Symbol() } }])).toThrow('duplicate')
    })
})
