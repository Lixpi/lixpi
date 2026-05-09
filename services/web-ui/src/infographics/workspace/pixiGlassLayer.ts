import {
    Application,
    Container,
    Filter,
    GlProgram,
    GpuProgram,
    Rectangle,
    RenderTexture,
    Sprite,
    Texture,
} from 'pixi.js'
import type { CanvasViewport } from '@lixpi/constants'

export type GlassRegion = {
    nodeId: string
    worldX: number
    worldY: number
    width: number
    height: number
    borderRadius: number
}

export type PixiGlassLayer = {
    // World-space glass (context region cards — moves with canvas pan/zoom).
    sync: (regions: GlassRegion[]) => void
    setViewport: (viewport: CanvasViewport) => void
    updateRegionLiveTransform: (nodeId: string, worldX: number, worldY: number, width: number, height: number) => void
    // Screen-space glass (floating panel — stays fixed on screen).
    syncScreenPanel: (rect: { x: number; y: number; width: number; height: number; borderRadius: number } | null) => void
    renderFrame: (app: Application) => void
    hasActiveRegions: () => boolean
    destroy: () => void
}

type PixiGlassLayerOptions = {
    app: Application
    world: Container
    fgLayer: Container
}

type GlassQuad = {
    sprite: Sprite
    texture: Texture
    filter: LiquidGlassFilter
    region: GlassRegion
    // Last computed screen bounds used for the texture frame.
    lastFrame: { x: number; y: number; w: number; h: number }
}

const GLASS_Z_INDEX = 50
const FG_Z_INDEX    = 100

// ─── GLSL fragment shader ────────────────────────────────────────────────────
//
// NOTE: No #version or precision — PIXI adds those via insertVersion /
// ensurePrecision.
//
// Key insight: the Sprite is textured with a *cropped* view of sceneRT
// (exactly the glass region's screen bounds). PIXI renders that sprite to
// the filter's input texture, so `uTexture` already contains exactly the
// background pixels that should show through the glass. We only need to
// warp the UV to create the lens/refraction effect — no separate background
// sampler needed.
const LIQUID_GLASS_FRAG = `
in vec2 vTextureCoord;

uniform sampler2D uTexture;

uniform highp vec4 uInputSize;
uniform highp vec4 uOutputFrame;
uniform highp vec4 uOutputTexture;

// Glass uniforms
uniform float uBorderRadius;
uniform float uTime;
uniform float uLensStrength;
uniform float uBlurStrength;

out vec4 fragColor;

float roundedBoxSDF(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
    // Half-size of the glass region in logical screen pixels.
    vec2 halfSize = uOutputFrame.zw * 0.5;

    // UV centred on glass: [-0.5, 0.5] in both axes.
    vec2 relUV = vTextureCoord - vec2(0.5);

    // Same offset in screen pixels.
    vec2 relPx   = relUV * uOutputFrame.zw;
    vec2 relNorm = relPx / halfSize;          // [-1, 1] in both axes

    // Rounded-rect SDF (negative inside, positive outside).
    float sdf  = roundedBoxSDF(relPx, halfSize, uBorderRadius);
    float mask = 1.0 - smoothstep(-1.5, 1.5, sdf);

    if (mask < 0.001) {
        fragColor = vec4(0.0);
        return;
    }

    // Lens distortion — pull UV toward centre proportional to depth inside
    // the glass shape (deeper = more refraction, matching a convex lens).
    float distInside = max(0.0, -sdf);
    float normInside = clamp(distInside / length(halfSize), 0.0, 1.0);
    vec2  lensUV     = vTextureCoord + relUV * uLensStrength * normInside;

    // 5×5 box blur at the lens-distorted UV (frosted glass diffusion).
    vec4  blurred = vec4(0.0);
    float total   = 0.0;
    // uInputSize.zw = (1/inputW, 1/inputH) — pixel step in UV space.
    vec2  step_   = vec2(uBlurStrength) * uInputSize.zw;
    for (float bx = -2.0; bx <= 2.0; bx += 1.0) {
        for (float by_ = -2.0; by_ <= 2.0; by_ += 1.0) {
            blurred += texture(uTexture, lensUV + vec2(bx, by_) * step_);
            total   += 1.0;
        }
    }
    blurred /= total;

    // Saturation lift: frosted glass tends to make refracted colours pop.
    float luma  = dot(blurred.rgb, vec3(0.299, 0.587, 0.114));
    blurred.rgb = mix(vec3(luma), blurred.rgb, 1.18);

    // ── Rim lighting ────────────────────────────────────────────────────────
    // Top caustic highlight — animated shimmer.
    float rimTopRaw  = max(0.0, -(relNorm.y + 0.55)) / 0.45;
    float rimTop     = clamp(rimTopRaw, 0.0, 1.0);
    float shimmer    = sin(uTime * 1.4 + relNorm.x * 3.14159) * 0.5 + 0.5;
    float catchlight = rimTop * (0.30 + shimmer * 0.10);

    // Bottom reflected fill.
    float rimBotRaw = max(0.0, (relNorm.y - 0.55)) / 0.45;
    float rimBottom = clamp(rimBotRaw, 0.0, 1.0);

    // Thin specular border all around the shape.
    float edgeNorm = sdf / length(halfSize);
    float rimEdge  = smoothstep(0.0, 0.012, -edgeNorm) *
                     (1.0 - smoothstep(0.05, 0.0, -edgeNorm));

    vec3 glass = clamp(
        blurred.rgb
            + vec3(catchlight)
            + vec3(rimBottom * 0.12)
            + vec3(rimEdge   * 0.28),
        0.0, 1.0
    );

    fragColor = vec4(glass, mask * 0.90);
}
`.trim()

// ─── WGSL (WebGPU) ───────────────────────────────────────────────────────────
const LIQUID_GLASS_WGSL = `
struct GlobalFilterUniforms {
    uInputSize    : vec4<f32>,
    uInputPixel   : vec4<f32>,
    uInputClamp   : vec4<f32>,
    uOutputFrame  : vec4<f32>,
    uGlobalFrame  : vec4<f32>,
    uOutputTexture: vec4<f32>,
};

@group(0) @binding(0) var<uniform> gfu  : GlobalFilterUniforms;
@group(0) @binding(1) var uTexture       : texture_2d<f32>;
@group(0) @binding(2) var uSampler       : sampler;

struct GlassUniforms {
    uBorderRadius : f32,
    uTime         : f32,
    uLensStrength : f32,
    uBlurStrength : f32,
};

@group(1) @binding(0) var<uniform> gu : GlassUniforms;

struct VSOutput {
    @builtin(position) position : vec4<f32>,
    @location(0)       uv       : vec2<f32>,
};

fn filterVertexPosition(aPosition: vec2<f32>) -> vec4<f32> {
    var pos = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;
    pos.x = pos.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
    pos.y = pos.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;
    return vec4<f32>(pos, 0.0, 1.0);
}

fn filterTextureCoord(aPosition: vec2<f32>) -> vec2<f32> {
    return aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw);
}

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
    return VSOutput(
        filterVertexPosition(aPosition),
        filterTextureCoord(aPosition),
    );
}

fn roundedBoxSDF_gpu(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
    let q = abs(p) - b + r;
    return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

@fragment
fn mainFrag(input: VSOutput) -> @location(0) vec4<f32> {
    let halfSize = gfu.uOutputFrame.zw * 0.5;
    let relUV    = input.uv - vec2<f32>(0.5);
    let relPx    = relUV * gfu.uOutputFrame.zw;
    let relNorm  = relPx / halfSize;

    let sdf  = roundedBoxSDF_gpu(relPx, halfSize, gu.uBorderRadius);
    let mask = 1.0 - smoothstep(-1.5, 1.5, sdf);

    if (mask < 0.001) {
        return vec4<f32>(0.0);
    }

    let distInside = max(0.0, -sdf);
    let normInside = clamp(distInside / length(halfSize), 0.0, 1.0);
    let lensUV     = input.uv + relUV * gu.uLensStrength * normInside;

    var blurred = vec4<f32>(0.0);
    var total   = 0.0;
    let step_   = vec2<f32>(gu.uBlurStrength) * gfu.uInputSize.zw;
    for (var bxi: i32 = -2; bxi <= 2; bxi++) {
        for (var byi: i32 = -2; byi <= 2; byi++) {
            let off = vec2<f32>(f32(bxi), f32(byi)) * step_;
            blurred += textureSample(uTexture, uSampler, lensUV + off);
            total   += 1.0;
        }
    }
    blurred /= total;

    let luma     = dot(blurred.rgb, vec3<f32>(0.299, 0.587, 0.114));
    blurred = vec4<f32>(mix(vec3<f32>(luma), blurred.rgb, 1.18), blurred.a);

    let rimTopRaw  = max(0.0, -(relNorm.y + 0.55)) / 0.45;
    let rimTop     = clamp(rimTopRaw, 0.0, 1.0);
    let shimmer    = sin(gu.uTime * 1.4 + relNorm.x * 3.14159) * 0.5 + 0.5;
    let catchlight = rimTop * (0.30 + shimmer * 0.10);

    let rimBotRaw = max(0.0, (relNorm.y - 0.55)) / 0.45;
    let rimBottom = clamp(rimBotRaw, 0.0, 1.0);

    let edgeNorm = sdf / length(halfSize);
    let rimEdge  = smoothstep(0.0, 0.012, -edgeNorm) *
                   (1.0 - smoothstep(0.05, 0.0, -edgeNorm));

    let glass = clamp(
        blurred.rgb
            + vec3<f32>(catchlight)
            + vec3<f32>(rimBottom * 0.12)
            + vec3<f32>(rimEdge   * 0.28),
        vec3<f32>(0.0), vec3<f32>(1.0)
    );

    return vec4<f32>(glass, mask * 0.90);
}
`.trim()

// ─── LiquidGlassFilter ───────────────────────────────────────────────────────

class LiquidGlassFilter extends Filter {
    private readonly _gu: Record<string, number>

    constructor() {
        // No vertex provided — GlProgram.from() defaults to PIXI's built-in
        // defaultFilterVert which handles the uOutputTexture.z y-flip correctly.
        const glProgram = GlProgram.from({
            fragment: LIQUID_GLASS_FRAG,
            name: 'liquid-glass-filter',
        })

        const gpuProgram = GpuProgram.from({
            vertex:   { source: LIQUID_GLASS_WGSL, entryPoint: 'mainVertex' },
            fragment: { source: LIQUID_GLASS_WGSL, entryPoint: 'mainFrag'   },
        })

        super({
            glProgram,
            gpuProgram,
            resources: {
                glassUniforms: {
                    uBorderRadius: { value: 18,   type: 'f32' },
                    uTime:         { value: 0,    type: 'f32' },
                    uLensStrength: { value: 0.15, type: 'f32' },
                    uBlurStrength: { value: 5.0,  type: 'f32' },
                },
            },
        })

        this._gu = this.resources.glassUniforms as Record<string, number>
        this.padding = 0
    }

    set time(v: number)         { this._gu['uTime']         = v }
    set borderRadius(v: number) { this._gu['uBorderRadius'] = v }
    set lensStrength(v: number) { this._gu['uLensStrength'] = v }
    set blurStrength(v: number) { this._gu['uBlurStrength'] = v }
}

// ─── createPixiGlassLayer ────────────────────────────────────────────────────

export function createPixiGlassLayer(options: PixiGlassLayerOptions): PixiGlassLayer {
    const { app, world, fgLayer } = options

    // World-space glass container — sits above sprites, below fg/selection.
    world.sortableChildren = true
    fgLayer.zIndex = FG_Z_INDEX
    const glassContainer = new Container({ label: 'workspace-pixi-glass' })
    glassContainer.zIndex = GLASS_Z_INDEX
    world.addChild(glassContainer)

    // Screen-space glass container — direct child of app.stage, not in world,
    // so it is not affected by the canvas pan/zoom world transform.
    const screenContainer = new Container({ label: 'workspace-pixi-glass-screen' })
    app.stage.addChild(screenContainer)

    // sceneRT: the pre-glass snapshot of the canvas. Created eagerly so
    // texture frames can reference it immediately.
    let sceneRT: RenderTexture = RenderTexture.create({
        width:      Math.max(1, Math.ceil(app.renderer.screen.width)),
        height:     Math.max(1, Math.ceil(app.renderer.screen.height)),
        resolution: app.renderer.resolution,
    })
    let sceneRTW = sceneRT.width
    let sceneRTH = sceneRT.height

    const quads = new Map<string, GlassQuad>()
    let screenQuad: GlassQuad | null = null
    let currentViewport: CanvasViewport = { x: 0, y: 0, zoom: 1 }
    let destroyed = false
    const startTime = performance.now()

    // ── helpers ─────────────────────────────────────────────────────────────

    function ensureSceneRT(): RenderTexture {
        const w = Math.max(1, Math.ceil(app.renderer.screen.width))
        const h = Math.max(1, Math.ceil(app.renderer.screen.height))
        if (sceneRTW !== w || sceneRTH !== h) {
            sceneRT.destroy(true)
            sceneRT = RenderTexture.create({ width: w, height: h, resolution: app.renderer.resolution })
            sceneRTW = w
            sceneRTH = h
            // Rebuild all textures so they reference the new RT.
            for (const quad of quads.values()) rebuildTexture(quad)
            if (screenQuad) rebuildTexture(screenQuad)
        }
        return sceneRT
    }

    // Rebuild the Sprite's texture to reference the latest sceneRT with the
    // correct frame for this quad's current screen-space bounds.
    function rebuildTexture(quad: GlassQuad): void {
        const { x, y, w, h } = quad.lastFrame
        if (quad.texture && !quad.texture.destroyed) quad.texture.destroy()
        quad.texture = new Texture({
            source: sceneRT.source,
            frame: new Rectangle(x, y, w, h),
        })
        quad.sprite.texture = quad.texture
    }

    // Compute the screen-space frame for a world-space region, update the
    // sprite's texture frame and position.
    function updateWorldQuadGeometry(quad: GlassQuad, vp: CanvasViewport): void {
        const { region } = quad
        const sx = region.worldX * vp.zoom + vp.x
        const sy = region.worldY * vp.zoom + vp.y
        const sw = region.width  * vp.zoom
        const sh = region.height * vp.zoom

        const frame = { x: sx, y: sy, w: sw, h: sh }
        const changed = frame.x !== quad.lastFrame.x || frame.y !== quad.lastFrame.y ||
                        frame.w !== quad.lastFrame.w || frame.h !== quad.lastFrame.h
        if (changed) {
            quad.lastFrame = frame
            quad.texture.frame = new Rectangle(sx, sy, sw, sh)
            quad.texture.updateUvs?.()
        }

        // World-space position and size of the sprite.
        quad.sprite.position.set(region.worldX, region.worldY)
        quad.sprite.width  = region.width
        quad.sprite.height = region.height

        // Border radius scaled by zoom so the SDF in screen pixels is correct.
        quad.filter.borderRadius = region.borderRadius * vp.zoom
    }

    // Update the screen-space glass quad (for the fixed floating panel).
    function updateScreenQuadGeometry(
        quad: GlassQuad,
        rect: { x: number; y: number; width: number; height: number; borderRadius: number },
    ): void {
        const frame = { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
        const changed = frame.x !== quad.lastFrame.x || frame.y !== quad.lastFrame.y ||
                        frame.w !== quad.lastFrame.w || frame.h !== quad.lastFrame.h
        if (changed) {
            quad.lastFrame = frame
            quad.texture.frame = new Rectangle(rect.x, rect.y, rect.width, rect.height)
            quad.texture.updateUvs?.()
        }

        // Screen-space coordinates — no zoom scaling needed here.
        quad.sprite.position.set(rect.x, rect.y)
        quad.sprite.width  = rect.width
        quad.sprite.height = rect.height
        quad.filter.borderRadius = rect.borderRadius
    }

    function createWorldQuad(region: GlassRegion): GlassQuad {
        const sx = region.worldX * currentViewport.zoom + currentViewport.x
        const sy = region.worldY * currentViewport.zoom + currentViewport.y
        const sw = region.width  * currentViewport.zoom
        const sh = region.height * currentViewport.zoom

        const texture = new Texture({
            source: sceneRT.source,
            frame: new Rectangle(sx, sy, sw, sh),
        })
        const sprite = new Sprite(texture)
        sprite.label = `pixi-glass-${region.nodeId}`
        sprite.eventMode = 'none'

        const filter = new LiquidGlassFilter()
        sprite.filters = [filter]
        glassContainer.addChild(sprite)

        const quad: GlassQuad = {
            sprite, texture, filter, region,
            lastFrame: { x: sx, y: sy, w: sw, h: sh },
        }
        updateWorldQuadGeometry(quad, currentViewport)
        return quad
    }

    function destroyQuad(quad: GlassQuad): void {
        quad.sprite.parent?.removeChild(quad.sprite)
        quad.sprite.destroy()
        quad.texture.destroy()
    }

    // ── public API ───────────────────────────────────────────────────────────

    function updateRegionLiveTransform(nodeId: string, worldX: number, worldY: number, width: number, height: number): void {
        if (destroyed) return
        const quad = quads.get(nodeId)
        if (!quad) return
        quad.region = { ...quad.region, worldX, worldY, width, height }
        updateWorldQuadGeometry(quad, currentViewport)
    }

    function sync(regions: GlassRegion[]): void {
        if (destroyed) return
        const incomingIds = new Set(regions.map((r) => r.nodeId))

        for (const [id, quad] of quads) {
            if (!incomingIds.has(id)) {
                destroyQuad(quad)
                quads.delete(id)
            }
        }

        for (const region of regions) {
            const existing = quads.get(region.nodeId)
            if (existing) {
                existing.region = region
                updateWorldQuadGeometry(existing, currentViewport)
            } else {
                quads.set(region.nodeId, createWorldQuad(region))
            }
        }
    }

    function setViewport(viewport: CanvasViewport): void {
        if (destroyed) return
        currentViewport = viewport
        for (const quad of quads.values()) {
            updateWorldQuadGeometry(quad, viewport)
        }
    }

    function syncScreenPanel(rect: { x: number; y: number; width: number; height: number; borderRadius: number } | null): void {
        if (destroyed) return

        if (!rect) {
            if (screenQuad) {
                destroyQuad(screenQuad)
                screenQuad = null
            }
            return
        }

        if (!screenQuad) {
            const texture = new Texture({
                source: sceneRT.source,
                frame: new Rectangle(rect.x, rect.y, rect.width, rect.height),
            })
            const sprite = new Sprite(texture)
            sprite.label = 'pixi-glass-screen-panel'
            sprite.eventMode = 'none'
            const filter = new LiquidGlassFilter()
            sprite.filters = [filter]
            screenContainer.addChild(sprite)
            screenQuad = {
                sprite, texture, filter,
                region: { nodeId: '__screen__', worldX: rect.x, worldY: rect.y, width: rect.width, height: rect.height, borderRadius: rect.borderRadius },
                lastFrame: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
            }
        }

        updateScreenQuadGeometry(screenQuad, rect)
    }

    function hasActiveRegions(): boolean {
        return !destroyed && (quads.size > 0 || screenQuad !== null)
    }

    function renderFrame(appRef: Application): void {
        if (destroyed) return

        const rt = ensureSceneRT()

        // Pass 1: render the scene WITHOUT any glass into sceneRT.
        glassContainer.renderable = false
        screenContainer.renderable = false
        appRef.renderer.render({ container: appRef.stage, target: rt, clear: true })
        glassContainer.renderable = true
        screenContainer.renderable = true

        // Refresh each sprite's texture to point to the updated sceneRT.
        // (Only needed when the RT was recreated — texture.source already
        // points to the same RenderTexture source object otherwise.)
        const elapsed = (performance.now() - startTime) / 1000
        for (const quad of quads.values()) {
            quad.filter.time = elapsed
        }
        if (screenQuad) {
            screenQuad.filter.time = elapsed
        }
    }

    function destroy(): void {
        if (destroyed) return
        destroyed = true
        for (const quad of quads.values()) destroyQuad(quad)
        quads.clear()
        if (screenQuad) { destroyQuad(screenQuad); screenQuad = null }
        sceneRT.destroy(true)
        world.removeChild(glassContainer)
        glassContainer.destroy()
        app.stage.removeChild(screenContainer)
        screenContainer.destroy()
    }

    return { sync, setViewport, updateRegionLiveTransform, syncScreenPanel, renderFrame, hasActiveRegions, destroy }
}
