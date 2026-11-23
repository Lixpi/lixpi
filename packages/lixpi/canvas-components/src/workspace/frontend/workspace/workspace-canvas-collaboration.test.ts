// @vitest-environment happy-dom
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type CanvasCollaborationEvent,
    type CanvasCollaborationPresence,
    type CanvasState,
    type DocumentCanvasNode,
} from '@lixpi/constants'
import {
    WorkspaceCanvasCollaboration,
    toWorkspaceCamera,
    toWorkspaceViewport,
} from './workspace-canvas-collaboration.ts'

import { resolveFollowedActor } from '../../shared/scene/resolve-followed-actor.ts'

const mountView = (initialX: number, storage: Map<string, string>, actorId = 'local', width = 420) => {
    const pane = document.createElement('div')
    const controls = document.createElement('div')
    Object.defineProperties(pane, {
        clientWidth: { value: width },
        clientHeight: { value: 760 },
    })
    document.body.append(pane, controls)
    const follow = vi.fn()
    const update = vi.fn()
    const setFollowedActor = vi.fn()
    const setRemoteGeometry = vi.fn()
    const setRemoteSelectedEdges = vi.fn()
    const receiveCanvas = vi.fn()
    const getRemoteNodeBounds = (nodeId: string) => {
        const graph = receiveCanvas.mock.lastCall?.[0] as CanvasState | undefined
        const node = graph?.nodes.find(item => item.nodeId === nodeId)

        if (!node)
            return undefined

        const geometry = setRemoteGeometry.mock.lastCall?.[0] as CanvasCollaborationPresence['geometry']
        const preview = geometry?.find(item => item.nodeId === nodeId)

        return preview ?? {
            ...node.position,
            ...node.dimensions,
        }
    }
    let viewport = {
        x: initialX,
        y: 0,
        zoom: 1,
    }
    let receive: ((event: CanvasCollaborationEvent, actorId: string) => void) | undefined
    const view = new WorkspaceCanvasCollaboration({
        workspaceId: 'workspace',
        pane,
        controls,
        setViewport: next => void (viewport = next),
        getViewport: () => viewport,
        setFollowedActor,
        setRemoteGeometry,
        getRemoteNodeBounds,
        setRemoteSelectedEdges,
        setRemoteConnectors: vi.fn(),
        setFollowedComposer: vi.fn(),
        setFollowedPlayback: vi.fn(),
        createConnection: (_, changed) => {
            receive = changed

            return {
                start: vi.fn(),
                update,
                flush: vi.fn(),
                follow,
                acquireNode: vi.fn(),
                releaseNodes: vi.fn(async () => {}),
                destroy: vi.fn(),
            }
        },
        receiveCanvas,
        readCamera: key => storage.get(key) ?? null,
        writeCamera: (key, value) => void storage.set(key, value),
        drainCanvas: vi.fn(async () => {}),
        reportError: vi.fn(),
    })

    return {
        view,
        pane,
        controls,
        follow,
        update,
        receiveCanvas,
        setFollowedActor,
        setRemoteGeometry,
        setRemoteSelectedEdges,
        read: () => viewport,
        receive: (
            revision: number,
            actors: CanvasCollaborationEvent['actors'],
            canvasState?: CanvasState,
            mainCamera?: CanvasCollaborationEvent['mainCamera'],
        ) => receive?.({
            workspaceId: 'workspace',
            revision,
            canvasRevision: revision,
            canvasState,
            ownership: [],
            queue: [],
            actors,
            mainCamera,
        }, actorId),
        destroy: () => {
            view.destroy()
            pane.remove()
            controls.remove()
        },
    }
}

describe('workspace collaboration camera', () => {
    it('preserves independent cameras for separate sessions and restores the local view after a follow target leaves', async () => {
        const firstStorage = new Map<string, string>()
        const secondStorage = new Map<string, string>()
        const first = mountView(10, firstStorage)
        const second = mountView(30, secondStorage)
        const local = {
            actorId: 'local',
            name: 'Local',
            kind: 'human' as const,
        }
        const peer = {
            actorId: 'peer',
            name: 'Peer',
            kind: 'agent' as const,
            camera: {
                x: 50,
                y: 80,
                zoom: 2,
            },
        }

        try {
            first.view.flush()
            second.view.flush()
            expect(firstStorage.get('workspace')).not.toEqual(secondStorage.get('workspace'))

            first.receive(1, [{
                ...local,
                followingActorId: 'peer',
            }, peer])
            await vi.waitFor(() => expect(first.read()).toEqual({
                x: 110,
                y: 220,
                zoom: 2,
            }))
            expect(second.read()).toEqual({
                x: 30,
                y: 0,
                zoom: 1,
            })

            first.receive(2, [local])
            await vi.waitFor(() => expect(first.read()).toEqual({
                x: 10,
                y: 0,
                zoom: 1,
            }))
        } finally {
            first.destroy()
            second.destroy()
        }
    })

    it('groups account devices and follows the freshest device without changing the account selection', async () => {
        const mounted = mountView(10, new Map())
        const chooser = mounted.controls.querySelector('.workspace-canvas-follow')!
        const options = () => Array.from(chooser.querySelectorAll('[role=radio]'), radio => radio.getAttribute('data-value'))
        const selected = () => chooser.querySelector('[role=radio][aria-checked=true]')?.getAttribute('data-value')
        const choose = (value: string) => chooser.querySelector(`[role=radio][data-value="${value}"]`)!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        const self = {
            actorId: 'local',
            viewerId: 'local-account',
            name: 'Local',
            kind: 'human' as const,
        }
        const secondLocal = {
            ...self,
            actorId: 'local-tablet',
        }
        const desktop = {
            actorId: 'peer-desktop',
            viewerId: 'peer-account',
            name: 'Peer',
            kind: 'human' as const,
            lastActiveAt: 10,
            camera: {
                x: 20,
                y: 30,
                zoom: 2,
            },
        }
        const phone = {
            ...desktop,
            actorId: 'peer-phone',
            lastActiveAt: 9,
            camera: {
                x: 70,
                y: 50,
                zoom: 2,
            },
        }
        const agent = {
            actorId: 'agent',
            name: 'Agent',
            kind: 'agent' as const,
        }
        const otherAgent = {
            ...agent,
            actorId: 'other-agent',
        }

        try {
            expect(options()).toEqual(['main'])
            expect(chooser.querySelector('[role=radio]')?.getAttribute('aria-label')).toBe('Main view')
            mounted.receive(1, [self, desktop, phone, secondLocal, agent, otherAgent])
            expect(options()).toEqual(['main', 'viewer:peer-account', 'actor:agent', 'actor:other-agent'])
            choose('viewer:peer-account')
            expect(mounted.follow).toHaveBeenCalledWith(null, 'peer-account')

            const following = {
                ...self,
                followingViewerId: 'peer-account',
                followingActorId: 'peer-desktop',
            }
            mounted.receive(2, [following, desktop, phone])
            await vi.waitFor(() => expect(mounted.read()).toEqual({
                x: 170,
                y: 320,
                zoom: 2,
            }))

            mounted.receive(2, [following, desktop, phone])
            expect(mounted.read()).toEqual({
                x: 170,
                y: 320,
                zoom: 2,
            })

            mounted.receive(3, [following, desktop, {
                ...phone,
                lastActiveAt: 11,
            }])
            await vi.waitFor(() => expect(mounted.read()).toEqual({
                x: 70,
                y: 280,
                zoom: 2,
            }))
            expect(selected()).toBe('viewer:peer-account')

            mounted.receive(4, [{
                ...following,
                followingActorId: null,
            }])
            await vi.waitFor(() => expect(mounted.read()).toEqual({
                x: 10,
                y: 0,
                zoom: 1,
            }))
            expect(options()).toEqual(['main'])
            expect(selected()).toBe('main')
            choose('main')
            expect(mounted.follow).toHaveBeenCalledTimes(2)
            expect(mounted.follow).toHaveBeenLastCalledWith(null)
        } finally {
            mounted.destroy()
        }
    })

    it('fits Main view in 64 pixels and keeps longer participant names accessible', () => {
        type ObservedSize = {
            target: Element
            contentRect: { width: number }
        }
        let observeSize: ((entries: ObservedSize[]) => void) | undefined
        vi.stubGlobal('ResizeObserver', class {
            constructor(callback: (entries: ObservedSize[]) => void) {
                observeSize = callback
            }
            observe() {}
            disconnect() {}
        })
        const mounted = mountView(10, new Map())
        const chooser = mounted.controls.querySelector('.workspace-canvas-follow')!
        const track = chooser.querySelector('svg')!
        const radios = () => Array.from(chooser.querySelectorAll<SVGGElement>('[role=radio]'))
        const resize = (width: number) => observeSize?.([{
            target: chooser,
            contentRect: { width },
        }])
        const self = {
            actorId: 'local',
            name: 'Local',
            kind: 'human' as const,
        }
        const peer = {
            actorId: 'peer',
            viewerId: 'peer-account',
            name: 'Long participant name',
            kind: 'human' as const,
        }
        const agent = {
            actorId: 'agent',
            name: 'Canvas agent',
            kind: 'agent' as const,
        }

        try {
            resize(64)
            expect(track.getAttribute('width')).toBe('64')
            expect(radios()[0].getAttribute('aria-label')).toBe('Main view')

            mounted.receive(1, [self, peer, agent])
            expect(track.getAttribute('width')).toBe('184')
            expect(radios().map(option => option.getAttribute('aria-label'))).toEqual([
                'Main view',
                peer.name,
                agent.name,
            ])
            expect(radios()[1].textContent).toBe('Long…')

            const press = (key: string) => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
                key,
                bubbles: true,
            }))
            radios()[0].focus()
            press('ArrowRight')
            expect(mounted.follow).toHaveBeenLastCalledWith(null, 'peer-account')
            expect(document.activeElement).toBe(radios()[1])
            press('End')
            expect(mounted.follow).toHaveBeenLastCalledWith('agent')
            expect(document.activeElement).toBe(radios()[2])
            press('Home')
            expect(mounted.follow).toHaveBeenLastCalledWith(null)
            expect(document.activeElement).toBe(radios()[0])

            resize(280)
            expect(track.getAttribute('width')).toBe('340')
            expect(radios()[1].textContent).toBe('Long participant …')
            expect(radios()[1].getAttribute('aria-label')).toBe(peer.name)
            expect(document.activeElement).toBe(radios()[0])
        } finally {
            mounted.destroy()
            vi.unstubAllGlobals()
        }
    })

    it('mirrors the effective participant in a follow chain and returns to the local camera when the direct target leaves', () => {
        const self = {
            actorId: 'local',
            name: 'Local',
            kind: 'human' as const,
            followingActorId: 'peer',
        }
        const peer = {
            actorId: 'peer',
            name: 'Peer',
            kind: 'human' as const,
            followingActorId: 'agent',
        }
        const agent = {
            actorId: 'agent',
            name: 'Agent',
            kind: 'agent' as const,
        }

        expect(resolveFollowedActor([self, peer, agent], 'local')).toBe(agent)
        expect(resolveFollowedActor([self, peer], 'local')).toBe(peer)
        expect(resolveFollowedActor([self, agent], 'local')).toBeNull()
        expect(resolveFollowedActor([self, {
            ...peer,
            followingActorId: null,
            followingViewerId: 'offline',
        }], 'local')).toBeNull()
    })

    it('shows simultaneous peer selections and graph edits without peer cursor graphics', async () => {
        const mounted = mountView(10, new Map())
        const self = {
            actorId: 'local',
            name: 'Local',
            kind: 'human' as const,
        }
        const humanPreview = {
            nodeId: 'first',
            x: 30,
            y: 40,
            width: 60,
            height: 80,
        }
        const agentPreview = {
            nodeId: 'second',
            x: 180,
            y: 160,
            width: 140,
            height: 100,
        }
        const human = {
            actorId: 'human',
            name: 'Human',
            kind: 'human' as const,
            camera: {
                x: 100,
                y: 200,
                zoom: 2,
            },
            cursor: {
                x: 20,
                y: 35,
            },
            selection: {
                nodeIds: ['first'],
                edgeIds: [],
            },
            geometry: [humanPreview],
        }
        const agent = {
            actorId: 'agent',
            name: 'Agent',
            kind: 'agent' as const,
            camera: {
                x: 50,
                y: 60,
                zoom: 3,
            },
            cursor: {
                x: 25,
                y: 30,
            },
            selection: {
                nodeIds: ['second'],
                edgeIds: ['selected-edge'],
            },
            geometry: [agentPreview],
        }
        const node = (nodeId: string, x: number): DocumentCanvasNode => ({
            nodeId,
            assetId: nodeId,
            type: 'document',
            position: {
                x,
                y: 0,
            },
            dimensions: {
                width: 100,
                height: 100,
            },
        })
        const original: CanvasState = {
            viewport: {
                x: 300,
                y: 200,
                zoom: 2,
            },
            nodes: [node('first', 0), node('second', 100)],
            edges: [],
        }
        const updated: CanvasState = {
            viewport: {
                x: 120,
                y: 100,
                zoom: 3,
            },
            nodes: [node('second', 180), node('added', 200)],
            edges: [],
        }
        const marker = (actorId: string, mark: string) => mounted.pane.querySelector<HTMLElement>(`[data-actor-id="${actorId}"] ${mark}`)

        try {
            mounted.receive(1, [self, human, agent], original)
            await vi.waitFor(() => expect(mounted.setRemoteGeometry).toHaveBeenLastCalledWith([humanPreview, agentPreview]))
            expect(mounted.setRemoteSelectedEdges).toHaveBeenLastCalledWith(new Set(['selected-edge']))
            expect(mounted.pane.querySelector('.workspace-canvas-awareness-cursor')).toBeNull()
            expect(marker('human', '[data-selected-node-id="first"]')?.style.transform).toBe('translate(40px, 40px)')
            expect(marker('agent', '[data-selected-node-id="second"]')?.style.width).toBe('140px')
            expect(mounted.read()).toEqual({
                x: 10,
                y: 0,
                zoom: 1,
            })
            expect(mounted.setFollowedActor).toHaveBeenLastCalledWith(null)

            mounted.receive(2, [self, {
                ...human,
                geometry: [],
            }, {
                ...agent,
                geometry: [],
            }], updated)
            await vi.waitFor(() => expect(mounted.setRemoteGeometry).toHaveBeenLastCalledWith([]))
            expect(mounted.receiveCanvas).toHaveBeenLastCalledWith(updated, 2)
            expect(marker('human', '[data-selected-node-id="first"]')).toBeNull()
            expect(marker('agent', '[data-selected-node-id="second"]')?.style.width).toBe('100px')
            expect(mounted.read()).toEqual({
                x: 10,
                y: 0,
                zoom: 1,
            })

            mounted.receive(3, [self, human])
            await vi.waitFor(() => expect(marker('agent', '[data-selected-node-id="second"]')).toBeNull())
            expect(mounted.setRemoteSelectedEdges).toHaveBeenLastCalledWith(new Set())
        } finally {
            mounted.destroy()
        }
    })

    it('shares Main view across account devices while keeping follow camera independent', async () => {
        const desktop = mountView(10, new Map(), 'desktop', 1600)
        const tabletStorage = new Map<string, string>()
        const tablet = mountView(30, tabletStorage, 'tablet')
        const desktopActor = {
            actorId: 'desktop',
            viewerId: 'account',
            name: 'Local',
            kind: 'human' as const,
        }
        const tabletActor = {
            ...desktopActor,
            actorId: 'tablet',
        }
        const otherAccount = {
            ...desktopActor,
            actorId: 'other-account-device',
            viewerId: 'other-account',
        }
        const agent = {
            actorId: 'agent',
            name: 'Agent',
            kind: 'agent' as const,
            camera: {
                x: 100,
                y: 120,
                zoom: 4,
            },
        }
        const actors = [desktopActor, tabletActor, otherAccount, agent]
        const camera = {
            x: 300,
            y: 150,
            zoom: 2,
        }
        const stamp = vi.spyOn(Date, 'now').mockReturnValue(1000)

        try {
            desktop.receive(1, actors)
            tablet.receive(1, actors)
            desktop.update.mockClear()
            tablet.update.mockClear()
            desktop.view.changedViewport({
                x: 200,
                y: 80,
                zoom: 2,
            })
            expect(desktop.update).toHaveBeenLastCalledWith({ camera }, false, 1000)
            const desktopSample = {
                viewerId: 'account',
                actorId: 'desktop',
                sequence: 1,
                updatedAt: 1000,
                camera,
            }
            tablet.receive(2, actors, undefined, desktopSample)
            await vi.waitFor(() => expect(tablet.read()).toEqual({
                x: -390,
                y: 80,
                zoom: 2,
            }))
            expect(tablet.update).not.toHaveBeenCalled()

            tablet.receive(3, actors, undefined, {
                ...desktopSample,
                viewerId: 'other-account',
                actorId: otherAccount.actorId,
                updatedAt: 1001,
                camera: agent.camera,
            })
            expect(tablet.read()).toEqual({
                x: -390,
                y: 80,
                zoom: 2,
            })

            const following = [
                desktopActor,
                {
                    ...tabletActor,
                    followingActorId: 'agent',
                },
                otherAccount,
                agent,
            ]
            tablet.receive(4, following)
            const latest = {
                x: 70,
                y: 60,
                zoom: 3,
            }
            tablet.receive(5, following, undefined, {
                ...desktopSample,
                sequence: 2,
                updatedAt: 1002,
                camera: latest,
            })
            await vi.waitFor(() => expect(tablet.read()).toEqual({
                x: -190,
                y: -100,
                zoom: 4,
            }))
            tablet.receive(6, actors)
            await vi.waitFor(() => expect(tablet.read()).toEqual({
                x: 0,
                y: 200,
                zoom: 3,
            }))
            tablet.view.flush()
            expect(JSON.parse(tabletStorage.get('workspace')!)).toEqual(latest)
        } finally {
            stamp.mockRestore()
            desktop.destroy()
            tablet.destroy()
        }
    })

    it('keeps the same world point and zoom centered across different viewport sizes', () => {
        const desktopSize = {
            width: 1600,
            height: 800,
        }
        const phoneSize = {
            width: 420,
            height: 760,
        }
        const desktopViewport = {
            x: 200,
            y: -30,
            zoom: 2,
        }
        const camera = toWorkspaceCamera(
            desktopViewport,
            desktopSize,
        )
        const phoneViewport = toWorkspaceViewport(
            camera,
            phoneSize,
        )

        expect(phoneViewport).toEqual({
            x: -390,
            y: -50,
            zoom: 2,
        })
        expect(toWorkspaceCamera(
            phoneViewport,
            phoneSize,
        )).toEqual(camera)
    })
})
