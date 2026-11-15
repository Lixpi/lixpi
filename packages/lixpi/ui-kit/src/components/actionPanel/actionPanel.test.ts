// @vitest-environment happy-dom
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    ActionPanelRegistry,
    createActionPanel,
} from './actionPanel.ts'

describe('ActionPanel', () => {
    it('renders buttons and host elements in order inside the pill', () => {
        const onClick = vi.fn()
        const extra = document.createElement('div')
        const panel = createActionPanel({
            document,
            className: 'host-panel',
            children: [
                {
                    iconSvg: '<svg></svg>',
                    ariaLabel: 'New Document',
                    onClick,
                },
                extra,
            ],
        })
        const button = panel.element.firstElementChild as HTMLButtonElement

        expect(panel.element.matches('.action-panel.host-panel')).toBe(true)
        expect(button.matches('button.action-panel-button')).toBe(true)
        expect(button.type).toBe('button')
        expect(button.getAttribute('aria-label')).toBe('New Document')
        expect(button.dataset.helpTooltip).toBe('aria-label')
        expect(button.querySelector('svg')).not.toBeNull()
        expect(panel.element.lastElementChild).toBe(extra)

        button.click()

        expect(onClick).toHaveBeenCalledTimes(1)

        panel.destroy()
    })

    it('registers the panel for glass rendering until it is destroyed', () => {
        const registry = ActionPanelRegistry.for(document)
        const listener = vi.fn()
        const unsubscribe = registry.subscribe(listener)
        const panel = createActionPanel({ document })
        document.body.append(panel.element)

        expect(registry.list().some(target => target.element === panel.element)).toBe(true)
        expect(listener).toHaveBeenCalledTimes(1)

        panel.destroy()
        panel.destroy()

        expect(registry.list().some(target => target.element === panel.element)).toBe(false)
        expect(panel.element.isConnected).toBe(false)
        expect(listener).toHaveBeenCalledTimes(2)

        unsubscribe()
    })

    it('keeps a separate registry for each document', () => {
        const other = document.implementation.createHTMLDocument('other')
        const panel = createActionPanel({ document: other })

        expect(ActionPanelRegistry.for(other).list().map(target => target.element)).toEqual([panel.element])
        expect(ActionPanelRegistry.for(document).list().some(target => target.element === panel.element)).toBe(false)

        panel.destroy()
    })
})
