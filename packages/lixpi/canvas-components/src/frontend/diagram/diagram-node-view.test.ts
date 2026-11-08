// @vitest-environment happy-dom

import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type ComponentContext,
} from '@lixpi/canvas-engine/frontend/runtime'
import {
    type EngineNode,
} from '@lixpi/canvas-engine/shared'
import {
    createDiagramNodeRegistration,
    type DiagramNodeLabelAppearance,
} from './diagram-node-view.ts'

type NodeData = {
    title: string
    tag?: string
    lines: string[]
    shape?: 'rounded-rectangle' | 'circle'
    alignment?: 'start' | 'center'
    heading?: 'title' | 'metric'
}

const createContext = () => {
    const group = {} as never
    const path = {} as never
    const resources = {
        createGroup: vi.fn(() => group),
        createPath: vi.fn((_group: unknown, _shapes: unknown) => path),
        updateGroup: vi.fn((_group: unknown, _transform: unknown) => {}),
        updatePath: vi.fn((_path: unknown, _shapes: unknown) => {}),
        setVisible: vi.fn((_resource: unknown, _visible: boolean) => {}),
        release: vi.fn((_resource: unknown) => {}),
    }
    const context = {
        contentRoot: document.createElement('div'),
        resources,
        layers: { media: {} },
    } as unknown as ComponentContext

    return {
        context,
        group,
        resources,
    }
}

const appearance: DiagramNodeLabelAppearance = {
    fill: '#ffffff',
    stroke: '#667788',
    strokeWidth: 1.25,
    cornerRadius: 12,
    shape: 'circle',
    text: '#112233',
    muted: '#445566',
    accent: '#008877',
    tagBackground: '#eeeeee',
    tagText: '#334455',
    alignment: 'center',
    heading: 'metric',
    shadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
    selectedShadow: '0 0 0 2px #00aaff',
    selectedStyle: {
        fill: '#ddeeff',
    },
}

const createNode = (data: NodeData): EngineNode<NodeData> => ({
    nodeId: 'node-1',
    type: 'research-node',
    data,
    position: {
        x: 10,
        y: 20,
    },
    dimensions: {
        width: 160,
        height: 90,
    },
    ports: [],
})

describe('DiagramNodeView', () => {
    it('renders safe content, updates labels and appearance, activates by keyboard, and releases its owners', () => {
        const {
            context,
            group,
            resources,
        } = createContext()
        const activate = vi.fn()
        const registration = createDiagramNodeRegistration<NodeData>({
            type: 'research-node',
            getContent: node => ({
                title: node.data.title,
                tag: node.data.tag,
                lines: node.data.lines,
            }),
            getAppearance: node => ({
                ...appearance,
                shape: node.data.shape ?? appearance.shape,
                alignment: node.data.alignment ?? appearance.alignment,
                heading: node.data.heading ?? appearance.heading,
            }),
            onActivate: activate,
        })
        const node = createNode({
            title: '<img src=x onerror=alert(1)>',
            tag: 'Relevant',
            lines: ['x = 0.5', 'α = 0.03'],
        })
        const view = registration.mount(node, context)
        const labels = context.contentRoot.querySelector<HTMLDivElement>('.diagram-node-labels')!
        const title = labels.querySelector<HTMLSpanElement>('.diagram-node-title')!
        const tag = labels.querySelector<HTMLSpanElement>('.diagram-node-tag')!
        const lines = (): string[] => Array.from(labels.querySelectorAll('.diagram-node-line'), line => line.textContent ?? '')

        expect(labels.getAttribute('role')).toBe('button')
        expect(labels.tabIndex).toBe(0)
        expect(labels.dataset.shape).toBe('circle')
        expect(labels.dataset.alignment).toBe('center')
        expect(title.dataset.heading).toBe('metric')
        expect(title.textContent).toBe('<img src=x onerror=alert(1)>')
        expect(labels.querySelector('img')).toBeNull()
        expect(tag.textContent).toBe('Relevant')
        expect(tag.hidden).toBe(false)
        expect(labels.style.getPropertyValue('--diagram-node-tag-text')).toBe('#334455')
        expect(labels.ariaLabel).toBe('<img src=x onerror=alert(1)>. Relevant. x = 0.5. α = 0.03')
        expect(labels.ariaPressed).toBe('false')
        expect(lines()).toEqual(['x = 0.5', 'α = 0.03'])

        view.update(createNode({
            title: 'Compare',
            lines: ['y = 0.7', 'δ = 0.1'],
            shape: 'rounded-rectangle',
            alignment: 'start',
            heading: 'title',
        }))
        expect(title.textContent).toBe('Compare')
        expect(title.dataset.heading).toBe('title')
        expect(tag.hidden).toBe(true)
        expect(labels.dataset.shape).toBe('rounded-rectangle')
        expect(labels.dataset.alignment).toBe('start')
        expect(labels.ariaLabel).toBe('Compare. y = 0.7. δ = 0.1')
        expect(lines()).toEqual(['y = 0.7', 'δ = 0.1'])

        view.update(createNode({
            title: 'Done',
            lines: ['final'],
        }))
        expect(lines()).toEqual(['final'])

        view.setSelected(true)
        expect(labels.ariaPressed).toBe('true')
        const shapes = resources.updatePath.mock.calls.at(-1)?.[1] as Array<{
            fill: { color: string }
            stroke: {
                color: string
                width: number
            }
        }>
        expect(shapes[0].fill.color).toBe('#ddeeff')
        expect(shapes[0].stroke).toEqual({
            color: '#667788',
            width: 1.25,
        })
        expect(labels.style.boxShadow).toBe('0 0 0 2px #00aaff')

        view.setSelected(false)
        const unselectedShapes = resources.updatePath.mock.calls.at(-1)?.[1] as Array<{
            fill: { color: string }
            stroke: {
                color: string
                width: number
            }
        }>
        expect(unselectedShapes[0].fill.color).toBe('#ffffff')
        expect(unselectedShapes[0].stroke).toEqual({
            color: '#667788',
            width: 1.25,
        })
        expect(labels.style.boxShadow).toBe('0 2px 8px rgba(0, 0, 0, 0.2)')

        labels.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
        }))
        labels.dispatchEvent(new KeyboardEvent('keydown', {
            key: ' ',
            bubbles: true,
            repeat: true,
        }))
        expect(activate).toHaveBeenCalledExactlyOnceWith('node-1')

        view.setVisible(false)
        expect(resources.setVisible).toHaveBeenCalledWith(group, false)
        view.setGeometry({
            x: 30,
            y: 40,
            width: 200,
            height: 110,
        }, {
            x: 0,
            y: 0,
            zoom: 1,
        })
        expect(labels.style.width).toBe('200px')
        expect(labels.style.height).toBe('110px')

        view.destroy()
        view.destroy()
        labels.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
        }))
        expect(activate).toHaveBeenCalledTimes(1)
        expect(context.contentRoot.querySelector('.diagram-node-labels')).toBeNull()
        expect(resources.release).toHaveBeenCalledTimes(1)
    })
})
