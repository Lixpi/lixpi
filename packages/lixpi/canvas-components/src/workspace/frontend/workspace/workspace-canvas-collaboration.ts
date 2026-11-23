import {
    isNewerCanvasMainCamera,
    type CanvasCollaborationActor,
    type CanvasCollaborationEvent,
    type CanvasCollaborationMainCamera,
    type CanvasCollaborationPresence,
    type CanvasState,
} from '@lixpi/constants'
import {
    type CanvasEngineRect,
    type ViewportSnapshot,
} from '@lixpi/canvas-engine/shared'
import { resolveFollowedActor } from '../../shared/scene/resolve-followed-actor.ts'
import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import { select } from 'd3-selection'
import {
    createSlidingSwitch,
    type SlidingSwitchInstance,
    type SlidingSwitchOption,
} from '@lixpi/ui-kit/components/sliding-switch'

type Camera = NonNullable<CanvasCollaborationPresence['camera']>
type Geometry = NonNullable<CanvasCollaborationPresence['geometry']>
type Caret = NonNullable<CanvasCollaborationPresence['caret']>
export type WorkspaceConnectionDrafts = readonly {
    actorId: string
    draft: NonNullable<CanvasCollaborationPresence['connector']>
}[]

export type WorkspaceCanvasCollaborationConnection = {
    start: () => void
    update: (
        update: CanvasCollaborationPresence,
        immediate?: boolean,
        mainCameraAt?: number,
    ) => void
    flush: () => void
    follow: (
        actorId: string | null,
        viewerId?: string,
    ) => void
    activity?: (at: number) => void
    acquireNode: (nodeId: string) => void
    releaseNodes: (nodeIds: readonly string[]) => Promise<void>
    destroy: () => void
}

export type WorkspaceCanvasCaretPort = {
    read: (element: Element) => {
        anchor: number
        head: number
    } | null
    rect: (
        element: Element,
        position: number,
    ) => DOMRect | null
    rects?: (
        element: Element,
        anchor: number,
        head: number,
    ) => readonly DOMRect[]
}

export type WorkspaceCanvasCollaborationPorts = {
    workspaceId: string
    pane: HTMLElement
    controls: HTMLElement
    setViewport: (viewport: ViewportSnapshot) => void
    getViewport: () => ViewportSnapshot
    setFollowedActor: (actor: CanvasCollaborationActor | null) => void
    setRemoteGeometry: (geometry: Geometry) => void
    setRemoteConnectors: (connectors: WorkspaceConnectionDrafts) => void
    getRemoteNodeBounds?: (nodeId: string) => CanvasEngineRect | undefined
    setRemoteSelectedEdges?: (edgeIds: ReadonlySet<string>) => void
    setFollowedComposer: (
        following: boolean,
        draft: CanvasCollaborationPresence['composer'],
    ) => void
    setFollowedPlayback: (
        following: boolean,
        state: CanvasCollaborationPresence['playback'],
    ) => void
    createConnection: (
        workspaceId: string,
        changed: (
            event: CanvasCollaborationEvent,
            actorId: string,
        ) => void,
    ) => WorkspaceCanvasCollaborationConnection
    receiveCanvas: (
        state: CanvasState,
        revision: number,
    ) => void
    readCamera: (workspaceId: string) => string | null
    writeCamera: (
        workspaceId: string,
        camera: string,
    ) => void
    drainCanvas: () => Promise<void>
    caret?: WorkspaceCanvasCaretPort
    reportError: (
        message: string,
        error: unknown,
    ) => void
}

export const toWorkspaceCamera = (
    viewport: ViewportSnapshot,
    size: {
        width: number
        height: number
    },
): Camera => ({
    x: (size.width / 2 - viewport.x) / viewport.zoom,
    y: (size.height / 2 - viewport.y) / viewport.zoom,
    zoom: viewport.zoom,
})

export const toWorkspaceViewport = (
    camera: Camera,
    size: {
        width: number
        height: number
    },
): ViewportSnapshot => ({
    x: size.width / 2 - camera.x * camera.zoom,
    y: size.height / 2 - camera.y * camera.zoom,
    zoom: camera.zoom,
})

type ParticipantMarkers = {
    root: HTMLElement
    selections: Map<string, HTMLElement>
}

const MAIN_VIEW = 'main'
const FOLLOW_OPTION_WIDTH = 112
const FOLLOW_OPTION_MIN_WIDTH = 60
const FOLLOW_OPTION_HEIGHT = 30
const FOLLOW_TRACK_PADDING = 4
const mainViewOption = {
    label: 'Main view',
    value: MAIN_VIEW,
}

const followOptionKey = (actor: CanvasCollaborationActor): string => actor.kind === 'human'
    && actor.viewerId
    ? `viewer:${actor.viewerId}`
    : `actor:${actor.actorId}`

export class WorkspaceCanvasCollaboration {
    private readonly window: Window
    private readonly connection: WorkspaceCanvasCollaborationConnection
    private readonly chooser: HTMLDivElement
    private readonly chooserSvg: SVGSVGElement
    private chooserSwitch: SlidingSwitchInstance | null = null
    private chooserViewers: readonly [string, string][] = []
    private chooserOptionWidth = FOLLOW_OPTION_WIDTH
    private waitingForParticipant = false
    private readonly caretLayer: HTMLDivElement
    private readonly awarenessLayer: HTMLDivElement
    private readonly participants = new Map<string, ParticipantMarkers>()
    private readonly resize: ResizeObserver
    private ownCamera: Camera | null
    private readonly mainCameras = new Map<string, CanvasCollaborationMainCamera>()
    private lastLocalMainCameraAt = -Infinity
    private applyingViewport = false
    private followed: CanvasCollaborationActor | null = null
    private others: CanvasCollaborationActor[] = []
    private actorsKey = ''
    private lastCamera: Camera | null = null
    private lastGeometry = ''
    private lastConnectors = ''
    private lastRemoteEdges = ''
    private lastPlayback = ''
    private lastComposerActorId: string | undefined
    private lastComposer: CanvasCollaborationPresence['composer']
    private lastInteraction = ''
    private formattingSource: string | null = null
    private formattingPreview: Element | null = null
    private revision = -Infinity
    private canvasRevision = -Infinity
    private pendingFrame: number | null = null
    private readonly liveNodes = new Set<string>()
    private readonly finishedNodes = new Set<string>()
    private wheelTimer: number | null = null
    private pendingInteraction: CanvasCollaborationPresence | null = null
    private destroyed = false
    private readonly activityEvents = ['pointerdown', 'pointermove', 'wheel', 'keydown', 'input']
    private readonly followInputEvents = [
        'pointerdown',
        'mousedown',
        'click',
        'dblclick',
        'contextmenu',
        'keydown',
    ]

    constructor(private readonly ports: WorkspaceCanvasCollaborationPorts) {
        const document = ports.pane.ownerDocument
        this.window = document.defaultView!
        const html = createDocumentHtml(document)
        this.chooser = html`<div className="workspace-canvas-follow"></div>` as HTMLDivElement
        this.chooserSvg = select(this.chooser)
            .append<SVGSVGElement>('svg:svg')
            .attr('aria-label', 'Canvas view')
            .node()!
        this.chooser.addEventListener(
            'click',
            this.clearOfflineFollow,
            true,
        )
        this.chooser.addEventListener(
            'keydown',
            this.clearOfflineFollow,
            true,
        )
        this.renderChooser([], MAIN_VIEW)
        this.caretLayer = html`
            <div
                className="workspace-canvas-follow-caret"
                aria-hidden="true"
                hidden
            ></div>
        ` as HTMLDivElement
        this.awarenessLayer = html`
            <div
                className="workspace-canvas-awareness"
                aria-hidden="true"
            ></div>
        ` as HTMLDivElement
        ports.controls.append(this.chooser)
        ports.pane.append(this.caretLayer, this.awarenessLayer)
        this.ownCamera = this.restoreCamera()
        this.connection = ports.createConnection(ports.workspaceId, this.receive)
        this.resize = new ResizeObserver(entries => {
            for (const entry of entries) {
                if (entry.target === this.chooser)
                    this.resizeChooser(entry.contentRect.width)
                else
                    this.resizeCamera()
            }
        })
        this.resize.observe(ports.pane)
        this.resize.observe(this.chooser)
        this.resizeCamera()

        for (const type of this.activityEvents)
            ports.controls.addEventListener(
                type,
                this.markActivity,
                {
                    capture: true,
                    passive: true,
                },
            )

        for (const type of this.followInputEvents)
            ports.pane.addEventListener(
                type,
                this.blockFollowInput,
                true,
            )

        document.addEventListener('pointerup', this.pointerEnd)
        document.addEventListener('pointercancel', this.pointerEnd)
        ports.pane.addEventListener(
            'wheel',
            this.wheel,
            { passive: true },
        )
        ports.pane.addEventListener('keyup', this.readCaret)
        ports.pane.addEventListener('input', this.readCaret)
        ports.pane.addEventListener('lixpi:editor-formatting-menu', this.formattingMenuChanged)
        ports.pane.addEventListener('focusin', this.readCaret)
        ports.pane.addEventListener('focusout', this.clearCaret)
        document.addEventListener('selectionchange', this.readCaret)
        document.addEventListener(
            'scroll',
            this.updateMarkerPosition,
            true,
        )
        this.connection.start()
    }

    changedViewport(viewport: ViewportSnapshot): void {
        if (
            this.followed
            || this.applyingViewport
        )
            return

        const size = this.size()
        const previous = this.ownCamera ? toWorkspaceViewport(this.ownCamera, size) : null

        if (
            previous?.x === viewport.x
            && previous.y === viewport.y
            && previous.zoom === viewport.zoom
        )
            return

        this.ownCamera = toWorkspaceCamera(viewport, size)
        this.lastCamera = this.ownCamera
        this.lastLocalMainCameraAt = Math.max(
            this.lastLocalMainCameraAt,
            Date.now(),
        )
        this.connection.update(
            { camera: this.ownCamera },
            false,
            this.lastLocalMainCameraAt,
        )
        this.scheduleSettledViewport()
        this.pendingFrame ??= this.window.requestAnimationFrame(this.render)
    }

    updatePresence(presence: CanvasCollaborationPresence): void {
        if (
            this.followed
            || this.destroyed
        )
            return

        if (Object.hasOwn(presence, 'library')) {
            this.connection.update(presence)

            return
        }

        if (!this.pendingInteraction) {
            queueMicrotask(() => {
                const pending = this.pendingInteraction
                this.pendingInteraction = null

                if (
                    pending
                    && !this.followed
                    && !this.destroyed
                )
                    this.connection.update(pending, true)
            })
        }

        this.pendingInteraction = {
            ...this.pendingInteraction,
            ...presence,
        }
    }

    previewComposer(draft: CanvasCollaborationPresence['composer']): void {
        if (
            this.followed
            || this.destroyed
            || draft === undefined
        )
            return

        const size = draft && new TextEncoder().encode(
            JSON.stringify(draft.content),
        ).byteLength
        this.connection.update({ composer: size
            && size > 64 * 1024
            ? null
            : draft })
    }

    previewPlayback(
        playback: CanvasCollaborationPresence['playback'],
        terminal: boolean,
    ): void {
        if (
            !this.followed
            && !this.destroyed
        )
            this.connection.update({ playback }, terminal)
    }

    previewConnector(connector: CanvasCollaborationPresence['connector']): void {
        if (
            !this.followed
            && !this.destroyed
        )
            this.connection.update({ connector }, connector === null)
    }

    previewNodes(geometry: Geometry): void {
        for (const { nodeId } of geometry) {
            this.liveNodes.add(nodeId)
            this.finishedNodes.delete(nodeId)
            this.connection.acquireNode(nodeId)
        }

        this.connection.update({ geometry })
    }

    async finishPreview(
        nodeIds: readonly string[],
        committed: boolean,
    ): Promise<void> {
        const active = nodeIds.filter(nodeId => this.liveNodes.delete(nodeId))

        if (!active.length)
            return

        for (const nodeId of active)
            this.finishedNodes.add(nodeId)

        this.connection.flush()

        if (committed) {
            try {
                await this.ports.drainCanvas()
            } catch (error) {
                this.ports.reportError('Canvas geometry save failed:', error)
            }
        }

        if (this.destroyed)
            return

        if (!this.liveNodes.size)
            this.connection.update({ geometry: [] }, true)

        await this.connection.releaseNodes(
            active.filter(nodeId => this.finishedNodes.delete(nodeId)),
        )
    }

    flush = (): void => {
        this.connection.flush()

        if (!this.ownCamera)
            return

        try {
            this.ports.writeCamera(
                this.ports.workspaceId,
                JSON.stringify(this.ownCamera),
            )
        } catch {
            // Storage availability does not affect collaboration.
        }
    }

    destroy(): void {
        this.flush()
        this.destroyed = true
        const { pane } = this.ports

        for (const type of this.activityEvents)
            this.ports.controls.removeEventListener(
                type,
                this.markActivity,
                true,
            )

        for (const type of this.followInputEvents)
            pane.removeEventListener(
                type,
                this.blockFollowInput,
                true,
            )

        pane.ownerDocument.removeEventListener('pointerup', this.pointerEnd)
        pane.ownerDocument.removeEventListener('pointercancel', this.pointerEnd)
        pane.removeEventListener('wheel', this.wheel)
        pane.removeEventListener('keyup', this.readCaret)
        pane.removeEventListener('input', this.readCaret)
        pane.removeEventListener('lixpi:editor-formatting-menu', this.formattingMenuChanged)
        this.reflectFormattingMenu(null)
        pane.removeEventListener('focusin', this.readCaret)
        pane.removeEventListener('focusout', this.clearCaret)
        pane.ownerDocument.removeEventListener('selectionchange', this.readCaret)
        pane.ownerDocument.removeEventListener(
            'scroll',
            this.updateMarkerPosition,
            true,
        )
        this.resize.disconnect()

        if (this.pendingFrame !== null)
            this.window.cancelAnimationFrame(this.pendingFrame)

        if (this.wheelTimer !== null)
            this.window.clearTimeout(this.wheelTimer)

        this.chooser.removeEventListener(
            'click',
            this.clearOfflineFollow,
            true,
        )
        this.chooser.removeEventListener(
            'keydown',
            this.clearOfflineFollow,
            true,
        )
        this.chooserSwitch?.destroy()
        this.chooser.remove()
        this.caretLayer.remove()
        this.ports.pane.querySelector('.workspace-canvas-global-composer')?.classList.remove('workspace-canvas-follow-composer-focus')
        this.awarenessLayer.remove()
        this.participants.clear()
        this.ports.setRemoteSelectedEdges?.(
            new Set(),
        )
        this.connection.destroy()
        this.ports.setRemoteGeometry([])
        this.ports.setRemoteConnectors([])
        this.ports.setFollowedComposer(false, null)
        this.ports.setFollowedPlayback(false, null)
        this.ports.setFollowedActor(null)
    }

    private size(): {
        width: number
        height: number
    } {
        return {
            width: this.ports.pane.clientWidth,
            height: this.ports.pane.clientHeight,
        }
    }

    private restoreCamera(): Camera | null {
        try {
            const camera = JSON.parse(this.ports.readCamera(this.ports.workspaceId) ?? 'null') as Camera | null

            return camera
                && [camera.x, camera.y, camera.zoom].every(Number.isFinite)
                && camera.zoom > 0
                ? camera
                : null
        } catch {
            return null
        }
    }

    private renderChooser(
        viewers: readonly [string, string][],
        selected: string,
    ): void {
        this.chooserViewers = viewers
        const compact = this.chooserOptionWidth < FOLLOW_OPTION_WIDTH
        const key = JSON.stringify([compact, viewers])

        if (key === this.actorsKey) {
            this.chooserSwitch?.setValue(selected)

            return
        }

        this.actorsKey = key
        const activeElement = this.chooser.ownerDocument.activeElement
        const focused = this.chooser.contains(activeElement)
            ? activeElement?.closest('[data-value]')?.getAttribute('data-value')
            : null
        this.chooserSwitch?.destroy()
        const nameCounts = new Map<string, number>()

        for (const [, name] of viewers)
            nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1)

        const options: SlidingSwitchOption[] = [mainViewOption, ...viewers.map(([id, name]) => {
            const points = Array.from(name)
            const shorten = (length: number) => points.length > length ? `${points.slice(0, length).join('')}…` : name
            const duplicate = (nameCounts.get(name) ?? 0) > 1
            const suffix = id.slice(-6)
            const label = compact ? shorten(duplicate ? 2 : 4) : shorten(duplicate ? 9 : 17)
            const labelSuffix = compact ? suffix.slice(-2) : ` (${suffix})`

            return {
                value: id,
                label: duplicate ? `${label}${labelSuffix}` : label,
                ariaLabel: duplicate ? `${name} (${suffix})` : name,
            }
        })]
        this.chooser.style.setProperty('--workspace-follow-width', `${FOLLOW_OPTION_WIDTH * options.length + FOLLOW_TRACK_PADDING}px`)
        this.chooserSwitch = createSlidingSwitch(
            select(this.chooserSvg),
            {
                id: `workspace-canvas-follow-${this.ports.workspaceId}`,
                x: 0,
                y: 0,
                width: this.chooserTrackWidth(),
                height: FOLLOW_OPTION_HEIGHT,
                options,
                selectedValue: selected,
                onChange: this.chooseFollow,
            },
        )

        if (focused)
            this.focusChooserOption(focused)
    }

    private chooserTrackWidth(): number {
        return this.chooserOptionWidth * (this.chooserViewers.length + 1) + FOLLOW_TRACK_PADDING
    }

    private resizeChooser(viewportWidth: number): void {
        if (viewportWidth <= 0)
            return

        const width = Math.min(
            FOLLOW_OPTION_WIDTH,
            Math.max(FOLLOW_OPTION_MIN_WIDTH, Math.floor(viewportWidth) - FOLLOW_TRACK_PADDING),
        )
        const previousWidth = this.chooserOptionWidth

        if (width === previousWidth)
            return

        this.chooserOptionWidth = width

        if ((width === FOLLOW_OPTION_WIDTH) !== (previousWidth === FOLLOW_OPTION_WIDTH))
            this.renderChooser(this.chooserViewers, this.chooserSwitch?.getValue() ?? MAIN_VIEW)
        else
            this.chooserSwitch?.resize(
                0,
                0,
                this.chooserTrackWidth(),
                FOLLOW_OPTION_HEIGHT,
            )
    }

    private focusChooserOption(value: string): void {
        const options = this.chooserSvg.querySelectorAll<SVGGElement>('[role=radio]')
        const target = [...options].find(element => element.getAttribute('data-value') === value) ?? options[0]
        target?.focus()
    }

    private clearOfflineFollow = (event: Event): void => {
        if (
            !this.waitingForParticipant
            || !(event.target instanceof Element)
            || !event.target.closest(`[data-value="${MAIN_VIEW}"]`)
            || (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ')
        )
            return

        this.waitingForParticipant = false
        this.chooseFollow(MAIN_VIEW)
    }

    private chooseFollow = (value: string): void => {
        if (this.chooser.contains(this.chooser.ownerDocument.activeElement))
            this.focusChooserOption(value)

        if (value.startsWith('viewer:'))
            this.connection.follow(
                null,
                value.slice('viewer:'.length),
            )
        else
            this.connection.follow(value === MAIN_VIEW ? null : value.slice('actor:'.length))
    }

    private receive = (
        event: CanvasCollaborationEvent,
        actorId: string,
    ): void => {
        if (this.destroyed)
            return

        if (
            event.canvasState
            && event.canvasRevision > this.canvasRevision
        ) {
            this.canvasRevision = event.canvasRevision
            this.ports.receiveCanvas(event.canvasState, event.canvasRevision)
        }

        if (event.revision < this.revision)
            return

        this.revision = event.revision
        const self = event.actors.find(actor => actor.actorId === actorId)
        this.reflectMainCameras(event, self)
        const actors = event.actors.filter(actor => actor.actorId !== actorId)
        this.others = actors
        const previous = this.followed
        this.followed = resolveFollowedActor(event.actors, actorId)

        if (
            this.followed
            && !previous
        ) {
            const focused = this.ports.pane.ownerDocument.activeElement

            if (
                focused instanceof HTMLElement
                && this.ports.pane.contains(focused)
            )
                focused.blur()

            this.connection.update(
                {
                    caret: null,
                    composerSelection: null,
                },
                true,
            )
        }

        const viewers = new Map<string, string>()

        for (const actor of actors) {
            if (
                actor.kind === 'human'
                && actor.viewerId
                && actor.viewerId === self?.viewerId
            )
                continue

            viewers.set(
                followOptionKey(actor),
                actor.name,
            )
        }

        const direct = actors.find(actor => actor.actorId === self?.followingActorId)
        const selected = self?.followingViewerId
            ? `viewer:${self.followingViewerId}`
            : direct
                ? followOptionKey(direct)
                : MAIN_VIEW
        this.waitingForParticipant = Boolean(self?.followingViewerId && !viewers.has(selected))
        this.renderChooser([...viewers], viewers.has(selected) ? selected : MAIN_VIEW)

        this.pendingFrame ??= this.window.requestAnimationFrame(this.render)
    }

    private reflectMainCameras(
        event: CanvasCollaborationEvent,
        self?: CanvasCollaborationActor,
    ): void {
        const viewers = new Set(
            event.actors.map(actor => actor.viewerId),
        )
        const remember = (sample: CanvasCollaborationMainCamera | undefined): void => {
            if (
                sample
                && viewers.has(sample.viewerId)
                && isNewerCanvasMainCamera(
                    sample,
                    this.mainCameras.get(sample.viewerId),
                )
            )
                this.mainCameras.set(sample.viewerId, sample)
        }

        for (const actor of event.actors)
            remember(actor.mainCamera)

        remember(event.mainCamera)

        for (const viewerId of this.mainCameras.keys()) {
            if (!viewers.has(viewerId))
                this.mainCameras.delete(viewerId)
        }

        if (!self?.viewerId)
            return

        const camera = this.mainCameras.get(self.viewerId)

        if (
            !camera
            || camera.actorId === self.actorId
            || camera.camera === this.ownCamera
        )
            return

        if (
            camera.updatedAt < this.lastLocalMainCameraAt
            || (camera.updatedAt === this.lastLocalMainCameraAt && camera.actorId < self.actorId)
        )
            return

        this.ownCamera = camera.camera
        this.scheduleSettledViewport()
    }

    private render = (): void => {
        this.pendingFrame = null
        this.applyCamera()
        const followed = this.followed
        const composer = followed?.composer
        const composerChanged = followed?.actorId !== this.lastComposerActorId || composer !== this.lastComposer

        if (composerChanged) {
            this.lastComposerActorId = followed?.actorId
            this.lastComposer = composer
            this.ports.setFollowedComposer(
                Boolean(followed),
                composer,
            )
        }

        const interaction = JSON.stringify(
            followed && [followed.actorId, followed.selection, followed.menu, followed.caret, followed.panel, followed.library],
        )

        if (
            this.lastInteraction !== interaction
            || composerChanged
        ) {
            this.lastInteraction = interaction
            this.ports.setFollowedActor(followed)
            this.reflectFormattingMenu(followed?.menu)
        }

        const geometry = this.others.flatMap(actor => actor.geometry ?? [])
        const geometryKey = JSON.stringify(geometry)

        if (this.lastGeometry !== geometryKey) {
            this.lastGeometry = geometryKey
            this.ports.setRemoteGeometry(geometry)
        }

        const playback = followed?.playback ?? null
        const playbackKey = JSON.stringify([Boolean(followed), playback])

        if (this.lastPlayback !== playbackKey) {
            this.lastPlayback = playbackKey
            this.ports.setFollowedPlayback(
                Boolean(followed),
                playback,
            )
        }

        const connectors = this.others.flatMap(
            actor => actor.connector ? [{
                actorId: actor.actorId,
                draft: actor.connector,
            }] : [],
        )
        const connectorKey = JSON.stringify(connectors)

        if (this.lastConnectors !== connectorKey) {
            this.lastConnectors = connectorKey
            this.ports.setRemoteConnectors(connectors)
        }

        this.renderAwareness()
        this.updateMarkerPosition()
    }

    private resizeCamera(): void {
        const size = this.size()

        if (
            size.width <= 0
            || size.height <= 0
        )
            return

        if (!this.ownCamera) {
            this.ownCamera = toWorkspaceCamera(
                this.ports.getViewport(),
                size,
            )
            this.connection.update({ camera: this.ownCamera }, true)
        }

        this.applyCamera(true)
        this.renderAwareness()
    }

    private applyCamera(force = false): void {
        const followed = this.followed
        const followedMain = followed?.kind === 'human'
            && followed.viewerId
            ? this.mainCameras.get(followed.viewerId)?.camera
            : undefined
        const camera = followedMain
            ?? followed?.camera
            ?? this.ownCamera

        if (!camera)
            return

        if (
            !force
            && this.lastCamera?.x === camera.x
            && this.lastCamera.y === camera.y
            && this.lastCamera.zoom === camera.zoom
        )
            return

        this.lastCamera = camera
        this.applyingViewport = true

        try {
            this.ports.setViewport(
                toWorkspaceViewport(
                    camera,
                    this.size(),
                ),
            )
        } finally {
            this.applyingViewport = false
        }

        this.reflectFormattingMenu(this.followed?.menu)
        this.updateMarkerPosition()
    }

    private markActivity = (event: Event): void => {
        if (!event.isTrusted)
            return

        if (
            this.followed
            && event.target instanceof Node
            && this.ports.pane.contains(event.target)
        )
            return

        this.connection.activity?.(
            Date.now(),
        )
    }

    private blockFollowInput = (event: Event): void => {
        if (!this.followed)
            return

        event.preventDefault()
        event.stopImmediatePropagation()
    }

    private pointerEnd = (): void => void this.flush()

    private wheel = (): void => void this.scheduleSettledViewport()

    private scheduleSettledViewport(): void {
        if (this.wheelTimer !== null)
            this.window.clearTimeout(this.wheelTimer)

        this.wheelTimer = this.window.setTimeout(() => {
            this.wheelTimer = null
            this.flush()
        }, 80)
    }

    private formattingMenuChanged = (event: Event): void => {
        if (this.followed)
            return

        const target = event.target
        const node = target instanceof Element ? target.closest<HTMLElement>('[data-node-id]') : null
        const nodeId = node?.dataset.nodeId
        const menu = (event as CustomEvent<CanvasCollaborationPresence['menu']>).detail

        if (!nodeId)
            return

        if (menu) {
            this.formattingSource = nodeId
            this.updatePresence({ menu: {
                ...menu,
                nodeId,
            } })
        } else if (this.formattingSource === nodeId) {
            this.formattingSource = null
            this.updatePresence({ menu: null })
        }
    }

    private reflectFormattingMenu(menu: CanvasCollaborationPresence['menu']): void {
        const editor = menu?.kind.startsWith('format-')
            && menu.nodeId
            && menu.textSelection
            ? this.ports.pane.querySelector(`[data-node-id="${CSS.escape(menu.nodeId)}"] .ProseMirror`)
            : null

        if (editor !== this.formattingPreview)
            this.formattingPreview?.dispatchEvent(
                new CustomEvent('lixpi:canvas-formatting-preview', { detail: null }),
            )

        this.formattingPreview = editor

        if (editor)
            editor.dispatchEvent(
                new CustomEvent('lixpi:canvas-formatting-preview', { detail: menu }),
            )
    }

    private readCaret = (): void => {
        if (this.followed)
            return

        const focused = this.ports.pane.ownerDocument.activeElement
        const composer = focused?.closest('.workspace-canvas-global-composer')

        if (
            focused
            && composer
            && this.ports.pane.contains(composer)
        ) {
            this.connection.update({
                caret: null,
                composerSelection: this.ports.caret?.read(focused) ?? null,
            })

            return
        }

        this.connection.update({ composerSelection: null })
        const node = focused?.closest<HTMLElement>('[data-node-id]')
        const nodeId = node?.dataset.nodeId

        if (
            !focused
            || !nodeId
            || !this.ports.pane.contains(node)
        ) {
            this.connection.update({ caret: null })

            return
        }

        const input = focused instanceof HTMLInputElement ? focused : null
        const start = input?.selectionStart
        const end = input?.selectionEnd

        if (
            start != null
            && end != null
        ) {
            const backwards = input?.selectionDirection === 'backward'
            this.connection.update({
                caret: {
                    nodeId,
                    field: 'title',
                    anchor: backwards ? end : start,
                    head: backwards ? start : end,
                },
            })

            return
        }

        const caret = this.ports.caret?.read(focused)
        this.connection.update({ caret: caret ? {
            ...caret,
            nodeId,
            field: 'content',
        } : null })
    }

    private clearCaret = (): void => {
        if (!this.followed)
            this.connection.update(
                {
                    caret: null,
                    composerSelection: null,
                },
                true,
            )
    }

    private findCaretRects(caret: Caret): readonly DOMRect[] {
        const node = this.ports.pane.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(caret.nodeId)}"]`)

        if (!node)
            return []

        if (caret.field === 'title')
            return this.findTitleSelection(node, caret)

        return this.editorCaretRects(node, caret)
    }

    private editorCaretRects(
        editor: Element,
        selection: {
            anchor: number
            head: number
        },
    ): readonly DOMRect[] {
        const rectangles = this.ports.caret?.rects?.(
            editor,
            selection.anchor,
            selection.head,
        )
        const head = this.ports.caret?.rect(editor, selection.head)

        return rectangles?.length
            ? rectangles
            : head
                ? [head]
                : []
    }

    private findTitleSelection(
        node: HTMLElement,
        caret: Caret,
    ): readonly DOMRect[] {
        const input = node.querySelector<HTMLInputElement>('input[type="text"], input:not([type])')

        if (!input)
            return []

        const box = input.getBoundingClientRect()
        const style = this.window.getComputedStyle(input)
        const html = createDocumentHtml(node.ownerDocument)
        const measure = html`<canvas></canvas>` as HTMLCanvasElement
        const context = measure.getContext('2d')

        if (!context)
            return []

        context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
        const zoom = this.ports.getViewport().zoom
        const offset = (position: number) => context.measureText(
            input.value.slice(0, position),
        ).width - input.scrollLeft
        const left = box.left + (parseFloat(style.paddingLeft) || 0) * zoom
        const right = box.right - (parseFloat(style.paddingRight) || 0) * zoom
        const position = (value: number) => Math.max(
            left,
            Math.min(right, left + offset(value) * zoom),
        )
        const start = Math.min(
            position(caret.anchor),
            position(caret.head),
        )
        const end = Math.max(
            position(caret.anchor),
            position(caret.head),
        )
        const height = (parseFloat(style.fontSize) || 0) * zoom

        return [new DOMRect(
            start,
            box.top + (box.height - height) / 2,
            end - start,
            height,
        )]
    }

    private renderAwareness(): void {
        const viewport = this.ports.getViewport()
        const actorIds = new Set<string>()
        const edgeIds = new Set<string>()
        const html = createDocumentHtml(this.awarenessLayer.ownerDocument)
        const position = (
            x: number,
            y: number,
        ) => `translate(${viewport.x + x * viewport.zoom}px, ${viewport.y + y * viewport.zoom}px)`

        for (const actor of this.others) {
            actorIds.add(actor.actorId)
            const selection = actor.actorId === this.followed?.actorId ? undefined : actor.selection

            for (const edgeId of selection?.edgeIds ?? [])
                edgeIds.add(edgeId)

            if (
                !selection?.nodeIds.length
                && !this.participants.has(actor.actorId)
            )
                continue

            let marker = this.participants.get(actor.actorId)

            if (!marker) {
                const root = html`<div data-actor-id=${actor.actorId}></div>` as HTMLElement
                marker = {
                    root,
                    selections: new Map(),
                }
                this.participants.set(actor.actorId, marker)
                this.awarenessLayer.append(root)
            }

            const nodeIds = new Set(selection?.nodeIds)

            for (const [nodeId, outline] of marker.selections) {
                if (!nodeIds.has(nodeId)) {
                    outline.remove()
                    marker.selections.delete(nodeId)
                }
            }

            for (const nodeId of nodeIds) {
                const bounds = this.ports.getRemoteNodeBounds?.(nodeId)
                let outline = marker.selections.get(nodeId)

                if (!bounds) {
                    outline?.remove()
                    marker.selections.delete(nodeId)

                    continue
                }

                if (!outline) {
                    outline = html`
                        <div
                            className="workspace-canvas-awareness-selection"
                            data-selected-node-id=${nodeId}
                        ></div>
                    ` as HTMLElement
                    marker.selections.set(nodeId, outline)
                    marker.root.prepend(outline)
                }

                outline.style.transform = position(bounds.x, bounds.y)
                outline.style.width = `${bounds.width * viewport.zoom}px`
                outline.style.height = `${bounds.height * viewport.zoom}px`
            }
        }

        for (const [actorId, marker] of this.participants) {
            if (!actorIds.has(actorId)) {
                marker.root.remove()
                this.participants.delete(actorId)
            }
        }

        const edgesKey = JSON.stringify(
            [...edgeIds].sort(),
        )

        if (edgesKey !== this.lastRemoteEdges) {
            this.lastRemoteEdges = edgesKey
            this.ports.setRemoteSelectedEdges?.(edgeIds)
        }
    }

    private updateMarkerPosition = (): void => {
        const followed = this.followed
        const selection = followed?.composerSelection ?? followed?.caret
        const composer = this.ports.pane.querySelector('.workspace-canvas-global-composer')
        composer?.classList.toggle(
            'workspace-canvas-follow-composer-focus',
            Boolean(followed?.composerSelection),
        )
        const caret = composer
            && followed?.composerSelection
            ? this.editorCaretRects(composer, followed.composerSelection)
            : followed?.caret
                ? this.findCaretRects(followed.caret)
                : []
        this.caretLayer.hidden = !caret.length

        if (caret.length) {
            const pane = this.ports.pane.getBoundingClientRect()
            const html = createDocumentHtml(this.caretLayer.ownerDocument)
            const selected = selection?.anchor !== selection?.head
            this.caretLayer.replaceChildren(
                ...caret.map(rect => {
                    const mark = html`<div className="workspace-canvas-follow-caret-mark"></div>` as HTMLElement
                    mark.style.transform = `translate(${rect.left - pane.left}px, ${rect.top - pane.top}px)`
                    mark.style.width = `${Math.max(2, rect.width)}px`
                    mark.style.height = `${rect.height}px`
                    mark.classList.toggle('workspace-canvas-follow-range', selected)

                    return mark
                }),
            )
        }
    }
}
