// Media-adjacent controls from @lixpi/ui-kit: the SVG video control bar over a
// native video element, the provider/model attribution badge and the footer
// that sits below canvas nodes.

import { select } from 'd3-selection'
import {
    applyVideoControlsHostStyleProperties,
    createDefaultVideoControlsSettings,
    createVideoControls,
    type VideoControlsInstance,
    type VideoControlsSettings,
} from '@lixpi/ui-kit/components/video-controls'
import {
    applyMediaModelBadgeStyleProperties,
    createMediaModelBadge,
    renderMediaModelBadge,
    type MediaModelBadgeConfig,
} from '@lixpi/ui-kit/components/media-model-badge'
import { createCanvasNodeFooter } from '@lixpi/ui-kit/components/canvas-node-footer'
import {
    bytedanceIcon,
    geminiColorIcon,
    gptAvatarIcon,
    infoLetterIcon,
    progressRippleArtwork,
    stabilityIcon,
    videoControlIcons,
} from '@lixpi/ui-kit/svg'
import { createGentelellaButton } from '@lixpi/ui-kit-gentelella/components/button'
import { html } from '@lixpi/ui-primitives/dom'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import {
    DemoMedia,
    settleRecordedVideoDuration,
} from '$src/fixtures/demoMedia.ts'
import {
    ShowcasePage,
    announce,
    createShowcaseRow,
    createShowcaseSpecimen,
} from '$src/views/showcase/showcasePage.ts'
import '$src/views/pages/uiKit/media-controls.scss'

type VideoVariant = {
    label: string
    settings?: VideoControlsSettings
    width: number
}

// The video element is the playback authority; the controls render below it
// and re-measure when the host width changes.
class VideoPlayerDemo {
    readonly element: HTMLElement

    private readonly controls: VideoControlsInstance
    private readonly observer: ResizeObserver

    constructor(
        id: string,
        url: Promise<string>,
        variant: VideoVariant,
    ) {
        const settings = variant.settings ?? createDefaultVideoControlsSettings()
        const video = html`
            <video
                className="design-system-video"
                muted
                loop
                playsinline
            ></video>
        ` as HTMLVideoElement
        const controlsHost = html`<div className="design-system-video-controls"></div>` as HTMLDivElement
        this.element = html`
            <div className="design-system-video-player">
                ${video}
                ${controlsHost}
            </div>
        ` as HTMLElement
        this.element.style.maxWidth = `${variant.width}px`
        applyVideoControlsHostStyleProperties(controlsHost, settings.styles)
        const svg = select(controlsHost)
            .append('svg')
            .attr('width', '100%')
            .attr('height', settings.height)
        this.controls = createVideoControls(
            svg,
            {
                height: settings.height,
                icons: videoControlIcons,
                id,
                settings,
                videoEl: video,
                width: variant.width,
                x: 0,
                y: 0,
            },
        )
        this.observer = new ResizeObserver(() => {
            const width = controlsHost.getBoundingClientRect().width

            if (width > 0)
                this.controls.resize(
                    0,
                    0,
                    width,
                )
        })
        this.observer.observe(controlsHost)
        video.muted = true
        void this.load(video, url)
    }

    private async load(
        video: HTMLVideoElement,
        url: Promise<string>,
    ): Promise<void> {
        video.src = await url
        settleRecordedVideoDuration(video)
        this.controls.render()
    }

    destroy(): void {
        this.observer.disconnect()
        this.controls.destroy()
        this.element.remove()
    }
}

const BADGES: Array<MediaModelBadgeConfig & { caption: string }> = [
    {
        caption: 'Provider and model',
        icon: geminiColorIcon,
        modelTitle: 'Nano Banana Pro',
        providerTitle: 'Google',
    },
    {
        caption: "separator: ' / '",
        icon: gptAvatarIcon,
        modelTitle: 'GPT Image 1',
        providerTitle: 'OpenAI',
        separator: ' / ',
    },
    {
        caption: 'Model only',
        icon: stabilityIcon,
        modelTitle: 'Stable Image Ultra',
    },
    {
        caption: 'label overrides the parts',
        icon: bytedanceIcon,
        label: 'Seedance 2.0 Pro',
        modelTitle: 'ignored',
        providerTitle: 'ignored',
    },
    {
        caption: 'iconOnly',
        icon: geminiColorIcon,
        iconOnly: true,
        modelTitle: 'Veo 3',
        providerTitle: 'Google',
    },
]

export const createMediaControlsPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/ui-kit',
        title: 'Media controls',
        description: 'The clip below is recorded in the browser from the shifting gradient, so the controls run against a real native video element.',
    })
    const media = page.own(
        new DemoMedia(),
    )
    const clip = media.videoUrl()

    const compact = createDefaultVideoControlsSettings()
    compact.height = 32
    compact.layout = {
        ...compact.layout,
        buttonSize: 24,
        iconSize: 14,
        padding: 6,
    }
    compact.speed = {
        ...compact.speed,
        defaultRate: 1,
        guideRates: [0.5, 1, 2],
        maxRate: 3,
        minRate: 0.25,
    }
    const variants: VideoVariant[] = [
        {
            label: 'createDefaultVideoControlsSettings()',
            width: 560,
        },
        {
            label: 'Compact settings with a 0.25x to 3x speed range',
            settings: compact,
            width: 420,
        },
        {
            label: 'Narrow host: the rails shrink, controls stay',
            width: 300,
        },
    ]
    page.addSection({
        title: 'Video controls',
        description: 'Play, scrub, change speed (double-click resets it), adjust volume and enter fullscreen. Scrubbing pauses playback and resumes it afterwards.',
        content: variants.map(
            (variant, index) => createShowcaseSpecimen({
                content: page.own(
                    new VideoPlayerDemo(
                        `video-${index}`,
                        clip,
                        variant,
                    ),
                ).element,
                label: variant.label,
            }),
        ),
    })

    page.addSection({
        title: 'Media model badge',
        description: 'The attribution line under generated media and in execution traces. It exposes its label to the help tooltip.',
        columns: 3,
        content: BADGES.map(
            ({
                caption,
                ...config
            }) => createShowcaseSpecimen({
                content: createMediaModelBadge(config),
                label: caption,
            }),
        ),
    })

    const styledHost = html`<div className="design-system-badge-host"></div>` as HTMLElement
    renderMediaModelBadge(
        styledHost,
        {
            icon: geminiColorIcon,
            modelTitle: 'Nano Banana Pro',
            providerTitle: 'Google',
        },
    )
    applyMediaModelBadgeStyleProperties(
        styledHost,
        {
            iconGap: '8px',
            iconSize: '20px',
            modelColor: '#1a2744',
            nameFontSize: '14px',
            nameFontWeight: '600',
            nameLineHeight: '20px',
            providerColor: '#a55324',
            topGap: '0px',
        },
    )
    const emptyHost = html`<div className="design-system-badge-host"></div>` as HTMLElement
    renderMediaModelBadge(emptyHost, {})
    page.addSection({
        title: 'Rendering into a host',
        description: 'renderMediaModelBadge replaces a host’s content and hides the host when there is nothing to show. applyMediaModelBadgeStyleProperties sets the canvas presentation variables.',
        columns: 2,
        content: [
            createShowcaseSpecimen({
                content: styledHost,
                label: 'applyMediaModelBadgeStyleProperties',
            }),
            createShowcaseSpecimen({
                content: [emptyHost, html`<span>The host is hidden: ${String(emptyHost.hidden)}</span>`],
                label: 'renderMediaModelBadge with no content',
            }),
        ],
    })

    const footerVariants = [
        {
            label: 'Idle',
            progressActive: false,
            sections: false,
            selected: false,
        },
        {
            label: 'Generating',
            progressActive: true,
            sections: false,
            selected: false,
        },
        {
            label: 'Selected, with an attribution section',
            progressActive: false,
            sections: true,
            selected: true,
        },
        {
            label: 'Generating, with an attribution section',
            progressActive: true,
            sections: true,
            selected: false,
        },
    ]
    page.addSection({
        title: 'Canvas node footer',
        description: 'The info control and the active progress ripple both open details. Hosts append their own sections after them.',
        columns: 2,
        content: footerVariants.map(variant => {
            const footer = page.own(
                createCanvasNodeFooter({
                    icons: {
                        info: infoLetterIcon,
                        progress: progressRippleArtwork,
                    },
                    infoLabel: 'Media details and generation history',
                    progressActive: variant.progressActive,
                    progressLabel: 'Generation in progress',
                    sections: variant.sections ? [{
                        elements: [createMediaModelBadge({
                            icon: geminiColorIcon,
                            modelTitle: 'Nano Banana Pro',
                            providerTitle: 'Google',
                        })],
                        separated: true,
                    }] : [],
                    selected: variant.selected,
                    onOpenDetails: () => announce('Open details'),
                }),
            )
            let active = variant.progressActive
            const toggle = page.own(
                createGentelellaButton({
                    label: 'Toggle progress',
                    onClick: () => {
                        active = !active
                        footer.update({
                            progressActive: active,
                            selected: variant.selected,
                        })
                    },
                    size: 'small',
                    variant: 'ghost',
                }),
            )

            return createShowcaseSpecimen({
                content: createShowcaseRow([footer.element, toggle.el]),
                label: variant.label,
            })
        }),
    })

    return page
}
