import {
    type CanvasEnginePoint,
    type CanvasEngineRect,
    type CanvasEngineSize,
    type Dispose,
} from '../../shared/index.ts'

export type ResourceKind = 'layer' | 'group' | 'texture' | 'mesh' | 'path' | 'material' | 'capture'
export type ResourceHandle<Kind extends ResourceKind = ResourceKind> = {
    readonly id: string
    readonly kind: Kind
    readonly owner: symbol
}
export type CanvasLayer = ResourceHandle<'layer'>
export type DrawingSpace = 'world' | 'screen'

export type TextureInput =
    & { mipmaps?: boolean }
    & (
        | {
            kind: 'pixels'
            size: CanvasEngineSize
            rgba: Uint8Array | Uint8ClampedArray
        }
        | {
            kind: 'image'
            source: ImageBitmap | HTMLCanvasElement | OffscreenCanvas
        }
    )

export type MeshData = {
    positions: Float32Array
    uvs: Float32Array
    indices: Uint32Array
    version: number
}

export type MaterialBinding =
    | {
        kind: 'uniform'
        name: string
        binding: number
        type: 'f32' | 'vec2f' | 'vec3f' | 'vec4f' | 'mat3f' | 'mat4f'
        value: number | Float32Array
    }
    | {
        kind: 'texture'
        name: string
        binding: number
        samplerBinding: number
        texture: ResourceHandle<'texture'>
        sampling: 'nearest' | 'linear'
    }

export type MaterialProgram = {
    abi: 'canvas-material-v1'
    webgl: {
        vertex: string
        fragment: string
    }
    webgpu: {
        vertex: string
        fragment: string
    }
    bindings: readonly MaterialBinding[]
}

export type PathPaint = {
    fill?: {
        color: string
        alpha?: number
    }
    stroke?: {
        color: string
        alpha?: number
        width: number
        cap?: 'butt' | 'round' | 'square'
        join?: 'miter' | 'round' | 'bevel'
        dash?: readonly number[]
    }
}

export type VectorShape = PathPaint & {
    path: string
    holes?: readonly string[]
    projection?: {
        x: number
        y: number
        zoom: number
        snapResolution?: number
    }
}

export type GroupTransform = {
    position: CanvasEnginePoint
    scale: CanvasEnginePoint
    rotation: number
    order: number
}

export type CaptureSpec = {
    include: readonly (CanvasLayer | ResourceHandle<'group'>)[]
    exclude: readonly ResourceHandle<'group'>[]
    space: DrawingSpace
    bounds: CanvasEngineRect
    resolution?: number
    sampleBounds?: readonly CanvasEngineRect[]
    enabled?: boolean
}

export type CaptureResource = {
    handle: ResourceHandle<'capture'>
    texture: ResourceHandle<'texture'>
}

export type PaintHandle = ResourceHandle<'texture'> | ResourceHandle<'material'> | null
export type DrawingResources = {
    createGroup: (options: {
        space: DrawingSpace
        layer: CanvasLayer | ResourceHandle<'group'>
    }) => ResourceHandle<'group'>
    updateGroup: (
        group: ResourceHandle<'group'>,
        transform: Partial<GroupTransform>,
    ) => void
    setVisible: (
        resource: ResourceHandle<'group' | 'mesh' | 'path'>,
        visible: boolean,
    ) => void
    createTexture: (input: TextureInput) => ResourceHandle<'texture'>
    updateTexture: (
        texture: ResourceHandle<'texture'>,
        input: TextureInput,
    ) => void
    createMaterial: (program: MaterialProgram) => ResourceHandle<'material'>
    updateMaterial: (
        material: ResourceHandle<'material'>,
        bindings: readonly MaterialBinding[],
    ) => void
    createMesh: (
        group: ResourceHandle<'group'>,
        data: MeshData,
        paint: PaintHandle,
    ) => ResourceHandle<'mesh'>
    updateMesh: (
        mesh: ResourceHandle<'mesh'>,
        data: MeshData,
    ) => void
    setPaint: (
        mesh: ResourceHandle<'mesh'>,
        paint: PaintHandle,
    ) => void
    createPath: (
        group: ResourceHandle<'group'>,
        shapes: readonly VectorShape[],
    ) => ResourceHandle<'path'>
    updatePath: (
        path: ResourceHandle<'path'>,
        shapes: readonly VectorShape[],
    ) => void
    setMask: (
        group: ResourceHandle<'group'>,
        mask: ResourceHandle<'path'> | null,
    ) => void
    capture: (input: CaptureSpec) => CaptureResource
    updateCapture: (
        capture: ResourceHandle<'capture'>,
        input: CaptureSpec,
    ) => void
    displace: (
        group: ResourceHandle<'group'>,
        source: ResourceHandle<'texture'>,
        map: ResourceHandle<'texture'>,
        options: {
            bounds: CanvasEngineRect
            scale: CanvasEnginePoint
        },
    ) => Dispose
    release: (resource: ResourceHandle) => void
}
