import {
    createProgressTimeline,
    type ProgressTimelineItem,
    type ProgressTimelineItemStatus,
    type ProgressTimelineViewMode,
} from '@lixpi/ui-kit/components/progress-timeline'
import { createProgressRippleIcon } from '@lixpi/ui-kit/components/progress-ripple'
import { createCanvasNodeFooter } from '@lixpi/ui-kit/components/canvas-node-footer'
import { createErrorPlaceholder } from '@lixpi/ui-kit/components/loading-placeholder'
import {
    applyVideoControlsHostStyleProperties,
    createVideoControls,
} from '@lixpi/ui-kit/components/video-controls'
import {
    createMediaModelBadge,
    renderMediaModelBadge,
} from '@lixpi/ui-kit/components/media-model-badge'
import {
    checkMarkIcon,
    claudeIcon,
    createCollapseExpandIcon,
    geminiColorIcon,
    gptAvatarIcon,
    infoLetterIcon,
    progressRippleArtwork,
    refreshIcon,
    videoControlIcons,
} from '@lixpi/ui-kit/svg'
import { html } from '@lixpi/ui-primitives/dom'

import {
    type ExampleOwner,
} from '../../catalog/catalog.ts'
import { UiExample } from '../ui-example.ts'

const VIDEO_FIXTURE = '/fixtures/canvas-sample.webm'
const VIDEO_CONTROLS_HEIGHT = 40

const timelineItems = (status: ProgressTimelineItemStatus): ProgressTimelineItem[] => [
    {
        id: 'plan',
        title: 'Plan the shots',
        status: 'completed',
        source: {
            kind: 'reasoning-model',
            icon: claudeIcon,
            name: 'Claude',
        },
        summary: 'Three shots: wide, medium and a product close-up.',
    },
    {
        id: 'images',
        title: 'Generate key frames',
        status,
        source: {
            kind: 'media-model',
            icon: geminiColorIcon,
            name: 'Gemini',
        },
        summary: 'Rendering the key frame for each shot.',
        meta: '2 of 3',
        children: [
            {
                id: 'images-wide',
                title: 'Wide shot',
                status: 'completed',
            },
            {
                id: 'images-medium',
                title: 'Medium shot',
                status: 'completed',
            },
            {
                id: 'images-close',
                title: 'Close-up',
                status,
            },
        ],
    },
    {
        id: 'review',
        title: 'Review the result',
        status: 'pending',
        source: {
            kind: 'tool',
            name: 'Review tool',
        },
    },
]

const statuses: Record<ProgressTimelineItemStatus, string> = {
    pending: 'Pending',
    running: 'Running',
    completed: 'Completed',
    attention: 'Needs attention',
    failed: 'Failed',
    cancelled: 'Cancelled',
    skipped: 'Skipped',
}

const createTimelineExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'createProgressTimeline renders nested progress items with their source and summary. Set the status of the running step to see every state. The focused view collapses finished work; the all view shows every item.',
    )
    const body = example.specimen('Run progress')
    let status: ProgressTimelineItemStatus = 'running'
    const timeline = createProgressTimeline({
        ariaLabel: 'Generation progress',
        items: timelineItems(status),
        defaultViewMode: 'focused',
    })
    timeline.element.classList.add('documentation-ui-list')
    body.append(timeline.element)
    example.own(() => timeline.destroy())
    const reportView = (): void => {
        const view = timeline.getViewState()
        example.frame.report(`The ${view.mode} view hides ${view.hiddenItemCount} of ${view.totalItemCount} items.`)
    }
    example.frame.select(
        'Key frame status',
        status,
        statuses,
        value => {
            status = value as ProgressTimelineItemStatus
            timeline.setItems(
                timelineItems(status),
            )
            reportView()
        },
    )
    example.frame.select(
        'View',
        'focused',
        {
            focused: 'Focused',
            all: 'All',
        },
        mode => {
            timeline.setViewMode(mode as ProgressTimelineViewMode)
            reportView()
        },
    )
    reportView()
    example.frame.code(
        () => [
            "import { createProgressTimeline } from '@lixpi/ui-kit/components/progress-timeline'",
            '',
            "const timeline = createProgressTimeline({ ariaLabel: 'Generation progress', defaultViewMode: 'focused' })",
            'timeline.setItems([',
            `    { id: 'images', title: 'Generate key frames', status: '${status}', children: [...] },`,
            '])',
        ].join('\n'),
    )

    return example
}

const createRippleExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'createProgressRippleIcon draws the three-ring ripple that marks active work. syncActive restarts the cycle, reset stops it at rest.',
    )
    const body = example.specimen('Ripple')
    let color = '#8f7cf0'
    const mount = () =>
        createProgressRippleIcon({
            artwork: progressRippleArtwork,
            color,
            className: 'documentation-ui-ripple',
        })
    let ripple = mount()
    body.append(ripple.element)
    example.own(() => ripple.destroy())
    example.frame.text(
        'Color',
        color,
        value => {
            color = value
            const previous = ripple
            ripple = mount()
            previous.element.replaceWith(ripple.element)
            previous.destroy()
        },
    )
    example.frame.button('Run', () => ripple.syncActive())
    example.frame.button('Reset', () => ripple.reset())
    example.frame.code(
        () => [
            "import { createProgressRippleIcon } from '@lixpi/ui-kit/components/progress-ripple'",
            "import { progressRippleArtwork } from '@lixpi/ui-kit/svg'",
            '',
            `const ripple = createProgressRippleIcon({ artwork: progressRippleArtwork, color: '${color}' })`,
            'badge.append(ripple.element)',
        ].join('\n'),
    )

    return example
}

const footerButton = (
    label: string,
    icon: string,
    onClick: () => void,
): HTMLButtonElement =>
    html`
        <button
            type="button"
            className="canvas-node-footer-info-button"
            aria-label=${label}
            data-help-tooltip="aria-label"
            onclick=${onClick}
        ><span
                className="canvas-node-footer-info-icon"
                innerHTML=${icon}
            ></span></button>
    ` as HTMLButtonElement

const createFooterExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'createCanvasNodeFooter is the row under a canvas node: the details button, the progress ripple while work runs, and host sections such as a model badge and actions. update changes progress and selection without rebuilding it.',
    )
    const body = example.specimen('Footer')
    const state = {
        progressActive: true,
        selected: false,
    }
    const footer = createCanvasNodeFooter({
        ...state,
        icons: {
            info: infoLetterIcon,
            progress: progressRippleArtwork,
        },
        infoLabel: 'Media details',
        progressLabel: 'Generation is running',
        sections: [
            {
                elements: [createMediaModelBadge({
                    providerTitle: 'OpenAI',
                    modelTitle: 'GPT image',
                    icon: gptAvatarIcon,
                })],
                separated: true,
            },
            {
                elements: [
                    footerButton(
                        'Accept',
                        checkMarkIcon,
                        () => example.frame.report('Accept was pressed.'),
                    ),
                    footerButton(
                        'Regenerate',
                        refreshIcon,
                        () => example.frame.report('Regenerate was pressed.'),
                    ),
                ],
            },
        ],
        onOpenDetails: () => example.frame.report('Details were requested.'),
    })
    footer.element.classList.add('documentation-ui-list')
    body.append(footer.element)
    example.own(() => footer.destroy())
    example.frame.toggle(
        'Progress active',
        state.progressActive,
        value => {
            state.progressActive = value
            footer.update({ ...state })
        },
    )
    example.frame.toggle(
        'Selected',
        state.selected,
        value => {
            state.selected = value
            footer.update({ ...state })
        },
    )
    example.frame.code(
        () => [
            "import { createCanvasNodeFooter } from '@lixpi/ui-kit/components/canvas-node-footer'",
            "import { infoLetterIcon, progressRippleArtwork } from '@lixpi/ui-kit/svg'",
            '',
            'const footer = createCanvasNodeFooter({',
            `    progressActive: ${state.progressActive},`,
            `    selected: ${state.selected},`,
            '    icons: { info: infoLetterIcon, progress: progressRippleArtwork },',
            "    infoLabel: 'Media details',",
            '    sections: [{ elements: [modelBadge], separated: true }, { elements: [accept, regenerate] }],',
            '    onOpenDetails: () => details.open(),',
            '})',
        ].join('\n'),
    )

    return example
}

const createErrorPlaceholderExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'createErrorPlaceholder covers its host when content fails to load. It shows a message and a retry action; the host decides what retry does.',
    )
    const target = html`<div className="documentation-ui-placeholder-host documentation-ui-card">Content that failed to load</div>` as HTMLElement
    example.specimen('Failed content', target)
    let theme: 'light' | 'dark' = 'light'
    let message = 'The image could not be loaded.'
    let retries = 0
    const mount = () =>
        createErrorPlaceholder({
            message,
            theme,
            retryLabel: 'Try again',
            onRetry: () => {
                retries += 1
                example.frame.report(`Retry was requested ${retries} times.`)
            },
        })
    let placeholder = mount()
    target.append(placeholder.dom)
    example.own(() => placeholder.destroy())
    example.frame.text(
        'Message',
        message,
        value => {
            message = value
            placeholder.setMessage(value)
        },
    )
    example.frame.select(
        'Theme',
        theme,
        {
            light: 'Light',
            dark: 'Dark',
        },
        value => {
            theme = value as 'light' | 'dark'
            placeholder.destroy()
            placeholder = mount()
            target.append(placeholder.dom)
        },
    )
    example.frame.button('Show', () => placeholder.show())
    example.frame.button('Hide', () => placeholder.hide())
    example.frame.code(
        () => [
            "import { createErrorPlaceholder } from '@lixpi/ui-kit/components/loading-placeholder'",
            '',
            'const error = createErrorPlaceholder({',
            `    message: ${JSON.stringify(message)},`,
            `    theme: '${theme}',`,
            '    onRetry: () => image.reload(),',
            '})',
            'container.append(error.dom)',
        ].join('\n'),
    )

    return example
}

const createVideoControlsExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'createVideoControls draws the SVG control bar over a native media element. The element stays the source of truth: the bar listens to its events and drives play, seek, volume, speed and fullscreen. Narrow the player to see the compact layout.',
    )
    const video = html`
        <video
            src=${VIDEO_FIXTURE}
            preload="metadata"
            playsinline=""
            loop=""
        ></video>
    ` as HTMLVideoElement
    const controlsHost = html`<div className="documentation-ui-media-controls"></div>` as HTMLElement
    const player = html`<div className="documentation-ui-media">${video}${controlsHost}</div>` as HTMLElement
    example.specimen('Player', player)
    applyVideoControlsHostStyleProperties(controlsHost)
    const svg = example.svg(
        controlsHost,
        {
            width: 1,
            height: VIDEO_CONTROLS_HEIGHT,
        },
    )
    const controls = createVideoControls(
        svg,
        {
            icons: videoControlIcons,
            id: 'documentation-video-controls',
            x: 0,
            y: 0,
            width: 1,
            height: VIDEO_CONTROLS_HEIGHT,
            responsiveWidth: 1,
            videoEl: video,
        },
    )
    example.own(() => controls.destroy())
    const resize = (): void => {
        const width = Math.max(1, controlsHost.clientWidth)
        svg.attr('width', width)
        controls.resize(
            0,
            0,
            width,
            width,
        )
    }
    const observer = new ResizeObserver(resize)
    observer.observe(controlsHost)
    example.own(() => observer.disconnect())
    example.own(() => {
        video.pause()
        video.removeAttribute('src')
        video.load()
    })
    example.frame.number(
        'Player width',
        { value: 520 },
        width => {
            if (width < 160)
                throw new Error('The player needs at least 160 pixels.')

            player.style.width = `${width}px`
        },
    )
    example.frame.button('Play', () => void video.play())
    example.frame.button('Pause', () => video.pause())
    example.frame.toggle(
        'Muted',
        false,
        muted => void (video.muted = muted),
    )
    example.frame.code(
        () => [
            "import { createVideoControls, applyVideoControlsHostStyleProperties } from '@lixpi/ui-kit/components/video-controls'",
            "import { videoControlIcons } from '@lixpi/ui-kit/svg'",
            '',
            'applyVideoControlsHostStyleProperties(controlsHost)',
            'const controls = createVideoControls(select(svg), {',
            '    icons: videoControlIcons,',
            "    id: 'player',",
            '    x: 0,',
            '    y: 0,',
            '    width: controlsHost.clientWidth,',
            `    height: ${VIDEO_CONTROLS_HEIGHT},`,
            '    videoEl: video,',
            '})',
        ].join('\n'),
    )

    return example
}

const createMediaModelBadgeExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'createMediaModelBadge names the provider and model behind generated media. It returns null when there is nothing to show. renderMediaModelBadge replaces the badge inside an existing host.',
    )
    const body = example.specimen('Badges')
    const variants = [
        {
            providerTitle: 'OpenAI',
            modelTitle: 'GPT image',
            icon: gptAvatarIcon,
        },
        {
            providerTitle: 'Google',
            modelTitle: 'Gemini',
            icon: geminiColorIcon,
            iconOnly: true,
        },
        {
            label: 'Custom label',
        },
    ]

    for (const variant of variants) {
        const badge = createMediaModelBadge(variant)

        if (badge)
            body.append(badge)
    }

    const live = html`<span></span>` as HTMLElement
    example.specimen('Rendered into a host', live)
    let provider = 'Anthropic'
    let model = 'Claude'
    const render = (): void =>
        void renderMediaModelBadge(
            live,
            {
                providerTitle: provider,
                modelTitle: model,
                icon: claudeIcon,
            },
        )
    render()
    example.frame.text(
        'Provider',
        provider,
        value => {
            provider = value
            render()
        },
    )
    example.frame.text(
        'Model',
        model,
        value => {
            model = value
            render()
        },
    )
    example.frame.code(
        () => [
            "import { renderMediaModelBadge } from '@lixpi/ui-kit/components/media-model-badge'",
            '',
            `renderMediaModelBadge(host, { providerTitle: '${provider}', modelTitle: '${model}', icon: claudeIcon })`,
        ].join('\n'),
    )

    return example
}

const createAnimatedIconsExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'Animated icons move their parts between named states. setState animates by default; pass animate: false to jump.',
    )
    const body = example.specimen('Collapse and expand')
    const icon = createCollapseExpandIcon({
        state: 'collapsed',
        className: 'documentation-ui-animated-icon',
    })
    body.append(icon.element)
    example.own(() => icon.destroy())
    let animate = true
    example.frame.toggle(
        'Animate',
        animate,
        value => void (animate = value),
    )
    example.frame.button('Toggle', () => {
        icon.setState(icon.getState() === 'collapsed' ? 'expanded' : 'collapsed', { animate })
        example.frame.report(`The icon is ${icon.getState()}.`)
    })
    example.frame.code(
        () => [
            "import { createCollapseExpandIcon } from '@lixpi/ui-kit/svg'",
            '',
            `const icon = createCollapseExpandIcon({ state: '${icon.getState()}' })`,
            `icon.setState('expanded', { animate: ${animate} })`,
        ].join('\n'),
    )

    return example
}

const factories: Record<string, (host: HTMLElement) => UiExample> = {
    'ui-kit-progress-timeline': createTimelineExample,
    'ui-kit-progress-ripple': createRippleExample,
    'ui-kit-canvas-node-footer': createFooterExample,
    'ui-kit-error-placeholder': createErrorPlaceholderExample,
    'ui-kit-video-controls': createVideoControlsExample,
    'ui-kit-media-model-badge': createMediaModelBadgeExample,
    'ui-kit-animated-icons': createAnimatedIconsExample,
}

export const createExample = (
    host: HTMLElement,
    id: string,
): ExampleOwner => {
    const factory = factories[id]

    if (!factory)
        throw new Error(`Unknown UI kit status example: ${id}`)

    return factory(host)
}
