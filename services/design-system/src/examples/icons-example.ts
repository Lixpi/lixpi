import * as publicIcons from '@lixpi/ui-kit/svg'
import { html } from '@lixpi/ui-primitives/dom'
import { ExampleFrame } from './example-frame.ts'

export class IconsExample {
    readonly frame: ExampleFrame
    private readonly grid: HTMLElement
    private query = ''
    private readonly icons = Object.entries(publicIcons).flatMap(
        ([name, value]) => typeof value === "string"
            && value.includes("<svg")
            ? [{
                name,
                svg: value,
            }]
            : [],
    )

    constructor(host: HTMLElement) {
        this.frame = new ExampleFrame(host, 'Public SVG artwork from @lixpi/ui-kit/svg.')
        this.grid = html`<div className="canvas-library-icons"></div>` as HTMLElement
        this.frame.stage.append(this.grid)
        this.frame.text(
            'Find icon',
            this.query,
            query => {
                this.query = query
                this.render()
            },
        )
        this.frame.code(
            () =>
                "import { navigationSidePanelToggleIcon } from '@lixpi/ui-kit/svg'\nimport { html } from '@lixpi/ui-primitives/dom'\n\nconst icon = html`<span innerHTML=${navigationSidePanelToggleIcon}></span>`",
        )
        this.render()
    }

    private render(): void {
        const query = this.query.trim().toLocaleLowerCase()
        const icons = this.icons.filter(({ name }) => name.toLocaleLowerCase().includes(query))
        this.grid.replaceChildren(
            ...icons.map(
                ({
                    name,
                    svg,
                }) => html`
                    <figure className="canvas-library-icon">
                        <span
                            className="canvas-library-icon-artwork"
                            innerHTML=${svg}
                        ></span>
                        <figcaption>${name}</figcaption>
                    </figure>
                ` as HTMLElement,
            ),
        )
        this.frame.report(`${icons.length} icons`)
    }

    destroy(): void {
        this.frame.destroy()
    }
}
