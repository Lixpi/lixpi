// SVG and DOM utilities from @lixpi/ui-primitives: path geometry, rounded
// rectangles, icon path extraction and the DOM presentation helpers that
// components use to own temporary styles and custom properties.

import { pointer } from 'd3-selection'
import {
    appendSvgPathIcon,
    extractSvgPathIcon,
    flattenSvgPath,
    getPathLength,
    getPointAtPathLength,
    isPointNearPath,
    roundedRectanglePath,
    sanitizeSvgId,
} from '@lixpi/ui-primitives/svg'
import {
    ElementStyleLease,
    applyCssCustomProperties,
    applyStyle,
    copyCssCustomProperties,
    createDocumentEl,
    createDocumentHtml,
    createEl,
    getElementBorderRadius,
    getElementScale,
    html,
    isEditableTarget,
} from '@lixpi/ui-primitives/dom'
import {
    aiRobotFaceIcon,
    imageIcon,
    lixpiLogo,
    videoIcon,
} from '@lixpi/ui-kit/svg'
import { createGentelellaButton } from '@lixpi/ui-kit-gentelella/components/button'
import { createGentelellaCode } from '@lixpi/ui-kit-gentelella/components/foundation'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import {
    ShowcasePage,
    createShowcaseRow,
    createShowcaseSpecimen,
} from '$src/views/showcase/showcasePage.ts'
import { createSvgStage } from '$src/views/showcase/svgStage.ts'
import '$src/views/pages/primitives/svg-geometry.scss'

const STROKE_COLOR = '#3d649c'
const MUTED_COLOR = '#c8ced6'
const ACCENT_COLOR = '#a55324'
const CURVE = 'M20 110 C90 10 170 200 280 60 Q320 10 340 90'
const HIT_RADIUS = 10

const createRoundedRectangles = (): HTMLElement[] =>
    [0, 8, 24, 60].map(radius => {
        const stage = createSvgStage({
            height: 90,
            width: 150,
        })
        stage.svg
            .append('path')
            .attr(
                'd',
                roundedRectanglePath(
                    {
                        x: 6,
                        y: 6,
                        width: 138,
                        height: 78,
                    },
                    radius,
                ),
            )
            .attr('fill', '#e6e9f6')
            .attr('stroke', STROKE_COLOR)
            .attr('stroke-width', 2)

        return createShowcaseSpecimen({
            content: stage.host,
            label: `roundedRectanglePath(rect, ${radius})`,
        })
    })

const createPathSampling = (): HTMLElement => {
    const stage = createSvgStage({
        height: 140,
        width: 360,
    })
    const points = flattenSvgPath(CURVE)
    const length = getPathLength(points)
    const curve = stage.svg
        .append('path')
        .attr('d', CURVE)
        .attr('fill', 'none')
        .attr('stroke', MUTED_COLOR)
        .attr('stroke-width', 3)

    for (let distance = 0; distance <= length; distance += length / 16) {
        const sample = getPointAtPathLength(points, distance)

        if (sample)
            stage.svg
                .append('circle')
                .attr('cx', sample.x)
                .attr('cy', sample.y)
                .attr('r', 3)
                .attr('fill', STROKE_COLOR)
    }

    stage.svg.on('pointermove', (event: PointerEvent) => {
        const [x, y] = pointer(
            event,
            stage.svg.node(),
        )
        curve.attr('stroke', isPointNearPath(
            {
                x,
                y,
            },
            points,
            HIT_RADIUS,
        ) ? ACCENT_COLOR : MUTED_COLOR)
    })

    return createShowcaseSpecimen({
        content: stage.host,
        label: `flattenSvgPath, ${Math.round(length)} units long, 17 points from getPointAtPathLength. Hover near the curve: isPointNearPath(radius ${HIT_RADIUS})`,
    })
}

const createIconPaths = (): HTMLElement => {
    const stage = createSvgStage({
        height: 64,
        width: 360,
    })
    const icons = [lixpiLogo, imageIcon, videoIcon, aiRobotFaceIcon]

    icons.forEach((icon, index) => {
        appendSvgPathIcon(
            stage.svg.append('g'),
            icon,
            {
                x: 8 + index * 88,
                y: 8,
                size: 48,
                fill: index % 2 === 0 ? STROKE_COLOR : ACCENT_COLOR,
            },
        )
    })
    const extracted = extractSvgPathIcon(imageIcon)

    return createShowcaseSpecimen({
        content: stage.host,
        label: `appendSvgPathIcon into 48 unit boxes. extractSvgPathIcon(imageIcon): ${extracted.pathData.length} paths in a ${extracted.width} by ${extracted.height} box at ${extracted.minX}, ${extracted.minY}`,
    })
}

export const createSvgGeometryPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/ui-primitives/svg · /dom',
        title: 'SVG geometry and DOM utilities',
        description: 'Connectors, hit tests and D3 controls rely on these helpers. None of them embeds artwork; the icons below come from the UI-kit catalog.',
    })

    page.addSection({
        title: 'Rounded rectangles',
        columns: 4,
        content: createRoundedRectangles(),
    })
    page.addSection({
        title: 'Path sampling and hit testing',
        content: createPathSampling(),
    })
    page.addSection({
        title: 'Icon paths',
        content: createIconPaths(),
    })

    const leaseTarget = html`<div className="design-system-lease-target">Style lease target</div>` as HTMLElement
    const leases: ElementStyleLease[] = []
    page.own({ destroy: () => leases.splice(0).forEach(lease => lease.destroy()) })
    const leaseButtons = createShowcaseRow([
        page.own(
            createGentelellaButton({
                label: 'Acquire lease',
                onClick: () => leases.push(
                    new ElementStyleLease(
                        leaseTarget,
                        {
                            'background-color': leases.length % 2 === 0 ? '#c3dedd' : '#f6c7b3',
                            outline: `${leases.length + 1}px solid ${STROKE_COLOR}`,
                        },
                    ),
                ),
                variant: 'outline',
            }),
        ).el,
        page.own(
            createGentelellaButton({
                label: 'Release last lease',
                onClick: () => leases.pop()?.destroy(),
                variant: 'ghost',
            }),
        ).el,
    ])
    page.addSection({
        title: 'Element style leases',
        description: 'Each ElementStyleLease overrides the named properties until it is destroyed. Overlapping leases restore the original inline values after the last one ends.',
        content: [leaseTarget, leaseButtons],
    })

    const source = html`<div className="design-system-custom-property-source">Source</div>` as HTMLElement
    const target = html`<div className="design-system-custom-property-target">Copy target</div>` as HTMLElement
    applyCssCustomProperties(
        source,
        {
            '--design-system-demo-fill': '#dcece9',
            '--design-system-demo-stroke': STROKE_COLOR,
        },
    )
    applyStyle(
        source,
        {
            borderRadius: '18px',
            transform: 'scale(0.9)',
        },
    )
    const report = page.own(
        createGentelellaCode({ code: 'Mounting…' }),
    )
    page.onMount(() => {
        copyCssCustomProperties(
            source,
            target,
            ['--design-system-demo-fill', '--design-system-demo-stroke'],
        )
        const editable = createDocumentHtml(document)`<input aria-label="Editable sample" />` as HTMLInputElement
        const element = createDocumentEl(document)(
            'button',
            { type: 'button' },
            'Button',
        )
        const plain = createEl(
            'span',
            {},
            'Span',
        )
        report.el.textContent = [
            `getElementBorderRadius(source, 120, 60) = ${getElementBorderRadius(
                source,
                120,
                60,
            )}`,
            `getElementScale(source) = ${getElementScale(source)}`,
            `isEditableTarget(<input>) = ${isEditableTarget(editable)}`,
            `isEditableTarget(<button>) = ${isEditableTarget(element)}`,
            `isEditableTarget(<span>) = ${isEditableTarget(plain)}`,
            `sanitizeSvgId('node:42 / clip') = ${sanitizeSvgId('node:42 / clip')}`,
        ].join('\n')
    })
    page.addSection({
        title: 'Custom properties and measurements',
        description: 'applyCssCustomProperties sets the source variables, copyCssCustomProperties copies them to the target, and the measurements read computed style once the page is mounted.',
        content: [
            createShowcaseRow([source, target]),
            report.el,
        ],
    })

    return page
}
