import {
    applyCssCustomProperties,
    applyStyle,
    html,
} from '@lixpi/ui-primitives/dom'
import {
    appendSvgPathIcon,
    extractSvgPathIcon,
    flattenSvgPath,
    getPathLength,
    getPointAtPathLength,
    roundedRectanglePath,
    svgToCssImageUrl,
} from '@lixpi/ui-primitives/svg'
import {
    TRANSITION_EASING_CSS,
    TRANSITION_EASINGS,
    pingPongEasing,
    reverseEasing,
    type EasingFunction,
    type TransitionEasingName,
} from '@lixpi/ui-primitives/animation'
import {
    DEFAULT_SHIFTING_GRADIENT_COLORS,
    adjustHexColor,
    createShiftingGradientBackground,
    mixHexColors,
    normalizeHexColor,
    parseHexColor,
    rgbToHsl,
    type ShiftingGradientBackground,
    type ShiftingGradientColorSet,
} from '@lixpi/ui-primitives/gradients'
import {
    claudeIcon,
    imageIcon,
    pencilIcon,
    sendIcon,
    videoIcon,
} from '@lixpi/ui-kit/svg'

import {
    type ExampleOwner,
} from '../../catalog/catalog.ts'
import { UiExample } from '../ui-example.ts'

const createDomExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'The html tagged template builds real DOM elements, not a virtual DOM. className, style objects, data objects and on* handlers become properties, dataset values and listeners; every other attribute is set as written. applyStyle writes several styles on an existing element at once.',
    )
    let label = 'Generated with html'
    let clicks = 0
    let radius = 10
    const output = html`<pre className="documentation-ui-output"></pre>` as HTMLElement
    const holder = example.specimen('Element')
    example.specimen('Resulting markup', output)
    const render = (): void => {
        const cardStyle = { borderRadius: `${radius}px` }
        const card = html`
            <button
                type="button"
                className="button"
                data-variant="secondary"
                style=${cardStyle}
                data=${{ clicks }}
                aria-label=${label}
                onclick=${() => {
                    clicks += 1
                    render()
                    example.frame.report(`Clicked ${clicks} times.`)
                }}
            >${label}</button>
        ` as HTMLButtonElement
        holder.replaceChildren(card)
        output.textContent = card.outerHTML
    }
    render()
    example.frame.text(
        'Label',
        label,
        value => {
            label = value
            render()
        },
    )
    example.frame.number(
        'Corner radius',
        { value: radius },
        value => {
            if (value < 0)
                throw new Error('The radius cannot be negative.')

            radius = value
            const card = holder.firstElementChild as HTMLElement | null

            if (!card)
                return

            applyStyle(
                card,
                {
                    borderRadius: `${radius}px`,
                },
            )
            applyCssCustomProperties(card, { '--documentation-ui-radius': `${radius}px` })
            output.textContent = card.outerHTML
        },
    )
    example.frame.code(
        () => [
            "import { html, applyStyle } from '@lixpi/ui-primitives/dom'",
            '',
            `const cardStyle = { borderRadius: '${radius}px' }`,
            'const card = html`',
            '    <button',
            '        className="card"',
            '        style=${cardStyle}',
            `        data=\${{ clicks: ${clicks} }}`,
            '        onclick=${handleClick}',
            `    >${label}</button>`,
            '` as HTMLButtonElement',
            '',
            "applyStyle(card, { borderRadius: '4px' })",
        ].join('\n'),
    )

    return example
}

const iconChoices: Record<string, string> = {
    image: imageIcon,
    video: videoIcon,
    pencil: pencilIcon,
    send: sendIcon,
    claude: claudeIcon,
}

const createSvgIconExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'appendSvgPathIcon parses icon markup and appends its paths into a D3 SVG group, scaled into a square box and filled with one color. This is how SVG controls draw UI kit icons. svgToCssImageUrl turns the same markup into a CSS image.',
    )
    let iconName = 'image'
    let size = 32
    let fill = '#5f8fcf'
    const body = example.specimen('Paths in an SVG group')
    const svg = example.svg(
        body,
        {
            width: 360,
            height: 80,
        },
    )
    const details = html`<pre className="documentation-ui-output"></pre>` as HTMLElement
    const cssImage = html`<span className="documentation-ui-css-image"></span>` as HTMLElement
    example.specimen('As a CSS image', cssImage)
    example.specimen('Parsed icon', details)
    const render = (): void => {
        svg.selectAll('*').remove()
        const icon = iconChoices[iconName]

        for (const [index, scale] of [0.5, 1, 1.5].entries()) {
            const group = svg.append('g')
            appendSvgPathIcon(
                group,
                icon,
                {
                    x: index * 110 + 8,
                    y: 8,
                    size: size * scale,
                    fill,
                },
            )
        }

        const parsed = extractSvgPathIcon(icon)
        details.textContent = JSON.stringify(
            {
                ...parsed,
                pathData: `${parsed.pathData.length} paths`,
            },
            null,
            2,
        )
        cssImage.style.backgroundImage = svgToCssImageUrl(icon)
    }
    render()
    example.frame.select(
        'Icon',
        iconName,
        {
            image: 'Image',
            video: 'Video',
            pencil: 'Pencil',
            send: 'Send',
            claude: 'Claude',
        },
        value => {
            iconName = value
            render()
        },
    )
    example.frame.number(
        'Size',
        { value: size },
        value => {
            if (value <= 0)
                throw new Error('The size must be greater than zero.')

            size = value
            render()
        },
    )
    example.frame.text(
        'Fill',
        fill,
        value => {
            fill = value
            render()
        },
    )
    example.frame.code(
        () => [
            "import { appendSvgPathIcon } from '@lixpi/ui-primitives/svg'",
            `import { ${iconName}Icon } from '@lixpi/ui-kit/svg'`,
            '',
            `appendSvgPathIcon(group, ${iconName}Icon, { x: 0, y: 0, size: ${size}, fill: '${fill}' })`,
        ].join('\n'),
    )

    return example
}

const PATH_BOX = {
    x: 20,
    y: 20,
    width: 320,
    height: 160,
}

const createPathExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'roundedRectanglePath builds an SVG path for a rectangle with clamped corner radii. flattenSvgPath samples any path into points, getPathLength measures them, and getPointAtPathLength finds the point and tangent at a distance, which the traveling outlines use to move along a border.',
    )
    let radius = 24
    let progress = 25
    const body = example.specimen('Path')
    const svg = example.svg(
        body,
        {
            width: PATH_BOX.width + PATH_BOX.x * 2,
            height: PATH_BOX.height + PATH_BOX.y * 2,
        },
    )
    const path = svg
        .append('path')
        .attr('fill', 'none')
        .attr('stroke', 'currentColor')
        .attr('stroke-width', 2)
    const marker = svg
        .append('circle')
        .attr('r', 6)
        .attr('fill', '#5f8fcf')
    const tangent = svg
        .append('line')
        .attr('stroke', '#5f8fcf')
        .attr('stroke-width', 2)
    const render = (): void => {
        const d = roundedRectanglePath(PATH_BOX, radius)
        path.attr('d', d)
        const points = flattenSvgPath(d)
        const length = getPathLength(points)
        const point = getPointAtPathLength(points, (length * progress) / 100)

        if (!point)
            return

        marker
            .attr('cx', point.point.x)
            .attr('cy', point.point.y)
        tangent
            .attr('x1', point.point.x)
            .attr('y1', point.point.y)
            .attr('x2', point.point.x + point.tangent.x * 30)
            .attr('y2', point.point.y + point.tangent.y * 30)
        example.frame.report(`The path is ${Math.round(length)} units long and was sampled into ${points.length} points.`)
    }
    example.frame.number(
        'Corner radius',
        { value: radius },
        value => {
            if (value < 0)
                throw new Error('The radius cannot be negative.')

            radius = value
            render()
        },
    )
    example.frame.number(
        'Position (%)',
        { value: progress },
        value => {
            if (
                value < 0
                || value > 100
            )
                throw new Error('Enter a percentage from 0 to 100.')

            progress = value
            render()
        },
    )
    render()
    example.frame.code(
        () => [
            "import { roundedRectanglePath, flattenSvgPath, getPathLength, getPointAtPathLength } from '@lixpi/ui-primitives/svg'",
            '',
            `const d = roundedRectanglePath({ x: 20, y: 20, width: 320, height: 160 }, ${radius})`,
            'const points = flattenSvgPath(d)',
            `const point = getPointAtPathLength(points, getPathLength(points) * ${progress / 100})`,
        ].join('\n'),
    )

    return example
}

const CURVE_SIZE = 140
const CURVE_SAMPLES = 48

type EasingVariant = 'normal' | 'reverse' | 'pingPong'

const variantEasing = (
    easing: EasingFunction,
    variant: EasingVariant,
): EasingFunction => variant === 'reverse'
    ? reverseEasing(easing)
    : variant === 'pingPong'
        ? pingPongEasing(easing)
        : easing

const createEasingExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'The shared transition easings exist both as functions for D3 and canvas motion and as cubic-bezier strings for CSS, so TypeScript and stylesheet animations use the same curves.',
    )
    let variant: EasingVariant = 'normal'
    const body = example.specimen('Curves')
    const render = (): void => {
        body.replaceChildren()

        for (const name of Object.keys(TRANSITION_EASINGS) as TransitionEasingName[]) {
            const card = html`
                <figure className="documentation-ui-swatch documentation-ui-card">
                    <figcaption className="documentation-ui-swatch-label">
                        <span>${name}</span>
                        <br />
                        <span className="documentation-ui-swatch-value">${TRANSITION_EASING_CSS[name]}</span>
                    </figcaption>
                </figure>
            ` as HTMLElement
            body.append(card)
            const svg = example.svg(
                card,
                {
                    width: CURVE_SIZE,
                    height: CURVE_SIZE,
                },
            )
            const easing = variantEasing(TRANSITION_EASINGS[name], variant)
            const points = Array.from(
                { length: CURVE_SAMPLES + 1 },
                (_, index) => {
                    const t = index / CURVE_SAMPLES

                    return `${t * CURVE_SIZE},${CURVE_SIZE - easing(t) * CURVE_SIZE}`
                },
            )
            svg
                .append('rect')
                .attr('width', CURVE_SIZE)
                .attr('height', CURVE_SIZE)
                .attr('fill', 'none')
                .attr('stroke', 'currentColor')
                .attr('stroke-opacity', 0.15)
            svg
                .append('polyline')
                .attr(
                    'points',
                    points.join(' '),
                )
                .attr('fill', 'none')
                .attr('stroke', '#5f8fcf')
                .attr('stroke-width', 2)
        }
    }
    render()
    example.frame.select(
        'Variant',
        variant,
        {
            normal: 'As defined',
            reverse: 'reverseEasing',
            pingPong: 'pingPongEasing',
        },
        value => {
            variant = value as EasingVariant
            render()
        },
    )
    example.frame.code(
        () => [
            "import { TRANSITION_EASINGS, TRANSITION_EASING_CSS, reverseEasing, pingPongEasing } from '@lixpi/ui-primitives/animation'",
            '',
            "selection.transition().duration(200).ease(TRANSITION_EASINGS.hover)",
            "element.style.transitionTimingFunction = TRANSITION_EASING_CSS.hover",
            variant === 'normal' ? '' : `const curve = ${variant === 'reverse' ? 'reverseEasing' : 'pingPongEasing'}(TRANSITION_EASINGS.pupOut)`,
        ].join('\n'),
    )

    return example
}

const createGradientExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'createShiftingGradientBackground prepends a canvas to its container and renders a four-point freeform gradient that swirls to its next phase on demand. It pauses while the container is off screen.',
    )
    const container = html`<div className="documentation-ui-gradient"></div>` as HTMLElement
    example.specimen('Background', container)
    let colors: ShiftingGradientColorSet = [...DEFAULT_SHIFTING_GRADIENT_COLORS]
    let background: ShiftingGradientBackground = createShiftingGradientBackground(container, { colors })
    example.own(() => background.destroy())

    for (const [index, color] of colors.entries())
        example.frame.text(
            `Color ${index + 1}`,
            color,
            value => {
                const normalized = normalizeHexColor(value)

                if (!normalized)
                    throw new Error('Enter a hex color such as #F5EFF9.')

                const next = [...colors] as ShiftingGradientColorSet
                next[index] = normalized
                colors = next
                background.destroy()
                background = createShiftingGradientBackground(container, { colors })
            },
        )

    example.frame.button('Next phase', () => background.triggerAnimation())
    example.frame.code(
        () => [
            "import { createShiftingGradientBackground } from '@lixpi/ui-primitives/gradients'",
            '',
            `const background = createShiftingGradientBackground(panel, { colors: ${JSON.stringify(colors)} })`,
            'sendButton.addEventListener(\'click\', background.triggerAnimation)',
        ].join('\n'),
    )

    return example
}

const createColorExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'Color utilities derive shades from theme colors: mixHexColors blends two colors, and adjustHexColor scales saturation and lightness within bounds.',
    )
    let from = '#5f8fcf'
    let to = '#ff7a59'
    let lightness = 1.2
    const mixes = example.specimen('mixHexColors')
    const adjusted = example.specimen('adjustHexColor')
    const details = html`<pre className="documentation-ui-output"></pre>` as HTMLElement
    example.specimen('Parsed', details)
    const swatch = (
        label: string,
        value: string,
    ): HTMLElement => {
        const colorStyle = { background: value }

        return html`
            <figure className="documentation-ui-swatch">
                <span
                    className="documentation-ui-swatch-color"
                    style=${colorStyle}
                ></span>
                <figcaption className="documentation-ui-swatch-label">
                    <span>${label}</span>
                    <br />
                    <span className="documentation-ui-swatch-value">${value}</span>
                </figcaption>
            </figure>
        ` as HTMLElement
    }
    const render = (): void => {
        mixes.replaceChildren(
            html`
                <div className="documentation-ui-swatches">
                    ${[0, 0.25, 0.5, 0.75, 1].map(
                        amount => swatch(
                            `${amount * 100}%`,
                            mixHexColors(
                                from,
                                to,
                                amount,
                            ),
                        ),
                    )}
                </div>
            ` as HTMLElement,
        )
        const adjustment = {
            saturationMultiplier: 1,
            minSaturation: 0,
            maxSaturation: 1,
            lightnessMultiplier: lightness,
            minLightness: 0.1,
            maxLightness: 0.95,
        }
        adjusted.replaceChildren(
            html`
                <div className="documentation-ui-swatches">
                    ${swatch('Source', from)}
                    ${swatch(
                        `Lightness x${lightness}`,
                        adjustHexColor(from, adjustment),
                    )}
                </div>
            ` as HTMLElement,
        )
        const rgb = parseHexColor(from)
        details.textContent = JSON.stringify(
            {
                rgb,
                hsl: rgbToHsl(rgb),
            },
            null,
            2,
        )
    }
    const color = (value: string): string => {
        const normalized = normalizeHexColor(value)

        if (!normalized)
            throw new Error('Enter a hex color such as #5f8fcf.')

        return normalized
    }
    example.frame.text(
        'From',
        from,
        value => {
            from = color(value)
            render()
        },
    )
    example.frame.text(
        'To',
        to,
        value => {
            to = color(value)
            render()
        },
    )
    example.frame.number(
        'Lightness multiplier',
        { value: lightness },
        value => {
            if (value < 0)
                throw new Error('The multiplier cannot be negative.')

            lightness = value
            render()
        },
    )
    render()
    example.frame.code(
        () => [
            "import { mixHexColors, adjustHexColor } from '@lixpi/ui-primitives/gradients'",
            '',
            `const halfway = mixHexColors('${from}', '${to}', 0.5)`,
            `const lighter = adjustHexColor('${from}', { saturationMultiplier: 1, minSaturation: 0, maxSaturation: 1, lightnessMultiplier: ${lightness}, minLightness: 0.1, maxLightness: 0.95 })`,
        ].join('\n'),
    )

    return example
}

const scrollContent = (): HTMLElement =>
    html`
        <div className="documentation-ui-scroll-content">
            ${Array.from({ length: 14 }, (_, index) => html`<p>Row ${index + 1} is wide enough to scroll in both directions.</p>` as HTMLElement)}
        </div>
    ` as HTMLElement

const createScrollbarExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'A started web client holds a document scrollbar lease, so every scrollable region gets the shared overlay scrollbars without its own setup. Set data-scrollbars="off" on a region to keep the native scrollbars there.',
    )
    const overlay = html`<div className="documentation-ui-scroll-region">${scrollContent()}</div>` as HTMLElement
    const nativeRegion = html`
        <div
            className="documentation-ui-scroll-region"
            data-scrollbars="off"
        >${scrollContent()}</div>
    ` as HTMLElement
    example.specimen('Overlay scrollbars', overlay)
    example.specimen('data-scrollbars="off"', nativeRegion)
    example.frame.code(
        () => [
            "import { acquireDocumentScrollbars, SCROLLBAR_POLICY_ATTRIBUTE } from '@lixpi/ui-primitives/scrollbars'",
            '',
            '// createWebClientService already holds this lease between start() and destroy().',
            'const lease = acquireDocumentScrollbars(document)',
            "region.setAttribute(SCROLLBAR_POLICY_ATTRIBUTE, 'off')",
            'lease.release()',
        ].join('\n'),
    )

    return example
}

const factories: Record<string, (host: HTMLElement) => UiExample> = {
    'primitives-dom': createDomExample,
    'primitives-svg-icons': createSvgIconExample,
    'primitives-svg-paths': createPathExample,
    'primitives-easing': createEasingExample,
    'primitives-shifting-gradient': createGradientExample,
    'primitives-color': createColorExample,
    'primitives-scrollbars': createScrollbarExample,
}

export const createExample = (
    host: HTMLElement,
    id: string,
): ExampleOwner => {
    const factory = factories[id]

    if (!factory)
        throw new Error(`Unknown UI primitives example: ${id}`)

    return factory(host)
}
