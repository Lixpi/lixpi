// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type { VideoCanvasNode } from '@lixpi/constants'
import { createDefaultVideoControlsSettings } from '@lixpi/ui-kit/components/video-controls'
import {
    WorkspaceVideoChrome,
    type WorkspaceVideoChromeOptions,
} from './workspace-video-chrome.ts'

const controlMount = vi.hoisted(() => ({ fail: false }))
vi.mock('@lixpi/ui-kit/components/video-controls', async importOriginal => {
    const actual = await importOriginal<typeof import('@lixpi/ui-kit/components/video-controls')>()
    return {
        ...actual,
        createVideoControls: (...args: Parameters<typeof actual.createVideoControls>) => {
            if (controlMount.fail) throw new Error('controls unavailable')
            return actual.createVideoControls(...args)
        },
    }
})

const node: VideoCanvasNode = { nodeId: 'video', type: 'video', assetId: 'asset', position: { x: 100, y: 200 }, dimensions: { width: 400, height: 240 } }
const owners: WorkspaceVideoChrome[] = []

function fixture() {
    const sourceHost = document.createElement('div')
    const video = document.createElement('video')
    video.src = 'https://example.test/video.mp4'
    sourceHost.appendChild(video)
    document.body.appendChild(sourceHost)
    const options: WorkspaceVideoChromeOptions = {
        document,
        settings: { ...createDefaultVideoControlsSettings(), canvas: { horizontalInset: 12, compactHorizontalInset: 4, compactWidthThreshold: 300, bottomInset: 8, zoomScaling: { minZoom: 0.4 } } },
        getVideo: () => video,
        getBounds: node => ({ ...node.position, ...node.dimensions }),
        getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
        getResizeSettings: () => ({ useZoomCompensatedScaling: false, size: 10, offset: 0, minSize: 10, zoomScaling: { minZoom: 0.4 } }),
        startDrag: vi.fn(),
        startResize: vi.fn(),
        togglePlayback: vi.fn(),
    }
    const chrome = new WorkspaceVideoChrome(options)
    document.body.appendChild(chrome.element)
    owners.push(chrome)
    return { chrome, video, sourceHost, options }
}

function mouse(element: Element, type: string, clientX = 110, clientY = 110) {
    element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY }))
}

afterEach(() => {
    controlMount.fail = false
    for (const owner of owners.splice(0)) owner.destroy()
    vi.restoreAllMocks()
    document.body.replaceChildren()
})

describe('WorkspaceVideoChrome', () => {
    it('retains playback controls across metadata and geometry updates and restores the native element on removal', () => {
        const { chrome, video, sourceHost } = fixture()
        chrome.sync([node])
        const element = chrome.element.firstElementChild as HTMLElement
        const svg = element.querySelector('svg')!
        expect(element.querySelector('video')).toBe(video)
        expect(element.querySelector('.canvas-node-footer')).toBeNull()
        expect(element.style.left).toBe('100px')
        chrome.sync([{ ...node, position: { x: 300, y: 400 } }])
        expect(chrome.element.firstElementChild).toBe(element)
        expect(element.querySelector('svg')).toBe(svg)
        expect(element.style.left).toBe('300px')
        expect(element.style.top).toBe('400px')
        expect(chrome.outsideOffsetScreen(node.nodeId, { x: 0, y: 0, zoom: 1 })).toBeGreaterThan(8)
        chrome.sync([])
        expect(sourceHost.firstElementChild).toBe(video)
        expect(chrome.element.children).toHaveLength(0)
        expect(chrome.outsideOffsetScreen(node.nodeId, { x: 0, y: 0, zoom: 1 })).toBe(0)
    })

    it('routes surface drag, corner resize and double-click playback and releases every surface listener', () => {
        const { chrome, options } = fixture()
        chrome.sync([node])
        const surface = chrome.element.querySelector('.workspace-video-surface')!
        vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 400, 240))
        mouse(surface, 'mousedown')
        expect(options.startDrag).toHaveBeenCalledWith(expect.any(MouseEvent), node.nodeId)
        const corners = [[11, 11, 'top-left'], [409, 11, 'top-right'], [11, 249, 'bottom-left'], [409, 249, 'bottom-right']] as const
        for (const [x, y, corner] of corners) {
            mouse(surface, 'mousemove', x, y)
            expect((surface as HTMLElement).style.cursor).toMatch(/resize$/)
            mouse(surface, 'mousedown', x, y)
            expect(options.startResize).toHaveBeenLastCalledWith(expect.any(MouseEvent), node.nodeId, corner)
        }
        mouse(surface, 'dblclick')
        expect(options.togglePlayback).toHaveBeenCalledExactlyOnceWith(node.nodeId)
        chrome.clear()
        mouse(surface, 'mousedown')
        mouse(surface, 'dblclick')
        expect(options.startDrag).toHaveBeenCalledOnce()
        expect(options.startResize).toHaveBeenCalledTimes(4)
        expect(options.togglePlayback).toHaveBeenCalledOnce()
    })

    it('keeps the control row below the node through zoom and live resizing', () => {
        const { chrome } = fixture()
        chrome.sync([node])
        const bounds = { x: 50, y: 60, width: 200, height: 120 }
        chrome.update(node.nodeId, bounds, { x: 90, y: 80, zoom: 0.25 })
        const element = chrome.element.firstElementChild as HTMLElement
        const surface = element.querySelector('.workspace-video-surface') as HTMLElement
        const host = element.querySelector('.workspace-video-controls-host') as HTMLElement
        expect(element.style.left).toBe('50px')
        expect(element.style.top).toBe('60px')
        expect(surface.style.width).toBe('200px')
        expect(surface.style.height).toBe('120px')
        expect(parseFloat(host.style.top)).toBeGreaterThanOrEqual(120)
        const viewBox = element.querySelector('svg')!.getAttribute('viewBox')!.split(' ').map(Number)
        expect(viewBox.every(Number.isFinite)).toBe(true)
        expect(viewBox[2]).toBeGreaterThan(0)
        expect(parseFloat(element.style.height)).toBeGreaterThan(120)
    })

    it.each([[2, 19, true], [2, 21, false], [0.25, 15, true], [0.25, 17, false]] as const)('tests resize corners in screen pixels at zoom %s and distance %s', (zoom, distance, resize) => {
        const { chrome, options } = fixture()
        options.getViewport = () => ({ x: 0, y: 0, zoom })
        chrome.sync([node])
        const surface = chrome.element.querySelector('.workspace-video-surface')!
        vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 400 * zoom, 240 * zoom))
        mouse(surface, 'mousedown', 10 + distance, 10 + distance)
        expect(options.startResize).toHaveBeenCalledTimes(resize ? 1 : 0)
        expect(options.startDrag).toHaveBeenCalledTimes(resize ? 0 : 1)
    })

    it('waits for a playable source and replaces only the changed native element', () => {
        const { chrome, video, sourceHost, options } = fixture()
        video.removeAttribute('src')
        chrome.sync([node])
        expect(chrome.element.children).toHaveLength(0)
        video.src = 'https://example.test/ready.mp4'
        chrome.sync([node])
        const replacement = document.createElement('video')
        replacement.src = 'https://example.test/replacement.mp4'
        sourceHost.appendChild(replacement)
        options.getVideo = () => replacement
        chrome.sync([node])
        expect(chrome.element.querySelector('video')).toBe(replacement)
        expect(video.parentNode).toBe(sourceHost)
        chrome.destroy()
        expect(replacement.parentNode).toBe(sourceHost)
        chrome.sync([node])
        expect(chrome.element.children).toHaveLength(0)
    })

    it('restores every borrowed video when one child cleanup fails', () => {
        const { chrome, options, sourceHost, video } = fixture()
        const other = document.createElement('video')
        other.src = 'https://example.test/other.mp4'
        sourceHost.append(other)
        options.getVideo = id => id === 'video' ? video : other
        chrome.sync([node, { ...node, nodeId: 'other' }])
        const originalInsert = sourceHost.insertBefore.bind(sourceHost)
        vi.spyOn(sourceHost, 'insertBefore').mockImplementation((child, sibling) => {
            originalInsert(child, sibling)
            if (child === other) throw new Error('host cleanup')
            return child
        })
        expect(() => chrome.clear()).toThrow(AggregateError)
        expect(video.parentNode).toBe(sourceHost)
        expect(other.parentNode).toBe(sourceHost)
        expect(chrome.element.children).toHaveLength(0)
        vi.restoreAllMocks()
    })

    it('does not dispose another canvas using the same node identity', () => {
        const first = fixture()
        const second = fixture()
        first.chrome.sync([node])
        second.chrome.sync([node])
        const secondSurface = second.chrome.element.querySelector('.workspace-video-surface')!
        first.chrome.destroy()
        expect(second.chrome.element.querySelector('video')).toBe(second.video)
        mouse(secondSurface, 'dblclick')
        expect(second.options.togglePlayback).toHaveBeenCalledExactlyOnceWith(node.nodeId)
    })

    it('restores borrowed media after a failed control mount and can retry', () => {
        const { chrome, video, sourceHost } = fixture()
        controlMount.fail = true
        expect(() => chrome.sync([node])).toThrow('controls unavailable')
        expect(video.parentNode).toBe(sourceHost)
        expect(chrome.element.children).toHaveLength(0)
        controlMount.fail = false
        chrome.sync([node])
        expect(chrome.element.querySelector('video')).toBe(video)
    })
})
