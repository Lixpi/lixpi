import {
    Compartment,
    EditorState,
    type Extension,
} from '@codemirror/state'
import {
    EditorView,
    lineNumbers,
} from '@codemirror/view'
import { javascript } from '@codemirror/lang-javascript'
import {
    basicDark,
    basicLight,
    gruvboxDark,
    gruvboxLight,
    lixpiGruvboxLight,
    materialDark,
    nord,
    solarizedDark,
    solarizedLight,
} from '@lixpi/prosemirror-themes'
import { html } from '@lixpi/ui-primitives/dom'

import {
    type ExampleOwner,
} from '../../catalog/catalog.ts'
import { UiExample } from '../ui-example.ts'

const themes: ReadonlyArray<{
    name: string
    importPath: string
    extension: Extension
}> = [
    {
        name: 'lixpiGruvboxLight',
        importPath: '@lixpi/prosemirror-themes/lixpi-gruvbox-light',
        extension: lixpiGruvboxLight,
    },
    {
        name: 'basicLight',
        importPath: '@lixpi/prosemirror-themes/basic-light',
        extension: basicLight,
    },
    {
        name: 'basicDark',
        importPath: '@lixpi/prosemirror-themes/basic-dark',
        extension: basicDark,
    },
    {
        name: 'gruvboxLight',
        importPath: '@lixpi/prosemirror-themes/gruvbox-light',
        extension: gruvboxLight,
    },
    {
        name: 'gruvboxDark',
        importPath: '@lixpi/prosemirror-themes/gruvbox-dark',
        extension: gruvboxDark,
    },
    {
        name: 'materialDark',
        importPath: '@lixpi/prosemirror-themes/material-dark',
        extension: materialDark,
    },
    {
        name: 'nord',
        importPath: '@lixpi/prosemirror-themes/nord',
        extension: nord,
    },
    {
        name: 'solarizedLight',
        importPath: '@lixpi/prosemirror-themes/solarized-light',
        extension: solarizedLight,
    },
    {
        name: 'solarizedDark',
        importPath: '@lixpi/prosemirror-themes/solarized-dark',
        extension: solarizedDark,
    },
]

const SAMPLE_SOURCE = [
    '// A shot list for the launch video.',
    'const shots = [',
    "    { name: 'wide', seconds: 4 },",
    "    { name: 'product', seconds: 6 },",
    ']',
    '',
    'export const runtime = shots.reduce((total, shot) => total + shot.seconds, 0)',
].join('\n')

// Mounts one CodeMirror editor per theme over the same source. Line numbers
// sit in a compartment so the toggle reconfigures every editor in place.
class CodeThemeGallery {
    private readonly example: UiExample
    private readonly gutters = new Compartment()
    private readonly views: EditorView[] = []
    private showLineNumbers = true
    private themeName = 'lixpiGruvboxLight'

    constructor(host: HTMLElement) {
        this.example = new UiExample(
            host,
            'Each editor below is CodeMirror with one theme from @lixpi/prosemirror-themes applied as an extension. The code blocks in Lixpi documents use lixpiGruvboxLight. Edit any editor to see how the theme colors syntax as you type.',
        )

        for (const theme of themes) {
            // CodeMirror owns its scroller's DOM, so the shared overlay
            // scrollbars stay out of it.
            const container = html`
                <div
                    className="documentation-ui-code-theme"
                    data-scrollbars="off"
                ></div>
            ` as HTMLElement
            this.example.specimen(theme.name, container)
            this.views.push(
                new EditorView({
                    parent: container,
                    state: EditorState.create({
                        doc: SAMPLE_SOURCE,
                        extensions: [
                            javascript(),
                            // Wrapped lines keep the editor from scrolling
                            // sideways, so the page scrolls under the pointer.
                            EditorView.lineWrapping,
                            theme.extension,
                            this.gutters.of(this.showLineNumbers ? lineNumbers() : []),
                        ],
                    }),
                }),
            )
        }

        this.example.own(() => {
            for (const view of this.views)
                view.destroy()
        })
        this.example.frame.toggle(
            'Line numbers',
            this.showLineNumbers,
            value => {
                this.showLineNumbers = value

                for (const view of this.views)
                    view.dispatch({
                        effects: this.gutters.reconfigure(value ? lineNumbers() : []),
                    })
            },
        )
        this.example.frame.select(
            'Theme in code',
            this.themeName,
            Object.fromEntries(
                themes.map(theme => [theme.name, theme.name]),
            ),
            value => void (this.themeName = value),
        )
        this.example.frame.code(() => {
            const theme = themes.find(candidate => candidate.name === this.themeName) ?? themes[0]

            return [
                "import { EditorView } from '@codemirror/view'",
                "import { EditorState } from '@codemirror/state'",
                "import { javascript } from '@codemirror/lang-javascript'",
                `import { ${theme.name} } from '@lixpi/prosemirror-themes'`,
                `// or: import { ${theme.name === 'lixpiGruvboxLight' ? 'gruvboxLight' : theme.name} } from '${theme.importPath}'`,
                '',
                'new EditorView({',
                '    parent,',
                `    state: EditorState.create({ doc, extensions: [javascript(), ${theme.name}] }),`,
                '})',
            ].join('\n')
        })
    }

    get frame() {
        return this.example.frame
    }

    destroy(): void {
        this.example.destroy()
    }
}

export const createExample = (
    host: HTMLElement,
    _id: string,
): ExampleOwner => new CodeThemeGallery(host)
