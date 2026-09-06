// A read-only JSON document, highlighted by CodeMirror. Same setup as the web-ui
// code block: an EditorView composed from the extensions the document actually
// needs, with the theme supplying both the editor chrome and the highlight
// style for the tokens. The theme contributes colours only: the block keeps the
// page's own background, which is why the highlight style is used without the
// editor theme beside it. Which one is used comes from settings.ts.
//
// The document is read-only but not inert: its objects and arrays fold from the
// gutter, which is what makes a long record readable.

import { json } from '@codemirror/lang-json'
import {
    foldGutter,
    highlightingFor,
    syntaxHighlighting,
} from '@codemirror/language'
import {
    EditorState as CodeMirrorEditorState,
} from '@codemirror/state'
import {
    EditorView as CodeMirrorEditorView,
} from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { html } from '@lixpi/ui-primitives/dom'

import { chevronIcon } from '$src/views/layouts/icons.ts'

import { settings } from '$src/settings.ts'
import { CODE_THEMES } from '$src/views/modelCatalog/components/codeThemes.ts'

// The class the active highlight style uses for braces, which is the brightest
// colour on screen in a JSON document. A folded range borrows it, so the marker
// matches the `{` and `}` it stands in for and stays tied to whichever theme is
// on. The style is queried through a throwaway state because the marker is built
// before the viewer's own state exists.
const accentClass = (highlight: Parameters<typeof syntaxHighlighting>[0]): string =>
    highlightingFor(
        CodeMirrorEditorState.create({ extensions: [syntaxHighlighting(highlight)] }),
        [tags.brace],
    ) ?? ''

export type JsonViewerConfig = {
    value: unknown
    ariaLabel: string
}

export type JsonViewerInstance = {
    el: HTMLElement
    destroy: () => void
}

class JsonViewer implements JsonViewerInstance {
    readonly el: HTMLElement

    private readonly view: CodeMirrorEditorView

    constructor(config: JsonViewerConfig) {
        const highlight = CODE_THEMES[settings.jsonViewer.theme]
        const foldMarkerAccent = accentClass(highlight)

        this.el = html`
            <div
                className="model-catalog-json"
                role="group"
                aria-label=${config.ariaLabel}
            ></div>
        ` as HTMLElement
        this.el.style.setProperty('--model-catalog-json-font-size', `${settings.jsonViewer.fontSize}px`)

        this.view = new CodeMirrorEditorView({
            state: CodeMirrorEditorState.create({
                doc: JSON.stringify(config.value, null, 4),
                extensions: [
                    syntaxHighlighting(highlight),
                    json(),
                    // Objects and arrays fold from the gutter. `foldGutter`
                    // brings `codeFolding` with it, so the two are one
                    // extension rather than a pair to keep in step.
                    foldGutter({
                        // An icon rather than a text glyph: `⌄` and `›` sit on
                        // the font's baseline, which is nowhere near the middle
                        // of the line they mark. The icon is centred in the
                        // gutter cell and rotated for the open state.
                        markerDOM: open => html`
                            <span
                                className=${open
                                    ? 'model-catalog-fold-marker model-catalog-fold-marker-open'
                                    : `model-catalog-fold-marker model-catalog-fold-marker-closed ${foldMarkerAccent}`}
                                innerHTML=${chevronIcon}
                            ></span>
                        ` as HTMLElement,
                    }),
                    CodeMirrorEditorView.lineWrapping,
                    // Read-only in both senses: no edits, and no cursor inviting
                    // one. The fields above the viewer are where a model changes.
                    CodeMirrorEditorView.editable.of(false),
                    CodeMirrorEditorState.readOnly.of(true),
                ],
            }),
            parent: this.el,
        })
    }

    destroy(): void {
        this.view.destroy()
        this.el.remove()
    }
}

export const createJsonViewer = (config: JsonViewerConfig): JsonViewerInstance => new JsonViewer(config)
