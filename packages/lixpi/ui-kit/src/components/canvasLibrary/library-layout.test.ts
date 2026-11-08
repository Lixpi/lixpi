// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { lixpiLightTheme } from '@lixpi/themes'
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    createSidePanel,
    type SidePanelInstance,
} from '../sidePanel/sidePanel.ts'
import { CanvasLibraryLayout } from './library-layout.ts'

afterEach(() => document.body.replaceChildren())

describe('canvas library panel surfaces', () => {
    it('uses the production panel geometry and the library-specific inspector width', () => {
        const root = document.createElement('div')
        const layout = new CanvasLibraryLayout(root)
        const handlers = {
            getMaxWidth: () => 600,
            onResize: () => undefined,
            onToggle: () => undefined,
        }
        const navigation = createSidePanel(layout.panel('navigation', handlers))
        const parameters = createSidePanel(layout.panel('parameters', handlers))
        const theme = createSidePanel(layout.panel('theme', handlers))

        expect(navigation.getWidth()).toBe(280)
        expect(layout.minimumWidth('navigation')).toBe(220)
        expect(navigation.element.style.width).toBe('20px')
        expect(navigation.toggleElement?.matches('.navigation-side-panel-toggle')).toBe(true)
        expect(navigation.toggleElement?.style.left).toBe('20px')
        expect(navigation.toggleElement?.style.top).toBe('20px')
        expect(navigation.toggleElement?.style.width).toBe('20px')
        expect(root.style.getPropertyValue('--canvas-library-sidebar-width')).toBe('280px')

        expect(parameters.getWidth()).toBe(416)
        expect(root.style.getPropertyValue('--canvas-library-params-width')).toBe('416px')

        for (const panel of [parameters, theme]) {
            expect(panel.toggleElement?.matches('.side-panel-toggle-right')).toBe(true)
            expect(panel.toggleElement?.matches('.navigation-side-panel-toggle')).toBe(false)
            expect(panel.toggleElement?.style.width).toBe('15px')
            panel.destroy()
        }

        expect(parameters.toggleElement?.style.top).toBe('15px')
        navigation.destroy()
    })

    it('uses the shared right panel tab height before measuring the inspector', () => {
        const root = document.createElement('div')
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        const layout = new CanvasLibraryLayout(root)

        expect(layout.inspectorTabs(svg)).toEqual({
            x: 0,
            y: 0,
            width: 396,
            height: lixpiLightTheme.components.rightPanel.geometry.modeSwitchHeight,
        })

        svg.getBoundingClientRect = () => new DOMRect(0, 0, 305, 32)

        expect(layout.inspectorTabs(svg)).toEqual({
            x: 0,
            y: 0,
            width: 305,
            height: 32,
        })
    })

    it('styles compact section headings and gives the right panels transparent content surfaces', () => {
        const navigation = readFileSync(
            resolve(import.meta.dirname, '../../../styles/navigation-side-panel.scss'),
            'utf8',
        )
        const library = readFileSync(
            resolve(import.meta.dirname, '../../../styles/canvas-library.scss'),
            'utf8',
        )

        const sectionHeading = navigation.split('.navigation-side-panel-section-heading {')[1]?.split('\n}')[0]

        expect(
            sectionHeading?.includes('themeScope.token("sidebar-section", themePalette.$roles)'),
            'section headings should use the shared sidebar color',
        ).toBe(true)
        expect(
            /\.canvas-library-inspector,\s*\.canvas-library-theme-panel\s*\{[^}]*background: transparent/.test(library),
            'the inspector and theme content must expose the glass backdrops',
        ).toBe(true)
    })

    it('mounts one native glass backdrop with the panel and restores both after reopening', () => {
        const root = document.createElement('div')
        const navigation = document.createElement('aside')
        const stage = document.createElement('main')
        root.append(navigation, stage)
        document.body.append(root)
        const layout = new CanvasLibraryLayout(root)
        const panel = createSidePanel(layout.panel('navigation', {
            getMaxWidth: () => 500,
            onResize: () => undefined,
            onToggle: () => undefined,
        }))

        layout.mountPanel('navigation', navigation, panel)
        layout.mountPanel('navigation', navigation, panel)

        expect(panel.element.parentElement).toBe(navigation)
        expect(panel.backdropElement.parentElement).toBe(root)
        expect(panel.backdropElement.nextElementSibling).toBe(navigation)
        expect(panel.backdropElement.dataset.canvasLibraryPanel).toBe('navigation')
        expect(panel.backdropElement.style.getPropertyValue('--side-panel-backdrop-width')).toBe('var(--canvas-library-sidebar-width)')
        expect(root.querySelectorAll('.side-panel-backdrop')).toHaveLength(1)
        expect(root.lastElementChild).toBe(stage)

        panel.detachPanel()
        expect(panel.backdropElement.isConnected).toBe(false)
        expect(panel.element.isConnected).toBe(false)

        layout.mountPanel('navigation', navigation, panel)
        expect(root.querySelectorAll('.side-panel-backdrop')).toHaveLength(1)
        expect(panel.backdropElement.nextElementSibling).toBe(navigation)
        expect(panel.element.parentElement).toBe(navigation)

        panel.destroy()
    })

    it('docks before sliding open and undocks only after the close slide settles', async () => {
        const root = document.createElement('div')
        const navigation = document.createElement('aside')
        root.append(navigation)
        const layout = new CanvasLibraryLayout(root)
        const panel = createSidePanel(layout.panel('navigation', {
            getMaxWidth: () => 500,
            onResize: () => undefined,
            onToggle: () => undefined,
        }))
        let finishClose = (): void => {}
        const playOpen = vi.spyOn(panel, 'playOpen').mockImplementation(async () => {
            expect(root.classList.contains('canvas-library-navigating')).toBe(true)
            expect(navigation.hidden).toBe(false)
        })
        vi.spyOn(panel, 'playClose').mockImplementation(() => new Promise<void>(resolve => void (finishClose = resolve)))

        layout.mountOpen('navigation', navigation, panel)
        const closing = layout.setOpen('navigation', navigation, panel, false)

        expect(root.classList.contains('canvas-library-navigating')).toBe(true)
        finishClose()
        await closing
        expect(root.classList.contains('canvas-library-navigating')).toBe(false)
        expect(navigation.hidden).toBe(true)

        await layout.setOpen('navigation', navigation, panel, true)
        expect(playOpen).toHaveBeenCalledWith(navigation)

        panel.destroy()
    })

    it('keeps a panel docked when it is reopened before its close slide settles', async () => {
        const root = document.createElement('div')
        const theme = document.createElement('aside')
        root.append(theme)
        const layout = new CanvasLibraryLayout(root)
        const finishers: Array<() => void> = []
        const panel = {
            backdropElement: document.createElement('div'),
            element: document.createElement('div'),
            mountOpen: vi.fn(),
            playOpen: vi.fn(async () => undefined),
            playClose: vi.fn(() => new Promise<void>(resolve => void finishers.push(resolve))),
        } as unknown as SidePanelInstance

        layout.mountOpen('theme', theme, panel)
        const closing = layout.setOpen('theme', theme, panel, false)
        await layout.setOpen('theme', theme, panel, true)

        for (const finish of finishers)
            finish()

        await closing
        expect(root.classList.contains('canvas-library-theming')).toBe(true)
        expect(theme.hidden).toBe(false)
    })

    it('overlays panels by default and pushes the stage only for panels configured to push', () => {
        const scss = readFileSync(
            resolve(import.meta.dirname, '../../../styles/canvas-library.scss'),
            'utf8',
        )
        const overlayRoot = document.createElement('div')
        const overlay = new CanvasLibraryLayout(overlayRoot)
        const pushRoot = document.createElement('div')
        const push = new CanvasLibraryLayout(
            pushRoot,
            { placements: { navigation: 'push' } },
        )

        expect(overlay.placement('navigation')).toBe('overlay')
        expect(overlayRoot.dataset.navigationPlacement).toBe('overlay')
        expect(push.placement('navigation')).toBe('push')
        expect(push.placement('parameters')).toBe('overlay')
        expect(scss).toContain('.canvas-library-navigating[data-navigation-placement="push"] {\n    --canvas-library-sidebar-dock-width')
        expect(scss).toContain('.canvas-library[data-navigation-placement="overlay"] > .canvas-library-sidebar {\n    left: 0;')
    })
})
