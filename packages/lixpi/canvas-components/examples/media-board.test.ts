import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type {
    CanvasControllerOptions,
    ComponentContext,
    NodeView,
} from '@lixpi/canvas-engine/frontend/runtime'
import {
    MediaBoard,
    mountTwoBoards,
    type MediaBoardOptions,
} from './media-board.ts'

const controllers = vi.hoisted(() => [] as any[])
vi.mock('@lixpi/canvas-engine/styles/interaction', () => ({}))
vi.mock('@lixpi/canvas-engine/frontend/runtime', async importOriginal => {
    const actual = await importOriginal<typeof import('@lixpi/canvas-engine/frontend/runtime')>()
    class Controller {
        readonly setScene = vi.fn()
        readonly note: NodeView
        readonly destroy: () => void
        constructor(readonly options: CanvasControllerOptions) {
            const node = options.scene.nodes.find(node => node.type === 'note')!
            this.note = options.registry.get('note')!.mount(node, { contentRoot: options.root } as ComponentContext)
            this.destroy = vi.fn(() => this.note.destroy())
            controllers.push(this)
        }
    }
    return { ...actual, CanvasController: Controller }
})
afterEach(() => {
    controllers.length = 0
})

function options(): MediaBoardOptions {
    return { imageUrl: 'https://example.test/image.jpg', videoUrl: 'https://example.test/video.mp4', color: '#445566', mountEditor: () => () => {}, onError: vi.fn() }
}

describe('public media board example', () => {
    it('retains editor changes emitted during controller construction', () => {
        const dispose = vi.fn()
        const board = new MediaBoard({} as HTMLElement, {
            ...options(),
            mountEditor: (_root, _text, change) => {
                change('mounted draft')
                return dispose
            },
        })
        expect(board.getSnapshot().nodes[0].data).toEqual({ text: 'mounted draft' })
        expect(controllers[0].setScene).toHaveBeenLastCalledWith(board.getSnapshot())
        board.destroy()
        expect(dispose).toHaveBeenCalledOnce()
    })

    it('keeps edits and teardown separate across two mounted boards', () => {
        const edits: Array<(text: string) => void> = []
        const disposals = [vi.fn(), vi.fn()]
        const boards = mountTwoBoards({} as HTMLElement, {} as HTMLElement, {
            ...options(),
            mountEditor: (_root, _text, change) => {
                edits.push(change)
                return disposals[edits.length - 1]
            },
        })
        expect(boards[0].getSnapshot().sceneKey).not.toBe(boards[1].getSnapshot().sceneKey)
        boards[0].destroy()
        edits[0]('late draft')
        edits[1]('second draft')
        expect(controllers[0].setScene).not.toHaveBeenCalled()
        expect(boards[1].getSnapshot().nodes[0].data).toEqual({ text: 'second draft' })
        expect(disposals[0]).toHaveBeenCalledOnce()
        expect(disposals[1]).not.toHaveBeenCalled()
        boards[1].destroy()
    })
})
