# Rendering Architecture for a Media-Heavy AI Canvas

This document is the technical foundation for the choice of rendering stack in Lixpi as it evolves from a node-based AI chat board into a full **AI visual-media production canvas** — hundreds to thousands of images, videos, and generative artifacts on a single infinite surface, with interactive mask region selection and per-frame editing piped back to AI models.

It explains, with primary sources, what every leading platform (Figma, FigJam, Google Stitch, Krea, Visual Electric, Recraft, ComfyUI, Miro) actually uses under the hood, why those choices matter, where each technique breaks, and the concrete architecture Lixpi should adopt.

---

## 1. The Two Walls

Every infinite canvas built for the web hits one of two ceilings:

1. **The DOM ceiling.** Real DOM elements with CSS transforms scale wonderfully up to a few hundred items. Past that, layout, paint, compositing, hit-testing, scroll containers, and the GC start to degrade. Concrete data point: on a well-optimized DOM canvas like tldraw, **~1,000 cards is where the zoom starts feeling sluggish**[¹]. Naive HTML hits noticeable lag earlier.

2. **The GPU floor.** Once you adopt WebGL/WebGPU, you escape the DOM but you take on the entire problem of building a renderer — your own scene graph, your own text layout, your own hit-testing, your own selection, your own focus management, your own accessibility. Figma's renderer is **~120,000+ lines of C++ compiled to WebAssembly**[²], and they had to write a custom shader processor that translates GLSL → WGSL just to migrate WebGL → WebGPU.

The interesting work happens in between — **knowing exactly what to push down to the GPU and what to keep in DOM**. This document is about how the leading platforms make that split, and what's right for Lixpi.

---

## 2. What the Leaders Actually Use

Pulled from primary sources: Figma engineering blog, Google Labs announcements, ComfyUI architecture RFC, PixiJS v8 release notes, Krea / Visual Electric / Recraft public docs, Miro engineering Medium, MDN.

### 2.1 Figma & FigJam — Bespoke C++ + WebGL → WebGPU Renderer

Figma's editor is **a game engine in disguise**. Co-founder Evan Wallace wrote in 2015[³]:

> "We've implemented our own rendering engine to make sure content renders quickly and consistently across platforms... Internally our code looks a lot like a browser inside a browser; we have our own DOM, our own compositor, our own text layout engine."

The reasons given for not using HTML/SVG/Canvas2D were specific:

> "HTML and SVG contain a lot of baggage and are often much slower than the 2D canvas API due to DOM access. These are usually optimized for scrolling, not zooming, and **geometry is often re-tessellated after every scale change**... The 2D canvas API is an immediate mode API instead of a retained mode API so all geometry has to be re-uploaded to the graphics card every frame."

The actual stack:

| Layer | Tech | Source |
|---|---|---|
| Renderer language | C++ | [building-a-professional-design-tool-on-the-web][3] |
| Web compilation | LLVM → asm.js (2015), now WebAssembly via Emscripten | [webassembly-cut-figmas-load-time-by-3x][4] |
| GPU API | WebGL since 2015, **WebGPU since 2025** with WebGL fallback | [figma-rendering-powered-by-webgpu][5] |
| Renderer architecture | Tile-based, retained mode, fully anti-aliased on GPU | [building-a-professional-design-tool-on-the-web][3] |
| Text | Custom layout engine (no `Canvas.fillText`, no SVG, no DOM) | [building-a-professional-design-tool-on-the-web][3] |
| Shader translation | GLSL (WebGL 1) → custom processor → WGSL via `naga` | [figma-rendering-powered-by-webgpu][5] |
| Server-side rendering | Same C++ compiled to native x64/arm64 | [figma-rendering-powered-by-webgpu][5] |
| Document streaming | Incremental frame loading; per-subtree subscriptions over CRDT-like protocol | [incremental-frame-loading][6] |

Figma engineering manager Alice Ching is explicit about the philosophy[⁷]:

> "On top of that, the code has to run inside of a browser window or in a mobile app, both of which present more memory and performance constraints. To satisfy these constraints, we have opted to use a tech stack that **looks more similar to a game engine's stack than a web stack**. We build the canvas in C++ then compile it into WebAssembly."

WebGPU specifically unlocks for them:

- **Compute shaders** to move blur, filters, and effects from CPU to GPU
- **MSAA** (Multi-Sample Anti-Aliasing) without manual workarounds
- **RenderBundles** to reduce CPU overhead per frame
- Removal of WebGL's bug-prone global state
- Async error handling that doesn't tank performance

FigJam runs on the same engine. The cost: a multi-year engineering effort, a dynamic WebGPU↔WebGL fallback system because of buggy Windows GPU drivers, and the decision to never use the browser's text input — they had to file Chromium/Firefox/WebKit bugs to fix custom-cursor and pinch-zoom support to make the browser viable as a host[³].

### 2.2 Google Stitch — AI-Native Infinite Canvas (Gemini)

Google Stitch (Google Labs, March 2026 update) is Google's AI-native UI design surface[⁸]:

- Multi-screen generation: up to **5 interconnected screens generated simultaneously** with consistent typography, color palette, and component libraries
- Natural-language → multi-screen design via Gemini 2.5 Pro (refined) or Gemini 2.5 Flash (rapid)
- "Vibe design" agent that reasons across the entire project's evolution
- Interactive preview: click "Play" to simulate user navigation through generated screens

Google has not published rendering details, but the canvas is web-based. The interesting product lesson is the **multi-screen generation pattern** — the canvas isn't just a place to drop AI outputs, it's a topological surface where AI generates *related* artifacts that share state. This is exactly Lixpi's thesis taken further.

### 2.3 Krea — Realtime AI Generation Canvas

Krea is the closest competitor on the "AI media board" axis[⁹]:

- Realtime generation with **sub-50ms render** for live drawing/typing feedback
- Native 4K image generation, upscaling to 22K
- Desktop client uses "native GPU utilization for smoother UI rendering compared to the browser" — implying the browser version *isn't* GPU-accelerated to the same degree
- Web canvas implementation details not publicly documented

### 2.4 Visual Electric — Model-Agnostic Infinite Canvas

The closest architectural mirror to Lixpi[¹⁰]:

- Infinite canvas over multiple models (SDXL, GPT Image, Flux Ultra, Imagen 4, Veo 3)
- **Model-agnostic by design** — founders' explicit thesis: "image generation models are becoming commoditized; the frontend UI is the key differentiator"
- Visual prompt builder (reference images + style chips) instead of text-only prompts
- Real-time collaboration on shared canvases
- Founded by ex-Lobe (Microsoft acquisition) team

Public rendering technology not disclosed.

### 2.5 Recraft — Infinite Canvas for AI Design

Recraft[¹¹]:

- Infinite canvas with freeform navigation, panning, zooming, scrolling
- Pointer + hand tools, single/multi selection, right-click "Generate here" at canvas location
- Recraft V4: 1K and 2K Pro resolutions, layout-aware composition, typography integration

Underlying renderer not public.

### 2.6 ComfyUI Frontend — Hybrid Vue + Canvas2D

ComfyUI's **architectural RFC** is unusually candid about the trade-offs[¹²]:

| Layer | Tech | Why |
|---|---|---|
| Node content (widgets, forms, interaction) | **Vue 3 DOM components** | Native form controls, accessibility, contenteditable |
| Connection rendering (Bezier/straight links) | **Canvas2D** | Many edges, simple geometry |
| Pan/zoom | **CSS transforms** | O(1) GPU-composited |
| Hit-testing | **QuadTree spatial queries** | O(log n) instead of O(n) |
| State management | **Yjs CRDT** | Reactive position/size updates |

The RFC explicitly contrasts this against React Flow / xyflow:

> "Avoids routing every mouse-move pixel through React hooks, prop subscriptions, and virtual DOM reconciliation."

This is the **hybrid model** at the maturity end. Vue handles widget logic; Canvas2D handles fast rendering operations.

### 2.7 Miro — PIXI.js Hybrid

Covered in detail elsewhere. Summary: PIXI.js (WebGL-backed Canvas2D) for shapes/strokes; SVG `<foreignObject>` baked into canvas for text; DOM overlays for complex interactive widgets (Ace code editor); raster + vector LoD pyramids; `Float64Array` typed arrays for points (cut memory ~3×)[¹³].

---

## 3. The Numbers — Concrete Benchmarks

The following are real, measured benchmarks from practitioners on infinite-canvas workloads, not synthetic micro-benchmarks.

### 3.1 DOM vs PIXI.js (WebGL/WebGPU) — same app, two implementations[¹]

Pyramid Notes case study, Feb 2026, infinite-canvas note app:

| Implementation | Lag threshold | Notes |
|---|---|---|
| **Naive DOM** | ~1,000 elements | Sluggish zoom; shadow toggling shows cost |
| **Well-optimized DOM** (tldraw-class) | ~1,000–10,000 elements | Smooth pan, zoom is the pain point |
| **Naive PIXI.js** | ~10,000 elements | Same app port, no optimization |
| **PIXI.js + culling + LoD** | ~50,000–60,000 snappy | Custom culling, texture baking, BitmapText, dynamic LoD |
| **PIXI.js fully optimized** | ~90,000 unique elements | Past 95k Chrome occasionally crashes |

Author's verdict, verbatim:

> "PixiJS approach is **10x more performant** than optimized HTML for similar workloads."

### 3.2 PixiJS v8 — pure sprite rendering benchmarks[¹⁴]

100,000 sprites, on the v8 release announcement:

| Scenario | v7 → v8 CPU | v7 → v8 GPU |
|---|---|---|
| 100k sprites all moving | 50ms → 15ms (3.3×) | 50ms → 9ms (5.5×) |
| 100k sprites not moving | 21ms → 0.12ms (175×) | 9ms → 0.5ms (18×) |
| 100k sprites with scene structure changes | 50ms → 24ms (2.1×) | — |

PixiJS v8 made WebGPU a first-class renderer (with automatic WebGL fallback) and introduced a two-layer texture architecture: `TextureSource` (pixel data) is decoupled from `Texture` (view metadata into an atlas).

### 3.3 The browser's hard limits on video[¹⁵]

WebCodecs concurrent codec operations:

| Browser | Concurrent video decoders |
|---|---|
| Safari / WebKit | 4 |
| Chrome | 1–8 (varies by load) |
| Firefox | 1 |

Media Source Extensions buffer per-video:

| Browser | Video buffer | Audio buffer |
|---|---|---|
| Chrome | 150 MB | 12 MB |
| Safari | 290 MB | 14 MB |
| Firefox | 100 MB | 15 MB |

**This is the hard ceiling no renderer can solve.** No matter what graphics API you choose, you cannot have more than ~4–8 videos actively decoding at once. Anything beyond that has to be policy: pause off-screen, show poster frames, scrub-on-demand.

### 3.4 The single-sprite cost on DOM vs Canvas

Per-element cost from Figma's 2015 analysis[³]:

> "The 2D canvas API is an immediate mode API instead of a retained mode API so **all geometry has to be re-uploaded to the graphics card every frame**."

That is the fundamental Canvas2D problem at scale. PIXI.js / Three.js / WebGPU solve it by retaining geometry on the GPU via vertex buffers + texture atlases.

---

## 4. The Five Hard Ceilings on a Web Canvas

Independent of renderer choice, these are physical limits:

| Ceiling | Concrete limit | Mitigation |
|---|---|---|
| **DOM elements** | Lag past ~1k–10k (depends on per-element complexity) | Culling, LoD swap to thumbnails |
| **GPU texture memory** | ~1–4 GB on consumer hardware; ~256 MB on iPad | Mipmaps, virtual textures, atlas eviction |
| **GPU draw calls** | ~10k–100k per frame ceiling | Sprite batching by texture, instancing |
| **Concurrent video decoders** | 1 (FF) / 4 (Safari) / 1–8 (Chrome) | Pause off-screen, poster frames |
| **WebAssembly heap** | 4 GB hard cap; ~256 MB practical on 32-bit Chrome | Out-of-heap typed arrays |

The job of a serious media canvas is to **stay within all five simultaneously**.

---

## 5. The Image Problem at Scale

A workspace with 1,000 AI-generated images is not 1,000 `<img>` tags. It's a **GPU memory management problem** that has to handle three independent concerns:

### 5.1 Decoding

Decoding a 2K JPEG takes 5–20ms on the main thread. Doing 1,000 of them blocks the UI for 5–20 seconds. The solution is well-established:

- **`createImageBitmap()` in a Web Worker** → produces a `ImageBitmap` (a transferable handle to GPU-ready pixel data)[¹⁶]
- Transfer the `ImageBitmap` back to the main thread
- Upload to GPU as a texture (PIXI: `Texture.from(bitmap)`; WebGPU: `device.queue.copyExternalImageToTexture`)

This pattern keeps decode entirely off the main thread and hands the GPU pre-decoded pixel data.

### 5.2 Memory

A 2048×2048 RGBA image = **16 MB of GPU memory**. 1,000 of them = 16 GB. No consumer GPU has that. The only workable approaches:

**Mipmap pyramids.** Each image gets a chain of half-resolution copies down to ~16px. The GPU samples the level appropriate to the on-screen size. Memory cost is 4/3 the original (a geometric series). Built-in to WebGL/WebGPU; PIXI handles it.

**Level-of-detail (LoD) thumbnails on the server.** Generate 256px and 1024px proxies at upload time. Serve the proxy at low zoom; swap to full-resolution only above some zoom threshold. This is what Miro does ("LoDs are stored in memory; they are turned on at certain points in time: as a rule, when the actual size of the widget on the screen is reduced relative to its specified size")[¹³] and it's the **single highest-leverage memory optimization** for an AI media board.

**Virtual textures / mega-textures.** Used in production by Kiln-render and similar systems[¹⁷]:

- Divide huge images into 256×256 tiles
- Build coarse versions at multiple LoDs
- A lookup table maps "this region of this image at this LoD" → "this slot in the assembled atlas texture"
- The atlas is a fixed-size GPU cache; least-recently-used tiles get evicted

This is the only way to render multi-gigapixel scenes (think: a workspace with 1,000 4K images, or a single 100-megapixel render) in constant VRAM. Overkill for Lixpi's first version; relevant if you go to 5K+ resolution video frames.

### 5.3 Drawing

Even with all images decoded and uploaded, you still need to draw them every frame. Each `<img>` in DOM, each Canvas2D `drawImage`, each WebGL `gl.drawArrays` is a **draw call**.

The defining technique on WebGL/WebGPU is **sprite batching by texture atlas**. PIXI v8 documentation[¹⁸]:

> "Sprites can batch with up to 16 different textures (hardware-dependent). Order sprites by texture to reduce batch breaks."

In practice: pack many small images into a few big atlas textures, then draw all sprites from one atlas in a single draw call. 1,000 images become ~10–50 draw calls instead of 1,000.

---

## 6. The Video Problem at Scale

Video is fundamentally different from images because **decoding is continuous**. You cannot just "load and forget." The browser must maintain a decoder pipeline running at the video's framerate.

### 6.1 The hardware limit is unforgiving

(See section 3.3.) You get ~4–8 active decoders on Chrome, fewer on Safari and Firefox. There is no software workaround.

### 6.2 The right pipeline for the surviving 4–8 videos

The fast path on modern browsers:

1. **`<video>` element** drives decoding and timing (or `VideoDecoder` from WebCodecs for low-level control)
2. **`importExternalTexture({ source: video })`** from WebGPU pulls a **zero-copy** GPU texture from the video element's hardware-decoded YUV buffer[¹⁹]
3. The texture is consumed in a fragment shader that does YUV → RGB conversion on the GPU
4. The texture is only valid for the current `requestAnimationFrame` callback — re-import each frame

This is the **only** way to draw a video into a custom GPU pipeline without paying CPU↔GPU copy costs that crater framerate. Without it, you're back to `drawImage(video, ...)` on Canvas2D which copies pixels through CPU memory every frame.

### 6.3 Frame-stepping for masks / rotoscope

For the planned mask-region selection on video frames:

- Use **`requestVideoFrameCallback`** on the `<video>` element to get exact frame-presentation events
- Or use **WebCodecs `VideoDecoder.decode(chunk)`** to get a `VideoFrame` you can paint without playing the video
- A `VideoFrame` is a `CanvasImageSource` and works with both `drawImage` and `importExternalTexture`

### 6.4 Off-screen video must die

Pause and unmount any `<video>` element that is not visible. Show its `poster` (or a captured first-frame) as a static `<img>`. Reattach when it scrolls back in. This single rule is the difference between "10 videos on the canvas" feeling fine and "10 videos on the canvas" tanking the entire browser tab.

---

## 7. The Recommended Architecture for Lixpi

Given the new scope (hundreds-to-thousands of media objects, mask region selection, video editing), the right architecture is a **deliberate hybrid** along the same lines as Miro and ComfyUI, but biased toward GPU acceleration for the media layer because that is the dominant workload.

### 7.1 The split

```
┌─────────────────────────────────────────────────────────────────┐
│ Workspace (single infinite canvas)                              │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Media layer — PIXI.js v8 (WebGPU + WebGL fallback)        │  │
│  │ • Image nodes (sprite from atlas)                         │  │
│  │ • Video nodes (sprite from importExternalTexture)         │  │
│  │ • Generation placeholders & progressive previews          │  │
│  │ • Edges/connectors as Mesh Lines                          │  │
│  │ • Selection rectangles, marquee, hover halos              │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ DOM overlay layer (positioned absolutely, CSS-transformed)│  │
│  │ • Floating prompt input (rich-text editor)                │  │
│  │ • Bubble menu, context menus, model dropdowns             │  │
│  │ • Active node editor when one is focused                  │  │
│  │ • Tooltips, badges                                        │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Per-image / per-frame mask editor (modal, opened on demand)     │
│                                                                 │
│  • HTML5 Canvas 2D for brush/eraser/polygon paint               │
│  • OffscreenCanvas in worker for compositing                    │
│  • WebGPU via onnxruntime-web for SAM2 inference                │
│  • Output: binary PNG mask + original → AI image-edit endpoint  │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 Why PIXI.js v8 specifically (not raw WebGPU, not Three.js)

Reading the current frontier:

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Raw WebGPU** | Maximum control; what Figma uses | Years of work; you build everything | No — Figma-scale only |
| **PIXI.js v8** | WebGPU-first with WebGL fallback; mature 2D scene graph; sprite batching, mesh lines, BitmapText, masks; proven 60k–100k objects | Some WebGPU regressions on certain GPUs[¹⁴] | **Yes** — sweet spot |
| **Three.js** | Bigger ecosystem; both 2D and 3D | Built for 3D; over-abstracted for 2D AI boards | No — wrong shape |
| **Konva.js** | Clean object model; good DX | Canvas2D only, not WebGL/WebGPU | No — same ceiling as today |
| **Fabric.js** | SVG support, image editing primitives | Canvas2D, slower than PIXI | No — same ceiling |
| **PencilJS / Two.js** | Tiny, good for charts | Not built for thousands of media | No |

PIXI.js v8 is the right primitive: it gives you WebGPU when available, falls back to WebGL automatically, ships a battle-tested texture atlas + sprite batcher, and has a Vue/Svelte-friendly imperative API that fits your existing `WorkspaceCanvas.ts` orchestrator pattern.

### 7.3 Keep what already works

The current `XYPanZoom`, `XYDrag`, `XYHandle`, `XYResizer` from `@xyflow/system` are **pure math state machines** with zero rendering. They produce numbers and call back. Continue using them — they are renderer-agnostic. Apply the resulting transform to PIXI's `viewport` instead of (or in addition to) the CSS transform on a DOM element.

### 7.4 Keep ProseMirror for the focused editor only

Render nodes as PIXI sprites by default (with cached text rendered to a texture). When the user clicks a node to edit it, **mount a single ProseMirror instance** as a DOM overlay positioned over the sprite. On blur, render the new content to a texture and unmount the editor. Result: 1,000 nodes, 1 active editor — not 1,000 ProseMirror instances.

This is the same pattern Miro uses for code editors[¹³] and ComfyUI uses for widget forms[¹²].

### 7.5 The four-tier media LoD system

Imitate Miro and Pyramid:

| Zoom range | What gets rendered | Why |
|---|---|---|
| < 0.1 | Tinted rectangle (one color, no texture) | Cards too small to read |
| 0.1 – 0.4 | 256×256 server-side thumbnail texture | Recognizable but cheap |
| 0.4 – 1.0 | 1024×1024 texture | High quality at typical zoom |
| ≥ 1.0 | Full-resolution texture, mipmapped | When user zooms in to inspect |

Combined with viewport culling via an R-tree (`rbush`) or PIXI's built-in container culling, this is what gets you to the "thousands of objects" promise.

### 7.6 The video pipeline

For each video sprite on the canvas:

1. Default state = **paused**, displaying the poster frame as a static texture
2. Auto-play only when the user explicitly hovers / clicks, *and* the cap of N concurrent active videos has not been reached (cap N = 4 to be safe across all browsers)
3. Active videos use `importExternalTexture()` per frame for zero-copy GPU compositing
4. When a video scrolls out of viewport: pause, release `importExternalTexture` reference, swap back to poster

For multi-frame mask propagation (rotoscope):

1. Decode frames via `VideoDecoder` from WebCodecs into `VideoFrame` objects
2. Paint the user's mask on a Canvas2D layer over the frame
3. Run SAM2-Video inference via onnxruntime-web (WebGPU)
4. Send the per-frame mask + original frames to the AI editing endpoint

### 7.7 The mask editor (per-image / per-frame, modal)

This is **NOT** part of the workspace renderer. It's a focused full-screen overlay:

| Layer | Tech |
|---|---|
| Base image | HTML5 Canvas 2D, with mipmap-aware drawing |
| Mask alpha | Second HTML5 Canvas 2D, blended over base |
| Brush input | Pointer events on overlay div, coordinates → mask canvas |
| Heavy composite | OffscreenCanvas in a Web Worker (Safari supports this) |
| AI segmentation | WebGPU via `onnxruntime-web` with WASM/CPU fallback; SAM2 (~150 MB) cached in OPFS |
| Output | Binary PNG mask + original → `image_edit` API call |

The same overlay handles both static images and individual video frames. This is exactly the architecture Maskify, Nano Banana Editor, and Photopea use.

### 7.8 Inter-service data flow stays NATS-native

No changes to the existing NATS architecture. The PIXI sprites read from the same `canvasState.nodes`, `canvasState.edges`, and image references (`nats-obj://` URLs from JetStream Object Store) that the current DOM nodes read. PIXI is a pure renderer; persistence and streaming are unaffected.

---

## 8. Concrete Migration Path

Four phases, each independently shippable. Skip ahead only if profiling on real workloads demands it.

### Phase 0 — Baseline measurement (1 week)

Before changing anything, instrument the current canvas. Measure:

- Time from "open workspace" to first interaction at N nodes, for N ∈ {10, 50, 200, 500, 1000}
- Frame time during pan and zoom at each N
- Memory snapshot at each N (Chrome DevTools heap + GPU memory)
- Repeat for image-heavy workspaces (replace document nodes with image nodes of varying resolution)

This is your performance baseline. Without it, every later change is theatre.

### Phase 1 — DOM optimizations within the current stack (1–2 weeks)

Pull the highest-leverage Miro/tldraw techniques without changing renderer:

- **Viewport culling via R-tree** (`rbush`). Hide nodes outside viewport bounds.
- **Server-side image LoD** — generate 256px and 1024px proxies at upload; deliver the right one based on zoom + on-screen size.
- **Lazy ProseMirror mounting** — render document/thread nodes as static HTML thumbnails; mount the editor only when focused.
- **`willChange: transform` and `contain: layout paint` on viewport.**
- **Defer all expensive work in the pan/zoom callback to `requestAnimationFrame`** (already done in places — verify everywhere).

This will get you cleanly to ~1,000 mixed nodes feeling smooth, which already exceeds typical use.

### Phase 2 — PIXI.js media layer for image and video nodes (3–6 weeks)

Introduce PIXI as the renderer for **media nodes only** (image, video, generation placeholders):

- Stand up a single PIXI `Application` with WebGPU preferred, WebGL fallback
- Reuse the current `XYPanZoom` state — apply its transform to PIXI's root container instead of CSS
- Render image nodes as `Sprite`s from a `TextureSource` atlas; load proxies via `createImageBitmap` in a Web Worker
- Connector lines: SVG stays for now (low edge counts); migrate to PIXI `MeshLine` only if profiling demands
- Document and chat-thread nodes: stay as DOM overlays positioned via `worldToScreen` math
- Implement the four-tier LoD system from §7.5

Target: **5,000 image nodes feel as smooth as 100 do today.**

### Phase 3 — Video pipeline with WebGPU (2–4 weeks)

When video shipping begins:

- Default: poster image only, zero active `<video>` elements
- On user interaction: promote up to N=4 videos to active decoding
- Active videos rendered via `importExternalTexture()` zero-copy WebGPU path
- Strict virtualization: pause + release on scroll-out
- `requestVideoFrameCallback` for any frame-locked overlays (timeline scrubbers, mask painting)

### Phase 4 — Mask editor modal (2–4 weeks)

The new feature. Not migration but addition:

- Modal overlay separate from workspace
- Two-layer Canvas2D editor (image + mask)
- OffscreenCanvas worker for composite preview
- onnxruntime-web with WebGPU backend; SAM2.1 model (~150 MB) cached in OPFS
- Output PNG mask + original → existing LLM API → OpenAI `image_edit` / Gemini Nano Banana
- Reuse the same modal for individual video frames; SAM2-Video for mask propagation across frames

### Phase 5 (only if needed) — Virtual textures for 5K+ images

Only if a workspace routinely contains hundreds of 5K+ images and Phase 2 LoD is not enough. Implement a mega-texture / virtual texture system (256×256 tiles, lookup table, fixed-size brick cache) on the PIXI layer.

---

## 9. Decision Criteria — When to Pick Each Layer

Quick reference for future work:

| Bottleneck observed in profiling | Reach for | Avoid |
|---|---|---|
| ProseMirror re-mount cost on workspace open | Lazy mount editors only on focus | Touching renderer |
| Pan/zoom janks past N nodes | R-tree viewport culling + LoD | More CSS containment alone |
| 1k+ images blow GPU memory | Server-side thumbnails + mipmaps | Drawing all to one big canvas |
| Image decode blocks main thread | `createImageBitmap` in Worker | Synchronous `new Image()` |
| 1k+ sprites tank framerate even after culling | PIXI.js + texture atlas batching | Canvas2D `drawImage` per-frame |
| 4+ videos, browser refuses to decode | Strict virtualization, max-active cap | WebCodecs custom decoder (last resort) |
| Video draws cost CPU in Canvas2D | WebGPU `importExternalTexture()` | `ctx.drawImage(video, ...)` |
| SAM/SAM2 inference CPU-bound | WebGPU via onnxruntime-web | Server inference (privacy/cost issues) |
| Brush stroke laggy | Canvas2D in modal + OffscreenCanvas worker | SVG path painting |
| Multi-gigapixel images / 5K+ video frames | Virtual textures (mega-texture) | Loading full resolution into VRAM |

---

## 10. What This Architecture Buys You

By adopting this hybrid:

- **Headroom** to 5,000+ mixed media objects on a single canvas before any user-visible perf degradation
- **A path to 50,000+** if Phase 5 ever becomes necessary (proven by Pyramid's PIXI case study)
- **Zero compromise on ProseMirror** for the active editor — DOM stays where it shines
- **A real video pipeline** that respects the browser's hardware decoder limits instead of fighting them
- **A first-class mask editor** that sits on the same WebGPU substrate, ready for SAM2 inference today and future segmentation models tomorrow
- **No bet on a custom C++ renderer** — Lixpi gets ~80% of Figma's rendering ceiling at ~5% of Figma's renderer team cost, by leveraging PIXI v8's WebGPU support and the browser's native compositor
- **Independence from `@xyflow/system`'s opinions** about DOM structure — XYPanZoom and friends are pure math; they work with PIXI as well as DOM

---

## 11. What This Architecture Does NOT Try To Do

- **Match Figma's pixel quality at extreme zoom** — Figma rasterizes everything on-GPU with custom antialiasing. PIXI uses standard WebGPU/WebGL antialiasing which is excellent but not custom. For an AI media board, the difference is invisible.
- **Replace the browser's text input** — typing always happens in real DOM via ProseMirror. Figma reimplemented text input because they are a typography tool; Lixpi is not.
- **Render the entire workspace in one C++ engine** — that path requires a dedicated rendering engineer org for years. The PIXI hybrid gets the same outcome for a single-developer migration.
- **Solve concurrent video decoding** — you cannot. The browser's decoder limit is a physical wall. The architecture works *with* it via virtualization.

---

## Sources

[¹] [alanscodelog.github.io/blog/performant-pixi-infinite-canvas](https://alanscodelog.github.io/blog/performant-pixi-infinite-canvas/) — Pyramid Notes: Handling Thousands of Cards on an Infinite Canvas (Feb 2026). Texture baking, custom culling, dynamic LoD, idle generation. Real benchmarks for DOM vs PIXI at 1k–100k nodes.

[²] Inferred from public Figma blog content; Figma has not published exact LOC for the renderer.

[³] [figma.com/blog/building-a-professional-design-tool-on-the-web](https://figma.com/blog/building-a-professional-design-tool-on-the-web) — Evan Wallace, Dec 2015. The original architectural manifesto.

[⁴] [figma.com/blog/webassembly-cut-figmas-load-time-by-3x](https://figma.com/blog/webassembly-cut-figmas-load-time-by-3x) — asm.js → WebAssembly migration.

[⁵] [figma.com/blog/figma-rendering-powered-by-webgpu](https://www.figma.com/blog/figma-rendering-powered-by-webgpu) — Sep 2025. Full WebGL → WebGPU migration story; shader translation; uniform buffer batching; dynamic fallback system.

[⁶] [figma.com/blog/incremental-frame-loading](https://www.figma.com/blog/incremental-frame-loading/) — Per-subtree document subscriptions, mobile memory management.

[⁷] [figma.com/blog/how-figma-draws-inspiration-from-the-gaming-world](https://www.figma.com/blog/how-figma-draws-inspiration-from-the-gaming-world/) — Alice Ching: "tech stack closer to game engine than web stack."

[⁸] [blog.google/innovation-and-ai/models-and-research/google-labs/stitch-ai-ui-design](https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-ai-ui-design) — Google Stitch AI-native canvas, March 2026 update.

[⁹] [krea.ai/realtime](https://www.krea.ai/realtime) and [docs.krea.ai/user-guide/features/realtime](https://docs.krea.ai/user-guide/features/realtime) — Krea realtime canvas.

[¹⁰] [venturebeat.com/ai/visual-electric-launches-to-liberate-ai-art-generation-from-chat-interfaces](https://venturebeat.com/ai/visual-electric-launches-to-liberate-ai-art-generation-from-chat-interfaces/) — Visual Electric architectural philosophy.

[¹¹] [recraft.ai/docs/recraft-studio/work-area/canvas](https://www.recraft.ai/docs/recraft-studio/work-area/canvas) — Recraft canvas documentation.

[¹²] [github.com/Comfy-Org/ComfyUI_frontend/issues/10002](https://github.com/Comfy-Org/ComfyUI_frontend/issues/10002) — ComfyUI Long-term Rendering Architecture Roadmap RFC: hybrid Vue + Canvas2D.

[¹³] Miro Engineering on Medium: "How we learned to draw text on HTML5 Canvas," "Fighting for bytes in the frontend," "How we integrated a code editor on the Miro canvas." PIXI.js, SVG `foreignObject`, vector LoDs, typed arrays.

[¹⁴] [pixijs.com/blog/pixi-v8-launches](https://pixijs.com/blog/pixi-v8-launches) and [pixijs.com/blog/pixi-v8-beta](https://pixijs.com/blog/pixi-v8-beta) — 100k sprite benchmarks; WebGPU as core renderer; two-layer texture architecture.

[¹⁵] [github.com/WebKit/WebKit/pull/37811](https://github.com/WebKit/WebKit/pull/37811) — WebCodecs concurrent decoder limits per browser. [developer.chrome.com/blog/quotaexceedederror](https://developer.chrome.com/blog/quotaexceedederror) — MSE buffer limits.

[¹⁶] [developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/createImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/createImageBitmap) — Worker-thread image decoding.

[¹⁷] [shi-yan.github.io/webgpuunleashed/Advanced/mega_texture.html](https://shi-yan.github.io/webgpuunleashed/Advanced/mega_texture.html) — WebGPU virtual textures / mega-textures.

[¹⁸] [pixijs.com/8.x/guides/production/performance-tips](https://pixijs.com/8.x/guides/production/performance-tips) — PIXI sprite batching, atlas guidelines.

[¹⁹] [developer.mozilla.org/docs/Web/API/GPUExternalTexture](https://developer.mozilla.org/docs/Web/API/GPUExternalTexture) and [webgpufundamentals.org/webgpu/lessons/webgpu-textures-external-video.html](https://webgpufundamentals.org/webgpu/lessons/webgpu-textures-external-video.html) — Zero-copy video → WebGPU pipeline.
