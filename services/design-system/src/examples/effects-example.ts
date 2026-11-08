import {
    applyStyle,
    html,
} from '@lixpi/ui-primitives/dom'
import {
    DomGlassBorder,
    GlassBorder,
    ClosedGlassStripMaterial,
    CircularGlassMaterial,
    TravelingSnakeGlassMaterial,
} from '@lixpi/canvas-components/effects/glass'
import { TravelingOutline } from '@lixpi/canvas-components/effects/outline'
import {
    LoadingOverlay,
    type LoadingOverlayOptions,
} from '@lixpi/canvas-components/loading'
import {
    LoadingLayer,
    type LoadingLease,
} from '@lixpi/canvas-components/loading/layer'
import {
    resolveCanvasThemeColors,
    type CanvasTheme,
} from '@lixpi/canvas-components/theme'
import { ExampleFrame } from './example-frame.ts'
import { EngineExample } from './engine-example.ts'
import { getExampleTheme } from './example-theme.ts'

const outlineAppearance = (theme: CanvasTheme) => {
    const settings = resolveCanvasThemeColors(theme, theme.effects.generationOutline)

    return {
        texture: new TravelingSnakeGlassMaterial(
            settings.colors,
            settings.tailAlpha,
            settings.glassMaterial,
        ).bake(),
        style: {
            ...settings,
            edgeFeatherFraction: settings.glassMaterial.edgeFeatherFraction,
        },
    }
}

const loadingOutline = (theme: CanvasTheme): LoadingOverlayOptions['outline'] => ({
    ...outlineAppearance(theme),
    size: theme.effects.loadingOutline.diameter,
    durationMs: theme.effects.loadingOutline.durationMs,
    snakeLengthFraction: theme.effects.loadingOutline.snakeLengthFraction,
})

const outlineSource = (theme: CanvasTheme): string[] => [
    `const outlineSettings = ${JSON.stringify(
        resolveCanvasThemeColors(theme, theme.effects.generationOutline),
        null,
        4,
    )}`,
    'const texture = new TravelingSnakeGlassMaterial(',
    '    outlineSettings.colors,',
    '    outlineSettings.tailAlpha,',
    '    outlineSettings.glassMaterial,',
    ').bake()',
    'const style = {',
    '    ...outlineSettings,',
    '    edgeFeatherFraction: outlineSettings.glassMaterial.edgeFeatherFraction,',
    '}',
]

export class EffectsExample {
    readonly board: EngineExample
    private visible = true
    private radius: number
    private reverse = false
    private borderWidth = 220
    private borderHeight = 130
    private sync = (): void => {}
    private refreshEffects = (_theme: CanvasTheme): void => {}

    constructor(
        host: HTMLElement,
        private readonly mode: string,
    ) {
        this.board = new EngineExample(
            host,
            mode === 'effects-glass' ? 'media-images' : 'engine-playground',
            { controls: false },
        )
        this.board.frame.inspector.querySelector('.canvas-example-instructions')?.remove()
        const effects = resolveCanvasThemeColors(this.board.frame.theme.value, this.board.frame.theme.value.effects)
        this.radius = mode === 'effects-outline'
            ? effects.generationOutline.radius
            : this.board.frame.theme.value.shape.mediaRadius

        try {
            this.board.canvas.installExtension({
                id: mode,
                mount: context => {
                    if (mode === 'effects-outline') {
                        const appearance = outlineAppearance(this.board.frame.theme.value)
                        const outline = new TravelingOutline({
                            surface: context,
                            ...appearance,
                        })
                        const circle = new TravelingOutline({
                            surface: context,
                            space: 'screen',
                            ...appearance,
                        })
                        const label = html`<span>Circular outline</span>` as HTMLSpanElement
                        const unmountLabel = context.mountOverlay(label, 'screen')
                        this.sync = () => {
                            outline.sync(
                                this.visible ? this.board.canvas.scene.scene.nodes.map(
                                    node => ({
                                        id: node.nodeId,
                                        ...(this.board.canvas.scene.getNodeGeometry(node.nodeId)?.visualBounds ?? {
                                            ...node.position,
                                            ...node.dimensions,
                                        }),
                                        radius: this.radius,
                                        visible: true,
                                        direction: this.reverse ? 'counterclockwise' : 'clockwise',
                                    }),
                                ) : [],
                            )
                            const y = Math.max(24, this.board.frame.stage.clientHeight - 160)
                            circle.sync(
                                this.visible ? [{
                                    id: 'circle',
                                    x: 40,
                                    y,
                                    width: 96,
                                    height: 96,
                                    radius: 48,
                                    visible: true,
                                    direction: this.reverse ? 'counterclockwise' : 'clockwise',
                                }] : [],
                            )
                            applyStyle(
                                label,
                                {
                                    position: 'absolute',
                                    left: '40px',
                                    top: `${y + 108}px`,
                                    pointerEvents: 'none',
                                },
                            )
                            label.hidden = !this.visible
                        }
                        let signature = JSON.stringify(effects.generationOutline)
                        this.refreshEffects = theme => {
                            const settings = resolveCanvasThemeColors(theme, theme.effects.generationOutline)
                            const nextSignature = JSON.stringify(settings)

                            if (signature === nextSignature)
                                return

                            signature = nextSignature
                            const next = outlineAppearance(theme)
                            outline.setAppearance(next.style, next.texture)
                            circle.setAppearance(next.style, next.texture)
                        }
                        const unsubscribeScene = context.subscribeScene(this.sync)
                        const unsubscribeView = context.subscribeView(this.sync)
                        this.sync()

                        return () => {
                            unsubscribeScene()
                            unsubscribeView()
                            outline.destroy()
                            circle.destroy()
                            unmountLabel()
                        }
                    }

                    const borderSettings = effects.glassBorder
                    const style = {
                        ...borderSettings,
                        edgeFeatherFraction: borderSettings.glassMaterial.edgeFeatherFraction,
                    }
                    const texture = new ClosedGlassStripMaterial(
                        borderSettings.materialColors,
                        borderSettings.materialTailAlpha,
                        borderSettings.glassMaterial,
                    ).bake()
                    const domBorder = new DomGlassBorder({
                        surface: context,
                        sources: [context.layers.media],
                        root: this.board.frame.stage,
                        style,
                        texture,
                    })
                    const border = new GlassBorder({
                        surface: context,
                        sources: [context.layers.media],
                        style,
                        texture,
                    })
                    const target = html`<div className="canvas-example-glass-target"><strong>DOM-measured border</strong></div>` as HTMLDivElement
                    const explicitLabel = html`<span>Explicit rectangle</span>` as HTMLSpanElement
                    const unmount = context.mountOverlay(target, 'screen')
                    const unmountExplicitLabel = context.mountOverlay(explicitLabel, 'screen')
                    const bakeDisc = (theme: CanvasTheme): string => {
                        const settings = resolveCanvasThemeColors(theme, theme.effects.circularGlass)

                        return new CircularGlassMaterial(
                            settings.fallbackColors,
                            1,
                            settings.material,
                            {
                                size: settings.textureSize,
                                translucency: settings.translucency,
                                rimFeatherFraction: settings.rimFeatherFraction,
                                discStyle: settings.discMaterial,
                            },
                        ).bakeDataUrl()
                    }
                    const image = html`
                        <img
                            src=${bakeDisc(this.board.frame.theme.value)}
                            alt="Circular glass material"
                        />
                    ` as HTMLImageElement
                    const sample = html`<div>${image}<span>Circular glass material</span></div>` as HTMLDivElement
                    const unmountDisc = context.mountOverlay(sample, 'screen')
                    applyStyle(
                        image,
                        {
                            width: '160px',
                            height: '160px',
                        },
                    )
                    this.sync = () => {
                        const layout = this.glassLayout()
                        applyStyle(
                            target,
                            {
                                left: `${layout.measured.x}px`,
                                top: `${layout.measured.y}px`,
                                width: `${this.borderWidth}px`,
                                height: `${this.borderHeight}px`,
                                boxSizing: 'border-box',
                                display: this.visible ? 'flex' : 'none',
                                borderRadius: `${this.radius}px`,
                            },
                        )
                        applyStyle(
                            explicitLabel,
                            {
                                position: 'absolute',
                                left: `${layout.explicit.x + 20}px`,
                                top: `${layout.explicit.y + 20}px`,
                                pointerEvents: 'none',
                            },
                        )
                        applyStyle(
                            sample,
                            {
                                position: 'absolute',
                                left: '40px',
                                top: `${layout.discY}px`,
                                display: this.visible ? 'flex' : 'none',
                                flexDirection: 'column',
                                gap: '12px',
                                pointerEvents: 'none',
                            },
                        )
                        domBorder.setTargets(this.visible ? [{
                            id: 'dom',
                            element: target,
                        }] : [])
                        domBorder.refresh()
                        border.sync(
                            this.visible ? [{
                                id: 'explicit',
                                ...layout.explicit,
                                width: this.borderWidth,
                                height: this.borderHeight,
                                radius: this.radius,
                                visible: true,
                            }] : [],
                            {
                                width: this.board.frame.stage.clientWidth,
                                height: this.board.frame.stage.clientHeight,
                            },
                        )
                        target.hidden = !this.visible
                        explicitLabel.hidden = !this.visible
                        sample.hidden = !this.visible
                    }
                    let signature = JSON.stringify([effects.glassBorder, effects.circularGlass])
                    this.refreshEffects = theme => {
                        const settings = resolveCanvasThemeColors(theme, theme.effects)
                        const nextSignature = JSON.stringify([settings.glassBorder, settings.circularGlass])

                        if (signature === nextSignature)
                            return

                        signature = nextSignature
                        const style = {
                            ...settings.glassBorder,
                            edgeFeatherFraction: settings.glassBorder.glassMaterial.edgeFeatherFraction,
                        }
                        const texture = new ClosedGlassStripMaterial(
                            settings.glassBorder.materialColors,
                            settings.glassBorder.materialTailAlpha,
                            settings.glassBorder.glassMaterial,
                        ).bake()
                        domBorder.setAppearance(style, texture)
                        border.setAppearance(style, texture)
                        image.src = bakeDisc(theme)
                    }
                    const unsubscribe = context.subscribeView(this.sync)
                    const stop = context.requestFrame(() => domBorder.refresh())
                    this.sync()

                    return () => {
                        stop()
                        unsubscribe()
                        domBorder.destroy()
                        border.destroy()
                        unmountDisc()
                        unmountExplicitLabel()
                        unmount()
                    }
                },
            })
        } catch (error) {
            this.board.destroy()

            throw error
        }

        this.board.frame.toggle(
            'Visible effects',
            this.visible,
            value => {
                this.visible = value
                this.sync()
            },
        )
        const radiusInput = this.board.frame.number(
            'Rectangle corner radius',
            {
                value: this.radius,
            },
            value => {
                const theme = getExampleTheme(this.board.frame.stage)
                theme.update(mode === 'effects-outline'
                    ? { effects: { generationOutline: { radius: value } } }
                    : { shape: { mediaRadius: value } })
            },
        )

        if (mode === 'effects-outline')
            this.board.frame.toggle(
                'Counterclockwise',
                this.reverse,
                value => {
                    this.reverse = value
                    this.sync()
                },
            )
        else {
            this.board.frame.number(
                'Both borders: width',
                {
                    value: this.borderWidth,
                },
                value => {
                    this.borderWidth = value
                    this.sync()
                },
            )
            this.board.frame.number(
                'Both borders: height',
                {
                    value: this.borderHeight,
                },
                value => {
                    this.borderHeight = value
                    this.sync()
                },
            )
        }

        this.board.frame.onThemeChange(theme => {
            this.radius = mode === 'effects-outline'
                ? theme.effects.generationOutline.radius
                : theme.shape.mediaRadius
            radiusInput.value = String(this.radius)
            this.refreshEffects(theme)
            this.sync()
        })
        this.board.frame.code(() => this.sourceCode())
    }

    private glassLayout() {
        const sideBySide = this.board.frame.stage.clientWidth >= this.borderWidth * 2 + 120
        const bottom = sideBySide ? 80 + this.borderHeight : 120 + this.borderHeight * 2

        return {
            measured: {
                x: 40,
                y: 80,
            },
            explicit: {
                x: sideBySide ? 80 + this.borderWidth : 40,
                y: sideBySide ? 80 : 120 + this.borderHeight,
            },
            discY: bottom + 40,
        }
    }

    private sourceCode(): string {
        const theme = this.board.frame.theme.value

        if (this.mode === 'effects-outline')
            return [
                "import { TravelingOutline } from '@lixpi/canvas-components/effects/outline'",
                "import { TravelingSnakeGlassMaterial } from '@lixpi/canvas-components/effects/glass'",
                '',
                ...outlineSource(theme),
                "canvas.installExtension({ id: 'outlines', mount: surface => {",
                '    const outline = new TravelingOutline({ surface, texture, style })',
                "    const circle = new TravelingOutline({ surface, texture, style, space: 'screen' })",
                '    const sync = () => {',
                `        outline.sync(${this.visible} ? canvas.scene.scene.nodes.map(node => ({`,
                '            id: node.nodeId,',
                '            ...(canvas.scene.getNodeGeometry(node.nodeId)?.visualBounds ?? { ...node.position, ...node.dimensions }),',
                `            radius: ${this.radius}, visible: true,`,
                `            direction: '${this.reverse ? 'counterclockwise' : 'clockwise'}',`,
                '        })) : [])',
                `        circle.sync(${this.visible} ? [{`,
                "            id: 'circle', x: 40, y: Math.max(24, host.clientHeight - 160),",
                '            width: 96, height: 96, radius: 48, visible: true,',
                `            direction: '${this.reverse ? 'counterclockwise' : 'clockwise'}',`,
                '        }] : [])',
                '    }',
                '    const releaseScene = surface.subscribeScene(sync)',
                '    const releaseView = surface.subscribeView(sync)',
                '    sync()',
                '    return () => { releaseScene(); releaseView(); outline.destroy(); circle.destroy() }',
                '} })',
            ].join('\n')

        const effects = resolveCanvasThemeColors(theme, theme.effects)
        const layout = this.glassLayout()

        return [
            "import { html, applyStyle } from '@lixpi/ui-primitives/dom'",
            "import { GlassBorder, DomGlassBorder, ClosedGlassStripMaterial, CircularGlassMaterial } from '@lixpi/canvas-components/effects/glass'",
            '',
            `const borderSettings = ${JSON.stringify(
                effects.glassBorder,
                null,
                4,
            )}`,
            `const circularSettings = ${JSON.stringify(
                effects.circularGlass,
                null,
                4,
            )}`,
            'const texture = new ClosedGlassStripMaterial(',
            '    borderSettings.materialColors, borderSettings.materialTailAlpha, borderSettings.glassMaterial,',
            ').bake()',
            'const style = { ...borderSettings, edgeFeatherFraction: borderSettings.glassMaterial.edgeFeatherFraction }',
            "canvas.installExtension({ id: 'glass', mount: surface => {",
            '    const options = { surface, style, texture, sources: [surface.layers.media] }',
            '    const border = new GlassBorder(options)',
            '    const measured = new DomGlassBorder({ ...options, root: host })',
            '    const target = html`<div>DOM-measured border</div>`',
            `    applyStyle(target, { position: 'absolute', left: '${layout.measured.x}px', top: '${layout.measured.y}px',`,
            `        width: '${this.borderWidth}px', height: '${this.borderHeight}px', borderRadius: '${this.radius}px' })`,
            "    const releaseTarget = surface.mountOverlay(target, 'screen')",
            '    measured.setTargets([{ id: "measured", element: target }])',
            '    const sync = () => {',
            '        measured.refresh()',
            `        border.sync(${this.visible} ? [{`,
            `            id: 'explicit', x: ${layout.explicit.x}, y: ${layout.explicit.y},`,
            `            width: ${this.borderWidth}, height: ${this.borderHeight}, radius: ${this.radius}, visible: true,`,
            '        }] : [], { width: host.clientWidth, height: host.clientHeight })',
            '    }',
            `    target.hidden = ${!this.visible}`,
            `    measured.setTargets(${this.visible} ? [{ id: 'measured', element: target }] : [])`,
            '    const discUrl = new CircularGlassMaterial(',
            '        circularSettings.fallbackColors, 1, circularSettings.material, {',
            '            size: circularSettings.textureSize, translucency: circularSettings.translucency,',
            '            rimFeatherFraction: circularSettings.rimFeatherFraction, discStyle: circularSettings.discMaterial,',
            '        },',
            '    ).bakeDataUrl()',
            '    const disc = html`<img src=${discUrl} alt="Circular glass material" />`',
            `    applyStyle(disc, { position: 'absolute', left: '40px', top: '${layout.discY}px', width: '160px', height: '160px' })`,
            `    disc.hidden = ${!this.visible}`,
            "    const releaseDisc = surface.mountOverlay(disc, 'screen')",
            '    const releaseView = surface.subscribeView(sync)',
            '    const releaseFrame = surface.requestFrame(() => measured.refresh())',
            '    sync()',
            '    return () => { releaseView(); releaseFrame(); measured.destroy(); border.destroy(); releaseTarget(); releaseDisc() }',
            '} })',
        ].join('\n')
    }

    destroy(): void {
        this.board.destroy()
    }
}

export class LoadingExample {
    readonly frame: ExampleFrame
    private readonly overlay: LoadingOverlay | null
    private readonly layer: LoadingLayer | null
    private readonly leases: LoadingLease[] = []
    private readonly errors = new Map<LoadingLease, string>()
    private nextFailureMessage = 'Request failed. Retry to continue.'
    private overlayError: string | null = null
    private loadingVisible = false
    private requestSequence = 0
    private syncControls = (): void => {}

    constructor(
        host: HTMLElement,
        mode: string,
    ) {
        this.frame = new ExampleFrame(host, '')
        this.frame.inspector.querySelector('.canvas-example-instructions')?.remove()
        this.frame.stage.classList.add('canvas-example-loading-stage')
        const options = {
            root: this.frame.stage,
            outline: loadingOutline(this.frame.theme.value),
            retryLabel: 'Retry',
            errorTitle: 'Request failed',
            onError: this.frame.error,
            onRetry: () => this.show(),
        }
        this.overlay = mode === 'loading-overlay' ? new LoadingOverlay(options) : null
        this.layer = mode === 'loading-layer' ? new LoadingLayer(options) : null
        let outlineSignature = JSON.stringify(
            resolveCanvasThemeColors(
                this.frame.theme.value,
                [this.frame.theme.value.effects.generationOutline, this.frame.theme.value.effects.loadingOutline],
            ),
        )
        this.frame.onThemeChange(theme => {
            const signature = JSON.stringify(
                resolveCanvasThemeColors(theme, [theme.effects.generationOutline, theme.effects.loadingOutline]),
            )

            if (signature === outlineSignature)
                return

            outlineSignature = signature
            const outline = loadingOutline(theme)
            this.overlay?.setAppearance({ outline })
            this.layer?.setAppearance({ outline })
        })
        this.frame.button('Start request', () => this.show())
        const completeOne = this.frame.button('Complete one', () => {
            if (this.overlay)
                this.setOverlayVisible(false)
            else {
                const lease = this.leases.shift()

                if (lease) {
                    this.errors.delete(lease)
                    lease.destroy()
                }

                this.updateState()
            }
        })
        const fail = this.frame.button('Fail request', () => {
            const message = this.nextFailureMessage.trim()

            if (!message)
                return

            if (this.overlay) {
                this.loadingVisible = true
                this.overlayError = message
                this.overlay.setVisible(true)
                this.overlay.setErrorMessage(message)
            } else {
                const lease = this.leases[0]

                if (lease) {
                    this.errors.set(lease, message)
                    lease.setErrorMessage(message)
                }
            }

            this.updateState()
        })
        const completeAll = this.frame.button('Complete all', () => {
            this.overlayError = null
            this.loadingVisible = false
            this.overlay?.setErrorMessage(null)
            this.overlay?.setVisible(false)

            for (const lease of this.leases.splice(0))
                lease.destroy()

            this.errors.clear()
            this.updateState()
        })
        this.frame.text(
            'Next failure message',
            this.nextFailureMessage,
            value => {
                this.nextFailureMessage = value
                this.syncControls()
            },
        )
        const countInput = this.layer ? this.frame.number(
            'Active requests',
            {
                value: 0,
            },
            value => {
                if (
                    !Number.isSafeInteger(value)
                    || value < 0
                )
                    throw new RangeError("Active requests must be a non-negative safe integer.")

                while (this.leases.length > value) {
                    const lease = this.leases.pop()

                    if (lease) {
                        this.errors.delete(lease)
                        lease.destroy()
                    }
                }

                while (this.leases.length < value)
                    this.acquire()

                this.updateState()
            },
        ) : null
        const visibleToggle = this.overlay ? this.frame.toggle(
            'Visible',
            false,
            value => this.setOverlayVisible(value),
        ) : null
        this.syncControls = () => {
            if (countInput)
                countInput.value = String(this.leases.length)

            visibleToggle?.setChecked(this.loadingVisible)
            const active = this.overlay ? this.loadingVisible : this.leases.length > 0
            completeOne.disabled = !active
            completeAll.disabled = !active
            fail.disabled = !active || !this.nextFailureMessage.trim()
        }
        this.frame.code(() => this.sourceCode())
        this.show()
    }

    private setOverlayVisible(visible: boolean): void {
        this.loadingVisible = visible
        this.overlayError = null
        this.overlay?.setErrorMessage(null)
        this.overlay?.setVisible(visible)
        this.updateState()
    }

    private acquire(): void {
        if (!this.layer)
            return

        const lease = this.layer.acquire({
            visible: true,
            label: `Request ${++this.requestSequence}`,
            onRetry: () => {
                this.errors.delete(lease)
                lease.setErrorMessage(null)
                lease.setVisible(true)
                this.updateState()
            },
        })
        this.leases.push(lease)
    }

    private show(): void {
        if (this.overlay)
            this.setOverlayVisible(true)
        else {
            this.acquire()
            this.updateState()
        }
    }

    private updateState(): void {
        this.syncControls()
        this.frame.report(
            this.overlay
                ? this.overlayError ?? (this.loadingVisible ? 'Loading' : 'Hidden')
                : `${this.leases.length} active request(s), ${this.errors.size} failed`,
        )
    }

    private sourceCode(): string {
        const presentation = [
            "import { TravelingSnakeGlassMaterial } from '@lixpi/canvas-components/effects/glass'",
            '',
            ...outlineSource(this.frame.theme.value),
            'const presentation = {',
            '    outline: { texture, style,',
            `        size: ${this.frame.theme.value.effects.loadingOutline.diameter},`,
            `        durationMs: ${this.frame.theme.value.effects.loadingOutline.durationMs},`,
            `        snakeLengthFraction: ${this.frame.theme.value.effects.loadingOutline.snakeLengthFraction},`,
            '    },',
            "    errorTitle: 'Request failed', retryLabel: 'Retry',",
            '    onError: error => console.error(error),',
            '}',
            `const nextFailureMessage = ${JSON.stringify(this.nextFailureMessage)}`,
        ]

        if (this.layer)
            return [
                "import { LoadingLayer } from '@lixpi/canvas-components/loading/layer'",
                ...presentation,
                'const layer = new LoadingLayer({ root, ...presentation })',
                `const requests = Array.from({ length: ${this.leases.length} }, (_, index) => {`,
                '    const lease = layer.acquire({',
                '        visible: true, label: `Request ${index + 1}`,',
                '        onRetry: () => { lease.setErrorMessage(null); lease.setVisible(true) },',
                '    })',
                '    return lease',
                '})',
                ...this.leases.flatMap((lease, index) => {
                    const error = this.errors.get(lease)

                    return error ? [`requests[${index}].setErrorMessage(${JSON.stringify(error)})`] : []
                }),
                '// To fail the next request: requests[0]?.setErrorMessage(nextFailureMessage)',
                'const dispose = () => {',
                '    for (const lease of requests) lease.destroy()',
                '    layer.destroy()',
                '}',
            ].join('\n')

        return [
            "import { LoadingOverlay } from '@lixpi/canvas-components/loading'",
            ...presentation,
            'const overlay = new LoadingOverlay({',
            '    root, ...presentation,',
            '    onRetry: () => { overlay.setErrorMessage(null); overlay.setVisible(true) },',
            '})',
            `overlay.setVisible(${this.loadingVisible})`,
            `overlay.setErrorMessage(${JSON.stringify(this.overlayError)})`,
            '// To fail the next request: overlay.setErrorMessage(nextFailureMessage)',
            'const dispose = () => overlay.destroy()',
        ].join('\n')
    }

    destroy(): void {
        for (const lease of this.leases)
            lease.destroy()

        this.errors.clear()
        this.layer?.destroy()
        this.overlay?.destroy()
        this.frame.destroy()
    }
}
