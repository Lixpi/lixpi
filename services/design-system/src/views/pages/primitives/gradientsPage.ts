// Color and gradient rendering from @lixpi/ui-primitives/gradients: animated
// shifting backgrounds, the freeform bitmap phases they interpolate between,
// SVG gradient stops and the hex color helpers.

import 'd3-transition'
import {
    DEFAULT_SHIFTING_GRADIENT_COLORS,
    FreeformGradientRenderer,
    ShiftingGradientRenderer,
    SvgGradientRenderer,
    adjustHexColor,
    createShiftingGradientBackground,
    hslToRgb,
    mixHexColors,
    normalizeHexColor,
    parseHexColor,
    rgbToHex,
    rgbToHsl,
    type ShiftingGradientBackground,
    type ShiftingGradientColorSet,
} from '@lixpi/ui-primitives/gradients'
import {
    sanitizeSvgId,
    svgToCssImageUrl,
} from '@lixpi/ui-primitives/svg'
import { html } from '@lixpi/ui-primitives/dom'
import { tPatternSvgTexture } from '@lixpi/ui-kit/svg'
import { createGentelellaButton } from '@lixpi/ui-kit-gentelella/components/button'
import { createGentelellaCode } from '@lixpi/ui-kit-gentelella/components/foundation'
import { createGentelellaColorSwatches } from '@lixpi/ui-kit-gentelella/components/form-controls'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import {
    DEMO_PALETTES,
    DemoMedia,
} from '$src/fixtures/demoMedia.ts'
import {
    ShowcasePage,
    createShowcaseSpecimen,
} from '$src/views/showcase/showcasePage.ts'
import { createSvgStage } from '$src/views/showcase/svgStage.ts'
import '$src/views/pages/primitives/gradients.scss'

const SVG_STAGE_WIDTH = 220
const SVG_STAGE_HEIGHT = 90
const BASE_COLOR = '#3D649C'

type GradientSurfaceConfig = {
    colors?: ShiftingGradientColorSet
    pattern?: boolean
    renderer?: ShiftingGradientRenderer
}

// The background reads its pattern custom properties from computed style and
// sizes its canvas from the container, so it starts once the page is mounted.
class GradientSurface {
    readonly element: HTMLElement

    private background: ShiftingGradientBackground | null = null

    constructor(private readonly config: GradientSurfaceConfig) {
        this.element = html`
            <div
                className="design-system-gradient-surface"
                onclick=${this.nextPhase}
            ></div>
        ` as HTMLElement

        if (config.pattern) {
            this.element.style.setProperty(
                '--gradient-pattern-url',
                svgToCssImageUrl(tPatternSvgTexture),
            )
            this.element.style.setProperty('--gradient-pattern-alpha', '0.18')
            this.element.style.setProperty('--gradient-pattern-scale', '0.12')
            this.element.style.setProperty('--gradient-pattern-tint', '#1a2744')
        }
    }

    start(): void {
        this.background ??= createShiftingGradientBackground(
            this.element,
            {
                colors: this.config.colors,
                renderer: this.config.renderer,
            },
        )
    }

    nextPhase = (): void => {
        if (this.config.renderer)
            this.config.renderer.nextPhase()
        else
            this.background?.triggerAnimation()
    }

    destroy(): void {
        this.background?.destroy()
        this.background = null
    }
}

export const createGradientsPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/ui-primitives/gradients',
        title: 'Color and gradients',
        description: 'The shifting gradient sits behind the auth panel and the prompt composer. Click a surface or its button to advance it to the next phase.',
    })
    const media = page.own(
        new DemoMedia(),
    )

    const surface = (config: GradientSurfaceConfig): GradientSurface => {
        const instance = page.own(
            new GradientSurface(config),
        )
        page.onMount(() => instance.start())

        return instance
    }
    const backgrounds: Array<{
        label: string
        surface: GradientSurface
    }> = [
        {
            label: 'DEFAULT_SHIFTING_GRADIENT_COLORS',
            surface: surface({}),
        },
        ...Object.entries(DEMO_PALETTES).map(
            ([name, colors]) => ({
                label: `colors: ${name}`,
                surface: surface({ colors: [...colors] }),
            }),
        ),
        {
            label: 'Pattern through --gradient-pattern-url',
            surface: surface({
                colors: [...DEMO_PALETTES.dawn],
                pattern: true,
            }),
        },
    ]
    page.addSection({
        title: 'Shifting gradient backgrounds',
        description: 'Each background owns its renderer, so equal palettes still animate independently.',
        columns: 3,
        content: backgrounds.map(
            background => createShowcaseSpecimen({
                content: background.surface.element,
                label: background.label,
            }),
        ),
    })
    page.el.append(
        page.own(
            createGentelellaButton({
                label: 'Next phase',
                onClick: () => backgrounds.forEach(background => background.surface.nextPhase()),
                variant: 'primary',
            }),
        ).el,
    )

    const sharedRenderer = page.own(
        new ShiftingGradientRenderer([...DEMO_PALETTES.violet]),
    )
    const shared = [surface({ renderer: sharedRenderer }), surface({ renderer: sharedRenderer })]
    page.addSection({
        title: 'Shared renderer',
        description: 'Passing one ShiftingGradientRenderer to several backgrounds keeps them on the same phase. The page owns that renderer.',
        columns: 2,
        content: shared.map(
            (subscriber, index) => createShowcaseSpecimen({
                content: subscriber.element,
                label: `Subscriber ${index + 1}`,
            }),
        ),
    })

    page.addSection({
        title: 'Freeform bitmap phases',
        description: `FreeformGradientRenderer samples four colors on a ${FreeformGradientRenderer.bitmapSize.width} by ${FreeformGradientRenderer.bitmapSize.height} bitmap. These are the eight phase positions the shifting background moves between.`,
        columns: 4,
        content: FreeformGradientRenderer.phasePositions.map(
            (_, phase) => createShowcaseSpecimen({
                content: media.createImageCanvas({
                    colors: [...DEMO_PALETTES.dawn],
                    height: 90,
                    phase,
                    width: 150,
                }),
                label: phase === FreeformGradientRenderer.initialPhase ? `Phase ${phase} (initial)` : `Phase ${phase}`,
            }),
        ),
    })

    const linear = createSvgStage({
        height: SVG_STAGE_HEIGHT,
        width: SVG_STAGE_WIDTH,
    })
    const linearId = sanitizeSvgId('design-system linear gradient')
    SvgGradientRenderer.appendLinearGradientStops(
        linear.svg.append('defs').append('linearGradient').attr('id', linearId),
        DEMO_PALETTES.violet,
    )
    linear.svg
        .append('rect')
        .attr('width', SVG_STAGE_WIDTH)
        .attr('height', SVG_STAGE_HEIGHT)
        .attr('rx', 12)
        .attr('fill', `url(#${linearId})`)

    const repeating = createSvgStage({
        height: SVG_STAGE_HEIGHT,
        width: SVG_STAGE_WIDTH,
    })
    const repeatingId = sanitizeSvgId('design-system repeating gradient')
    SvgGradientRenderer.appendRepeatingLinearGradientStops(
        repeating.svg.append('defs').append('linearGradient').attr('id', repeatingId),
        DEMO_PALETTES.dawn,
        3,
    )
    repeating.svg
        .append('rect')
        .attr('width', SVG_STAGE_WIDTH)
        .attr('height', SVG_STAGE_HEIGHT)
        .attr('rx', 12)
        .attr('fill', `url(#${repeatingId})`)

    const rotating = createSvgStage({
        height: SVG_STAGE_HEIGHT,
        width: SVG_STAGE_WIDTH,
    })
    const rotatingId = sanitizeSvgId('design-system rotating gradient')
    const rotatingGradient = rotating.svg
        .append('defs')
        .append('linearGradient')
        .attr('id', rotatingId)
        .attr('gradientUnits', 'userSpaceOnUse')
    SvgGradientRenderer.appendRepeatingLinearGradientStops(rotatingGradient, DEMO_PALETTES.violet)
    rotating.svg
        .append('rect')
        .attr('x', 4)
        .attr('y', 4)
        .attr('width', SVG_STAGE_WIDTH - 8)
        .attr('height', SVG_STAGE_HEIGHT - 8)
        .attr('rx', 16)
        .attr('fill', 'none')
        .attr('stroke', `url(#${rotatingId})`)
        .attr('stroke-width', 4)
    const rotation = SvgGradientRenderer.startRotatingLinearGradient(
        rotatingGradient,
        {
            center: {
                x: SVG_STAGE_WIDTH / 2,
                y: SVG_STAGE_HEIGHT / 2,
            },
            duration: 120,
            radius: SVG_STAGE_WIDTH / 2,
        },
    )
    page.own({ destroy: rotation.stop })
    page.addSection({
        title: 'SVG gradients',
        description: 'SvgGradientRenderer writes stops into a caller-owned gradient. The rotating variant moves its endpoints until stopped.',
        columns: 3,
        content: [
            createShowcaseSpecimen({
                content: linear.host,
                label: 'appendLinearGradientStops',
            }),
            createShowcaseSpecimen({
                content: repeating.host,
                label: 'appendRepeatingLinearGradientStops (3 repeats)',
            }),
            createShowcaseSpecimen({
                content: rotating.host,
                label: 'startRotatingLinearGradient',
            }),
        ],
    })

    const rgb = parseHexColor(BASE_COLOR)
    const hsl = rgbToHsl(rgb)
    const lighter = adjustHexColor(
        BASE_COLOR,
        {
            maxLightness: 0.9,
            maxSaturation: 1,
            minLightness: 0.6,
            minSaturation: 0,
            lightnessMultiplier: 1.6,
            saturationMultiplier: 0.8,
        },
    )
    const swatches = [
        ['Base', BASE_COLOR],
        ['Adjusted lighter', lighter],
        ['Mixed 25% white', mixHexColors(
            BASE_COLOR,
            '#FFFFFF',
            0.25,
        )],
        ['Mixed 50% white', mixHexColors(
            BASE_COLOR,
            '#FFFFFF',
            0.5,
        )],
        ['Mixed 50% orange', mixHexColors(
            BASE_COLOR,
            '#A55324',
            0.5,
        )],
        ['HSL round trip', rgbToHex(
            hslToRgb(hsl),
        )],
    ] as const
    page.addSection({
        title: 'Color helpers',
        description: 'Hex parsing, HSL conversion, bounded adjustment and mixing. The swatches are the Gentelella color swatch control.',
        content: [
            page.own(
                createGentelellaColorSwatches({
                    ariaLabel: 'Derived colors',
                    swatches: swatches.map(
                        ([label, color]) => ({
                            color,
                            label,
                            value: color,
                        }),
                    ),
                    value: BASE_COLOR,
                }),
            ).el,
            page.own(
                createGentelellaCode({
                    code: [
                        `normalizeHexColor('3d649c') = ${normalizeHexColor('3d649c')}`,
                        `parseHexColor('${BASE_COLOR}') = ${JSON.stringify(rgb)}`,
                        `rgbToHsl(...) = ${JSON.stringify(hsl)}`,
                        `normalizeHexColor('not a color') = ${normalizeHexColor('not a color')}`,
                        `DEFAULT_SHIFTING_GRADIENT_COLORS = ${DEFAULT_SHIFTING_GRADIENT_COLORS.join(', ')}`,
                    ].join('\n'),
                }),
            ).el,
        ],
    })

    return page
}
