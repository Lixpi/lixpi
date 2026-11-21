import { select } from 'd3-selection'
import { html } from '@lixpi/ui-primitives/dom'

import { ExampleFrame } from './example-frame.ts'

type SvgSize = {
    width: number
    height: number
}

// The page shell for examples of the general UI packages. The stage scrolls a
// column of specimens, each a titled area that holds one live component.
// Cleanups registered with `own` run in reverse order before the frame closes.
export class UiExample {
    readonly frame: ExampleFrame
    readonly surface: HTMLElement
    private readonly cleanups: Array<() => void> = []
    private destroyed = false

    constructor(
        host: HTMLElement,
        instructions: string,
    ) {
        this.frame = new ExampleFrame(host, instructions)
        this.surface = html`<div className="documentation-ui-stage"></div>` as HTMLElement
        this.frame.stage.append(this.surface)
    }

    specimen(
        title: string,
        ...content: Node[]
    ): HTMLElement {
        const body = html`<div className="documentation-ui-specimen-body">${content}</div>` as HTMLElement
        this.surface.append(
            html`
                <section className="documentation-ui-specimen">
                    <h3 className="documentation-ui-specimen-title">${title}</h3>
                    ${body}
                </section>
            ` as HTMLElement,
        )

        return body
    }

    // An SVG host for D3 controls. Controls render into the returned
    // selection and the element sizes itself to the given box.
    svg(
        parent: HTMLElement,
        size: SvgSize,
    ) {
        const svg = select(parent)
            .append('svg')
            .attr('class', 'documentation-ui-svg')
            .attr('width', size.width)
            .attr('height', size.height)

        return svg
    }

    own(cleanup: () => void): void {
        this.cleanups.push(cleanup)
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true

        for (const cleanup of this.cleanups.reverse())
            cleanup()

        this.cleanups.length = 0
        this.frame.destroy()
    }
}
